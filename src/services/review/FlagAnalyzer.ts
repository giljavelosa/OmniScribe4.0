import { getLLMService, type LLMService } from '@/services/llm';
import {
  FLAG_ANALYZER_SYSTEM_PROMPT,
  FlagAnalyzerOutputSchema,
  buildFlagAnalyzerUserMessage,
  type FlagAnalyzerOutput,
} from '@/lib/notes/build-flag-analyzer-prompt';
import type { PatientProjection } from '@/lib/notes/projections';
import type { TranscriptClean } from '@/services/transcription';

/**
 * FlagAnalyzer — wraps the LLM call for per-section compliance analysis.
 *
 * Per-section call (not whole-note) so the prompt context stays bounded
 * + a failed section doesn't poison sibling section analysis. Stub-mode
 * Bedrock returns `{ stub: true, ... }` which we coerce to `{ flags: [] }`
 * — the analyzer pipeline exercises end-to-end in dev without a live
 * Bedrock account but emits no flags.
 */
export class FlagAnalyzer {
  constructor(private readonly llm: LLMService = getLLMService()) {}

  async analyzeSection(input: {
    sectionLabel: string;
    sectionContent: string;
    transcript: TranscriptClean | null;
    patient: PatientProjection;
    /** The note's locked division — sourced from `Note.division`. */
    division: string;
    requestId?: string;
  }): Promise<FlagAnalyzerOutput> {
    const user = buildFlagAnalyzerUserMessage(input);
    const result = await this.llm.generate(FLAG_ANALYZER_SYSTEM_PROMPT, user, {
      phi: true,
      temperature: 0,
      jsonMode: true,
      model: 'sonnet',
      maxTokens: 6000,
      requestId: input.requestId,
    });
    return parseAnalyzerOutput(result.text, input.sectionLabel);
  }
}

function parseAnalyzerOutput(rawText: string, sectionLabel?: string): FlagAnalyzerOutput {
  // Strip ```json … ``` (or bare ``` … ```) fences. Sonnet 4.5 wraps in
  // fences habitually even with jsonMode + an explicit "no markdown fences"
  // instruction; without this strip, every fenced response silently
  // becomes { flags: [] } and the entire feature returns no flags.
  const stripped = rawText
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    const label = sectionLabel ?? 'unknown';
    const tail = stripped.length > 200 ? '…' + stripped.slice(-200) : stripped;
    console.warn(
      `[FlagAnalyzer:${label}] JSON.parse failed (likely truncated by maxTokens or malformed). ` +
        `Returning 0 flags. tail=${JSON.stringify(tail)} err=${err instanceof Error ? err.message : String(err)}`,
    );
    return { flags: [] };
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    (parsed as { stub?: boolean }).stub === true
  ) {
    return { flags: [] };
  }
  const result = FlagAnalyzerOutputSchema.safeParse(parsed);
  if (result.success) return result.data;
  const label = sectionLabel ?? 'unknown';
  console.warn(
    `[FlagAnalyzer:${label}] Zod schema rejected the LLM output. Returning 0 flags. ` +
      `issues=${JSON.stringify(result.error.issues.slice(0, 3))}`,
  );
  return { flags: [] };
}
