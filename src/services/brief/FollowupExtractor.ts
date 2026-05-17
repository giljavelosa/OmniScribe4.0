import { getLLMService, type LLMService } from '@/services/llm';
import {
  FOLLOWUP_EXTRACTOR_SYSTEM_PROMPT,
  buildFollowupExtractorUserMessage,
} from '@/lib/notes/build-brief-prompt';
import { FollowupExtractionSchema, type FollowupExtraction } from '@/types/brief';
import type { FinalJsonShape } from '@/lib/notes/build-artifact-prompt';

/**
 * Follow-up extractor (spec §E + references/prior-context-brief-spec.md §10
 * Phase 5).
 *
 * Reads the signed note's Plan section, returns the list of NEXT-VISIT
 * commitments to persist as FollowUp rows. Runs on Haiku (fast + cheap;
 * the prompt is tight and the output is shallow).
 *
 * Idempotency lives at the worker, not here — the extractor is a pure
 * function over (planSectionContent). The worker checks for existing
 * follow-ups with originNoteId === this noteId and skips creation if any
 * exist (so a retry doesn't double-insert).
 *
 * Stub-mode awareness: returns { items: [] } when bedrock is stubbed —
 * keeps the worker exercising end-to-end without faking content.
 */
export class FollowupExtractor {
  constructor(private readonly llm: LLMService = getLLMService()) {}

  async extractFromFinalJson(
    noteId: string,
    signedAtIso: string,
    finalJson: FinalJsonShape,
  ): Promise<FollowupExtraction> {
    const planSection = finalJson.sections.find((s) => /plan/i.test(s.label));
    if (!planSection || planSection.content.trim().length === 0) {
      return { items: [] };
    }

    const user = buildFollowupExtractorUserMessage({
      noteId,
      signedAtIso,
      planSectionContent: planSection.content,
    });

    const result = await this.llm.generate(FOLLOWUP_EXTRACTOR_SYSTEM_PROMPT, user, {
      phi: true,
      temperature: 0,
      jsonMode: true,
      model: 'haiku',
      maxTokens: 800,
    });

    return parseExtraction(result.text);
  }
}

function parseExtraction(rawText: string): FollowupExtraction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText.trim());
  } catch {
    return { items: [] };
  }

  if (
    parsed &&
    typeof parsed === 'object' &&
    (parsed as { stub?: boolean }).stub === true
  ) {
    return { items: [] };
  }

  const result = FollowupExtractionSchema.safeParse(parsed);
  if (result.success) return result.data;
  return { items: [] };
}
