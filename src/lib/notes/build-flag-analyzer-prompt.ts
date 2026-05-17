import { z } from 'zod';

import type { TranscriptClean } from '@/services/transcription';
import type { FinalJsonShape } from '@/lib/notes/build-artifact-prompt';

/**
 * AI compliance flag analyzer (Unit 14).
 *
 * Three absolute rules baked into the system prompt:
 *   1. ONLY flag claims that are directly verifiable against the transcript.
 *      Generic clinical advice or "AI sounds confident" is NOT a flag.
 *   2. SEVERITY PER TAXONOMY:
 *      RED    — contradicts transcript (must resolve before sign)
 *      BLUE   — added specifics (numbers, dates, dosages not in transcript)
 *      YELLOW — inferred (interpretation beyond what was said)
 *      GREEN  — verified (claim is supported by transcript)
 *   3. EVERY FLAG carries (claim, rationale, evidence-quote-from-transcript|
 *      null for BLUE/YELLOW, optional suggestion). No flag without rationale.
 */

export const FlagAnalyzerOutputSchema = z.object({
  flags: z
    .array(
      z.object({
        severity: z.enum(['RED', 'BLUE', 'YELLOW', 'GREEN']),
        claim: z.string().min(1).max(500),
        rationale: z.string().min(1).max(500),
        evidence: z.string().max(500).nullable().optional(),
        suggestion: z.string().max(500).nullable().optional(),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .max(30),
});
export type FlagAnalyzerOutput = z.infer<typeof FlagAnalyzerOutputSchema>;

const SYSTEM = `
You are a clinical compliance reviewer. Your job: read a SINGLE drafted note section against
its source transcript and surface AI-generated content that needs clinician attention BEFORE
sign. You return a JSON object — no commentary, no markdown fences.

═══ ABSOLUTE RULES ═══

1. ONLY FLAG CLAIMS DIRECTLY VERIFIABLE AGAINST THE TRANSCRIPT.
   Generic clinical advice ("recommend exercise") or "the AI sounds confident" is NOT a flag.
   You flag specific, falsifiable statements about THIS patient.

2. SEVERITY PER TAXONOMY:
   - RED    — the claim CONTRADICTS what's in the transcript. Must resolve before sign.
   - BLUE   — the claim adds SPECIFICS (numbers, dates, dosages, frequencies, durations)
              that are NOT in the transcript. Possibly hallucinated; possibly known to the
              clinician from prior context — they confirm.
   - YELLOW — the claim is an INFERENCE (e.g., "patient appears anxious" with no explicit
              cue in the transcript). Clinician confirms or rephrases.
   - GREEN  — the claim IS supported by the transcript. Surfaces as auto-verified count
              only; doesn't queue for review. Use sparingly — only emit GREEN when there's
              a high-confidence match for a non-trivial claim.

3. EVERY FLAG OBJECT MUST INCLUDE:
   - claim:      the specific statement from the draft section (verbatim or near-verbatim)
   - rationale:  one short sentence explaining the flag
   - evidence:   quoted transcript snippet for RED + GREEN; null for BLUE + YELLOW (those
                 inherently have no transcript evidence)
   - suggestion: optional replacement text (especially for RED — what the section SHOULD say
                 based on the transcript)
   - confidence: 0..1 — your confidence the flag is correct (default 0.5)

═══ OUTPUT SCHEMA ═══

{
  "flags": [
    {
      "severity": "RED" | "BLUE" | "YELLOW" | "GREEN",
      "claim":      string,
      "rationale":  string,
      "evidence":   string | null,
      "suggestion": string | null,
      "confidence": number   // 0..1
    },
    ...
  ]
}

No more than 30 flags total. Return { "flags": [] } if there's nothing to flag.

═══ EDGE CASES ═══

- Empty draft section → return { "flags": [] }.
- Empty transcript → cannot verify; return { "flags": [] } rather than guessing.
- Section content matches transcript word-for-word → 0 or 1 GREEN flag, not one per
  sentence.
- Don't flag the section header or template scaffolding — only the clinical content.
`.trim();

export const FLAG_ANALYZER_SYSTEM_PROMPT = SYSTEM;

export function buildFlagAnalyzerUserMessage(input: {
  sectionLabel: string;
  sectionContent: string;
  transcript: TranscriptClean | null;
}): string {
  const transcriptText = input.transcript
    ? input.transcript.structured.map((s) => `${s.speaker}: ${s.text}`).join('\n')
    : '[no transcript captured]';
  return [
    `SECTION: ${input.sectionLabel}`,
    '',
    'DRAFT SECTION CONTENT:',
    '"""',
    input.sectionContent.trim().length > 0 ? input.sectionContent : '(empty section)',
    '"""',
    '',
    'SOURCE TRANSCRIPT (cleaned + diarized):',
    '"""',
    transcriptText,
    '"""',
    '',
    'Now produce the JSON object. Output JSON only.',
  ].join('\n');
}

/** Helper: pull a section's content from finalJson | draftJson shape. */
export function pickSectionContent(
  draft: Record<string, { content: string }> | null,
  finalShape: FinalJsonShape | null,
  sectionId: string,
): string {
  if (draft && draft[sectionId]?.content) return draft[sectionId]!.content;
  if (finalShape) {
    const found = finalShape.sections.find((s) => s.id === sectionId);
    if (found) return found.content;
  }
  return '';
}
