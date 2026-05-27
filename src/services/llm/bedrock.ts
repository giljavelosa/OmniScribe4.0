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
import type {
  ExtractFromImageOptions,
  GenerateChunk,
  GenerateOptions,
  GenerateResult,
  LLMService,
} from './types';

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
        tokensIn: Math.floor((systemPrompt.length + userPrompt.length) / 4),
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
      messages: [{ role: 'user', content: userPrompt }],
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

  /**
   * Sprint 0.19 / Tier 13 — vision extraction call. Sonnet 3.5+ and
   * Haiku 3.5 support image inputs through Bedrock via the Anthropic
   * image content block. PDF is NOT directly supported here (Bedrock
   * Anthropic rejects PDFs); the worker prefilters and falls back to
   * pdf-text extraction outside this path.
   */
  async extractFromImage(
    systemPrompt: string,
    userPrompt: string,
    opts: ExtractFromImageOptions,
  ): Promise<GenerateResult> {
    const modelId = modelIdFor(opts);
    const start = Date.now();

    if (isStubMode()) {
      const text = stubVisionResponse(systemPrompt, userPrompt, opts);
      return {
        text,
        model: modelId || 'stub',
        region: REGION,
        latencyMs: Date.now() - start,
        tokensIn: Math.floor((systemPrompt.length + userPrompt.length) / 4) + opts.images.length * 1000,
        tokensOut: Math.floor(text.length / 4),
        stub: true,
      };
    }

    const client = getClient();
    const content: Array<unknown> = [];
    for (const img of opts.images) {
      // Bedrock Anthropic content schema for vision.
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
      });
    }
    content.push({ type: 'text', text: userPrompt });
    const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0,
      system: systemPrompt,
      messages: [{ role: 'user', content }],
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
}

function stubVisionResponse(_systemPrompt: string, userPrompt: string, opts: ExtractFromImageOptions): string {
  // Deterministic JSON the extraction worker can parse — keys vary by
  // the implied kind tag the worker passes in the user prompt.
  const kindMatch = userPrompt.match(/<upload_kind>([A-Z_]+)<\/upload_kind>/);
  const kind = kindMatch?.[1] ?? 'OTHER';
  switch (kind) {
    case 'MED_LIST':
      return JSON.stringify({
        medications: [
          { name: '[stub] Metformin', dose: '500 mg', frequency: 'BID', route: 'PO' },
          { name: '[stub] Lisinopril', dose: '10 mg', frequency: 'daily', route: 'PO' },
        ],
      });
    case 'LAB_REPORT':
      return JSON.stringify({
        labs: [
          { name: '[stub] A1c', value: '7.2', unit: '%', flag: 'H' },
          { name: '[stub] LDL', value: '128', unit: 'mg/dL', flag: 'H' },
        ],
      });
    case 'IMAGING_REPORT':
      return JSON.stringify({
        studyType: '[stub] MRI Lumbar',
        findings: '[stub] mild disc bulge L4-L5; no nerve root impingement.',
        impression: '[stub] no significant abnormality requiring further workup.',
      });
    case 'INSURANCE_CARD':
      return JSON.stringify({ carrier: '[stub] BlueCross', memberId: 'XXXXXXX1234', groupId: 'GRP-001' });
    case 'ID_CARD':
      return JSON.stringify({ lastName: '[stub] Doe', firstName: '[stub] Jane' });
    default:
      return JSON.stringify({ summary: '[stub] Imported document — manual review recommended.', images: opts.images.length });
  }
}

function stubResponse(systemPrompt: string, userPrompt: string, opts?: GenerateOptions): string {
  const jsonMode = opts?.jsonMode === true;
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
