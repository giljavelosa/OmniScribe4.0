/**
 * Bedrock provider (spec §B). Uses the AWS Bedrock Runtime SDK + the
 * Anthropic message format. Bearer-token auth via AWS_BEARER_TOKEN_BEDROCK
 * (the long-lived API key, NOT AWS_ACCESS_KEY_ID — see kit's "things that
 * look fine but break the system").
 *
 * Stub mode: if AWS_BEARER_TOKEN_BEDROCK is absent OR BEDROCK_MODEL_ID is
 * still the placeholder, returns a synthetic response so the ai-generation
 * worker exercises end-to-end without a live Bedrock account.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type { GenerateChunk, GenerateOptions, GenerateResult, ImageBlock, LLMService } from './types';

const REGION = process.env.BEDROCK_REGION ?? 'us-east-1';
const SONNET_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? '';
const HAIKU_MODEL_ID = process.env.BEDROCK_FAST_MODEL_ID ?? '';
const BEARER_TOKEN = process.env.AWS_BEARER_TOKEN_BEDROCK ?? '';

function modelIdFor(opts: GenerateOptions | undefined): string {
  if (opts?.model === 'haiku' && HAIKU_MODEL_ID) return HAIKU_MODEL_ID;
  return SONNET_MODEL_ID;
}

function isStubMode(): boolean {
  return !BEARER_TOKEN || !SONNET_MODEL_ID || SONNET_MODEL_ID.endsWith('...');
}

let cachedClient: BedrockRuntimeClient | null = null;
function getClient(): BedrockRuntimeClient {
  if (!cachedClient) {
    // The SDK auto-detects AWS_BEARER_TOKEN_BEDROCK from env when present.
    cachedClient = new BedrockRuntimeClient({ region: REGION });
  }
  return cachedClient;
}

export class BedrockService implements LLMService {
  async generate(
    systemPrompt: string,
    userPrompt: string,
    opts: GenerateOptions = { phi: false },
  ): Promise<GenerateResult> {
    const modelId = modelIdFor(opts);
    const start = Date.now();

    if (isStubMode()) {
      const text = stubResponse(systemPrompt, userPrompt, opts);
      return {
        text,
        model: modelId || 'stub',
        region: REGION,
        latencyMs: Date.now() - start,
        tokensIn: Math.floor((systemPrompt.length + userPrompt.length) / 4) + imageTokenEstimate(opts.images),
        tokensOut: Math.floor(text.length / 4),
        stub: true,
      };
    }

    const client = getClient();
    const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: buildUserContent(userPrompt, opts.images) }],
    });

    const cmd = new InvokeModelCommand({ modelId, body });
    const resp = await client.send(cmd);
    const parsed = JSON.parse(new TextDecoder().decode(resp.body)) as {
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };
    const text = parsed.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n')
      .trim();

    return {
      text,
      model: modelId,
      region: REGION,
      latencyMs: Date.now() - start,
      tokensIn: parsed.usage.input_tokens,
      tokensOut: parsed.usage.output_tokens,
    };
  }

  async *generateStream(
    systemPrompt: string,
    userPrompt: string,
    opts: GenerateOptions = { phi: false },
  ): AsyncIterable<GenerateChunk> {
    const modelId = modelIdFor(opts);

    if (isStubMode()) {
      const text = stubResponse(systemPrompt, userPrompt, opts);
      for (const chunk of text.match(/.{1,40}/g) ?? [text]) {
        yield { delta: chunk };
      }
      yield { delta: '', done: true };
      return;
    }

    const client = getClient();
    const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const cmd = new InvokeModelWithResponseStreamCommand({ modelId, body });
    const resp = await client.send(cmd);
    if (!resp.body) {
      yield { delta: '', done: true };
      return;
    }
    for await (const event of resp.body) {
      if (!event.chunk?.bytes) continue;
      const payload = JSON.parse(new TextDecoder().decode(event.chunk.bytes)) as {
        type: string;
        delta?: { type: string; text?: string };
      };
      if (payload.type === 'content_block_delta' && payload.delta?.type === 'text_delta') {
        yield { delta: payload.delta.text ?? '' };
      }
    }
    yield { delta: '', done: true };
  }
}

type AnthropicUserContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | {
          type: 'image';
          source: { type: 'base64'; media_type: ImageBlock['mediaType']; data: string };
        }
    >;

function buildUserContent(userPrompt: string, images: ImageBlock[] | undefined): AnthropicUserContent {
  if (!images?.length) return userPrompt;
  return [
    { type: 'text', text: userPrompt },
    ...images.map((image) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: image.mediaType,
        data: image.data,
      },
    })),
  ];
}

function imageTokenEstimate(images: ImageBlock[] | undefined): number {
  if (!images?.length) return 0;
  return images.reduce((sum, image) => sum + Math.ceil(image.data.length / 4), 0);
}

function stubResponse(systemPrompt: string, userPrompt: string, opts?: GenerateOptions): string {
  const jsonMode = opts?.jsonMode === true;
  if (jsonMode && opts?.images?.length) {
    return JSON.stringify({
      ocrText:
        'Bedrock stub OCR from uploaded document image. Configure AWS_BEARER_TOKEN_BEDROCK for live Claude vision extraction.',
      extraction: {
        documentType: 'other',
        summary: `Stub extraction from ${opts.images.length} image page${opts.images.length === 1 ? '' : 's'}.`,
        diagnoses: [],
        medications: [],
        allergies: [],
        labs: [
          {
            name: 'Stub lab value',
            value: '1.0',
            unit: null,
            referenceRange: null,
            abnormalFlag: 'unknown',
            collectedDate: null,
            sourcePage: opts.images[0]?.sourcePage ?? 1,
            confidence: 'low',
            verbatim: 'Bedrock stub OCR from uploaded document image.',
          },
        ],
        vitals: [],
        procedures: [],
        documentDateGuess: null,
        extractionNotes: 'Stub-mode extraction envelope for local Unit 52 testing.',
      },
    });
  }
  if (jsonMode) {
    return JSON.stringify({
      stub: true,
      text:
        'Bedrock stub response — set AWS_BEARER_TOKEN_BEDROCK + a real ' +
        'BEDROCK_MODEL_ID (us.anthropic.claude-sonnet-4-5-…) to invoke a real model.',
      systemPromptChars: systemPrompt.length,
      userPromptChars: userPrompt.length,
    });
  }
  return (
    '[Bedrock stub mode — set AWS_BEARER_TOKEN_BEDROCK + a real ' +
    'BEDROCK_MODEL_ID (us.anthropic.claude-sonnet-4-5-…) to invoke a real model.] ' +
    `(system: ${systemPrompt.length} chars, user: ${userPrompt.length} chars)`
  );
}

export const bedrockConfig = {
  isStubMode: isStubMode(),
  region: REGION,
  sonnetModelId: SONNET_MODEL_ID,
  haikuModelId: HAIKU_MODEL_ID,
};
