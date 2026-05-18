import { getLLMService, type LLMService } from '@/services/llm';
import {
  FLAG_ANALYZER_SYSTEM_PROMPT,
  FlagAnalyzerOutputSchema,
  buildFlagAnalyzerUserMessage,
  type FlagAnalyzerOutput,
} from '@/lib/notes/build-flag-analyzer-prompt';
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
    requestId?: string;
  }): Promise<FlagAnalyzerOutput> {
    const user = buildFlagAnalyzerUserMessage(input);
    const result = await this.llm.generate(FLAG_ANALYZER_SYSTEM_PROMPT, user, {
      phi: true,
      temperature: 0,
      jsonMode: true,
      model: 'sonnet',
      maxTokens: 2000,
      requestId: input.requestId,
    });
    return parseAnalyzerOutput(result.text);
  }
}

function parseAnalyzerOutput(rawText: string): FlagAnalyzerOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText.trim());
  } catch {
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
  return { flags: [] };
}
