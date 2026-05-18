import { createHash } from 'node:crypto';
import { z } from 'zod';

import type { ToolResult } from './tools';

/**
 * Research-mode tools — Unit 29.
 *
 * Strictly separated from the chart-mode tools (Unit 27/28). Research
 * tools take a free-text query + an optional limit; they NEVER take a
 * patientId. The agent's mode dispatch (in agent.ts) refuses to call
 * these from chart mode and refuses to call chart tools from research
 * mode — fail-closed against the model drifting and mixing sources.
 *
 * v1 ships stub-mode results only. Real-mode integrations:
 *   - searchPMC: would hit eutils.ncbi.nlm.nih.gov/entrez/eutils/
 *     esearch.fcgi?db=pmc&term=... — PUBLIC API, no PHI sent
 *   - searchAttestedLiterature: waits for an internal vetted-corpus
 *     service to exist
 *
 * Stub results are seeded off the query so repeated dev queries
 * produce stable rows (good for the UI being deterministic during
 * development).
 */

export type ResearchToolName = 'searchPMC' | 'searchAttestedLiterature';

export const RESEARCH_TOOL_NAMES: ReadonlySet<string> = new Set([
  'searchPMC',
  'searchAttestedLiterature',
]);

const searchPMCArgs = z.object({
  query: z.string().min(1).max(400),
  limit: z.number().int().min(1).max(10).optional(),
});

const searchAttestedLiteratureArgs = z.object({
  query: z.string().min(1).max(400),
  limit: z.number().int().min(1).max(10).optional(),
});

const DEFAULT_LIMIT = 5;

export async function runResearchTool(
  name: string,
  argsRaw: unknown,
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'searchPMC': {
        const args = searchPMCArgs.parse(argsRaw);
        const results = synthesizePMCResults(args.query, args.limit ?? DEFAULT_LIMIT);
        return { ok: true, rowCount: results.length, data: { results } };
      }
      case 'searchAttestedLiterature': {
        const args = searchAttestedLiteratureArgs.parse(argsRaw);
        const results = synthesizeAttestedResults(args.query, args.limit ?? DEFAULT_LIMIT);
        return { ok: true, rowCount: results.length, data: { results } };
      }
      default:
        return { ok: false, error: `unknown_research_tool:${name}` };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof z.ZodError
        ? `args_invalid:${err.issues[0]?.message ?? 'unknown'}`
        : err instanceof Error
          ? err.message.slice(0, 120)
          : 'tool_threw',
    };
  }
}

// =====================================================================
// Stub-mode synthesis — deterministic per query
// =====================================================================

function synthesizePMCResults(query: string, limit: number) {
  const seed = `pmc:${query.toLowerCase()}`;
  // Build N plausible PMC entries seeded off the query so dev sessions
  // see stable rows. The title pulls a few of the query's own words in
  // so the agent's downstream answer looks like it's citing relevant
  // literature (rather than gibberish-titled papers).
  const baseId = hashToInt(seed);
  const journals = [
    'New England Journal of Medicine',
    'JAMA',
    'Annals of Internal Medicine',
    'BMJ',
    'The Lancet',
  ];
  const years = [2024, 2023, 2022, 2024, 2023];
  return Array.from({ length: Math.min(limit, 5) }, (_, i) => ({
    pmcId: `PMC${baseId + i * 17}`,
    title: synthesizeTitle(query, i),
    journal: journals[i % journals.length],
    year: years[i % years.length],
    abstract:
      `[stub] Synthesized abstract for query "${query.slice(0, 60)}". Real-mode PMC ` +
      `integration lands in a follow-up unit; this stub exists so the agent + UI ` +
      `can be exercised end-to-end.`,
  }));
}

function synthesizeAttestedResults(query: string, limit: number) {
  const seed = `attested:${query.toLowerCase()}`;
  const baseId = hashToInt(seed);
  const sources = ['UpToDate', 'BMJ Best Practice', 'NICE Guidelines', 'AHA/ACC Guidelines', 'USPSTF'];
  const years = [2025, 2024, 2024, 2023, 2025];
  return Array.from({ length: Math.min(limit, 5) }, (_, i) => ({
    id: `lit-${baseId + i * 13}`,
    title: synthesizeTitle(query, i + 7),
    source: sources[i % sources.length],
    year: years[i % years.length],
    summary:
      `[stub] Synthesized summary for query "${query.slice(0, 60)}". Vetted-corpus ` +
      `integration lands when the attested-literature service is wired.`,
  }));
}

function synthesizeTitle(query: string, salt: number): string {
  const significantWords = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !COMMON_STOPWORDS.has(w))
    .slice(0, 3);
  const prefix = ['A systematic review of', 'Recent evidence on', 'Clinical guidelines for'][salt % 3];
  const tail = significantWords.join(' ') || 'clinical practice';
  return `${prefix} ${tail}: a stub-mode citation`;
}

const COMMON_STOPWORDS = new Set([
  'what',
  'when',
  'where',
  'about',
  'recent',
  'evidence',
  'guidelines',
  'best',
  'practice',
  'patients',
  'patient',
]);

function hashToInt(s: string): number {
  const h = createHash('sha256').update(s).digest();
  // Use the first 4 bytes as an unsigned int, then offset into a
  // PMC-like 6-7 digit range.
  const n = h.readUInt32BE(0);
  return 1000000 + (n % 8000000);
}
