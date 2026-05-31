import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExtractionEnvelopeSchema } from '@/types/external-context-extraction';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('BedrockService image blocks', () => {
  it('returns a valid extraction envelope in stub mode when images are present', async () => {
    vi.stubEnv('AWS_BEARER_TOKEN_BEDROCK', '');
    vi.stubEnv('BEDROCK_MODEL_ID', '');
    vi.resetModules();

    const { BedrockService } = await import('@/services/llm/bedrock');
    const service = new BedrockService();
    const result = await service.generate('system', 'extract', {
      phi: true,
      jsonMode: true,
      images: [
        {
          mediaType: 'image/png',
          data: Buffer.from('png bytes').toString('base64'),
          sourcePage: 1,
        },
      ],
    });

    expect(result.stub).toBe(true);
    const parsed = ExtractionEnvelopeSchema.safeParse(JSON.parse(result.text));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.extraction.documentType).toBe('other');
      expect(parsed.data.extraction.labs).toHaveLength(1);
    }
  });
});
