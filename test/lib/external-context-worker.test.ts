import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks. The worker handler imports prisma, the audit writer, S3, and the
// Soniox service — each is replaced with a controllable double.
// ---------------------------------------------------------------------------

const findFirst = vi.fn();
const update = vi.fn();
const writeAuditLog = vi.fn();
const getAudioBytes = vi.fn();
const transcribeBatch = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    externalContext: {
      findFirst: (...args: unknown[]) => findFirst(...args),
      update: (...args: unknown[]) => update(...args),
    },
  },
}));
vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...args: unknown[]) => writeAuditLog(...args),
}));
vi.mock('@/lib/s3/client', () => ({
  getAudioBytes: (...args: unknown[]) => getAudioBytes(...args),
}));
vi.mock('@/services/transcription', () => ({
  transcribeBatch: (...args: unknown[]) => transcribeBatch(...args),
  cleanBatchTranscript: (raw: { tokens?: Array<{ text: string }> }) => ({
    plaintext: (raw.tokens ?? []).map((t) => t.text).join(' '),
    structured: [],
    durationMs: 0,
    wordCount: (raw.tokens ?? []).map((t) => t.text).join(' ').split(/\s+/).filter(Boolean).length,
    speakerCount: 1,
    source: 'batch' as const,
  }),
  sonioxConfig: { isStubMode: true },
}));

import { handle } from '@/workers/external-context/handler';

beforeEach(() => {
  findFirst.mockReset();
  update.mockReset();
  writeAuditLog.mockReset();
  getAudioBytes.mockReset();
  transcribeBatch.mockReset();
});

function makeJob(overrides: Partial<{ attemptsMade: number; opts: { attempts?: number } }> = {}) {
  return {
    data: {
      externalContextId: 'ec_1',
      orgId: 'org_1',
      requestId: 'req_abc',
    },
    attemptsMade: overrides.attemptsMade ?? 0,
    opts: overrides.opts ?? { attempts: 3 },
  };
}

describe('external-context worker handler', () => {
  it('happy path: fetches audio, transcribes, writes READY + transcript, audits completed', async () => {
    findFirst.mockResolvedValueOnce({
      id: 'ec_1',
      status: 'PENDING_TRANSCRIPTION',
      source: 'PATIENT_SUPPLIED',
      audioFileKey: 'audio/external-context/ec_1.wav',
    });
    getAudioBytes.mockResolvedValueOnce(Buffer.from('bytes'));
    transcribeBatch.mockResolvedValueOnce({
      tokens: [
        { text: 'Hello', is_final: true },
        { text: 'world', is_final: true },
      ],
    });
    update.mockResolvedValueOnce({});

    const result = await handle(makeJob() as unknown as Parameters<typeof handle>[0]);
    expect(result).toEqual({ ok: true, externalContextId: 'ec_1' });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ec_1' },
        data: expect.objectContaining({
          status: 'READY',
          transcriptClean: 'Hello world',
        }),
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EXTERNAL_CONTEXT_TRANSCRIPTION_COMPLETED',
        orgId: 'org_1',
        resourceId: 'ec_1',
        metadata: expect.objectContaining({
          wordCount: 2,
          source: 'PATIENT_SUPPLIED',
          stub: true,
        }),
      }),
    );
  });

  it('drops when the row is missing', async () => {
    findFirst.mockResolvedValueOnce(null);
    const result = await handle(makeJob() as unknown as Parameters<typeof handle>[0]);
    expect(result).toEqual({ skipped: 'not_found' });
    expect(update).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('skips when status is already READY', async () => {
    findFirst.mockResolvedValueOnce({
      id: 'ec_1',
      status: 'READY',
      source: 'OUTSIDE_PROVIDER',
      audioFileKey: 'audio/external-context/ec_1.wav',
    });
    const result = await handle(makeJob() as unknown as Parameters<typeof handle>[0]);
    expect(result).toEqual({ skipped: 'status=READY' });
    expect(getAudioBytes).not.toHaveBeenCalled();
  });

  it('on final-attempt failure flips status to FAILED + audits FAILED + rethrows', async () => {
    findFirst.mockResolvedValueOnce({
      id: 'ec_1',
      status: 'PENDING_TRANSCRIPTION',
      source: 'PATIENT_SUPPLIED',
      audioFileKey: 'audio/external-context/ec_1.wav',
    });
    getAudioBytes.mockResolvedValueOnce(Buffer.from('bytes'));
    transcribeBatch.mockRejectedValueOnce(new TypeError('soniox down'));
    update.mockResolvedValueOnce({});

    await expect(
      handle(
        makeJob({ attemptsMade: 2, opts: { attempts: 3 } }) as unknown as Parameters<
          typeof handle
        >[0],
      ),
    ).rejects.toThrow('soniox down');

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ec_1' },
        data: { status: 'FAILED' },
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EXTERNAL_CONTEXT_TRANSCRIPTION_FAILED',
        metadata: expect.objectContaining({
          errorClass: 'TypeError',
          attempt: 3,
        }),
      }),
    );
  });

  it('on non-final-attempt failure rethrows WITHOUT flipping status — preserves retry', async () => {
    findFirst.mockResolvedValueOnce({
      id: 'ec_1',
      status: 'PENDING_TRANSCRIPTION',
      source: 'PATIENT_SUPPLIED',
      audioFileKey: 'audio/external-context/ec_1.wav',
    });
    getAudioBytes.mockResolvedValueOnce(Buffer.from('bytes'));
    transcribeBatch.mockRejectedValueOnce(new Error('transient'));

    await expect(
      handle(
        makeJob({ attemptsMade: 0, opts: { attempts: 3 } }) as unknown as Parameters<
          typeof handle
        >[0],
      ),
    ).rejects.toThrow('transient');

    expect(update).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});
