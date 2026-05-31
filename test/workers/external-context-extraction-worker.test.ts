import { beforeEach, describe, expect, it, vi } from 'vitest';

const findFirst = vi.fn();
const findFirstTx = vi.fn();
const update = vi.fn();
const tx = vi.fn();
const createManyBatch = vi.fn();
const findFirstBatch = vi.fn();
const updateBatch = vi.fn();
const updateManyBatch = vi.fn();
const upsertDocumentPage = vi.fn();
const writeAuditLog = vi.fn();
const getObjectBytes = vi.fn();
const rasterizeExternalContextDocuments = vi.fn();
const extract = vi.fn();
const isFileRouterV2Enabled = vi.fn();
const routeClinicalFile = vi.fn();
const extractTextDocument = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: (...args: unknown[]) => tx(...args),
    externalContext: {
      findFirst: (...args: unknown[]) => findFirst(...args),
      update: (...args: unknown[]) => update(...args),
    },
    externalContextExtractionBatch: {
      createMany: (...args: unknown[]) => createManyBatch(...args),
      findFirst: (...args: unknown[]) => findFirstBatch(...args),
      update: (...args: unknown[]) => updateBatch(...args),
      updateMany: (...args: unknown[]) => updateManyBatch(...args),
    },
    externalContextDocumentPage: {
      upsert: (...args: unknown[]) => upsertDocumentPage(...args),
    },
  },
}));
vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...args: unknown[]) => writeAuditLog(...args),
}));
vi.mock('@/lib/s3/client', () => ({
  getObjectBytes: (...args: unknown[]) => getObjectBytes(...args),
  s3Config: {
    bucket: 'test-documents',
    region: 'us-east-1',
    isStubMode: false,
  },
}));
vi.mock('@/services/external-context/document-rasterizer', () => ({
  rasterizeExternalContextDocuments: (...args: unknown[]) => rasterizeExternalContextDocuments(...args),
}));
vi.mock('@/services/external-context/document-extractor', () => ({
  DocumentExtractor: class {
    extract = (...args: unknown[]) => extract(...args);
  },
}));
vi.mock('@/services/external-context/file-router', () => ({
  isFileRouterV2Enabled: (...args: unknown[]) => isFileRouterV2Enabled(...args),
  routeClinicalFile: (...args: unknown[]) => routeClinicalFile(...args),
}));
vi.mock('@/services/external-context/text-document-extractor', () => ({
  TextDocumentExtractor: class {
    extract = (...args: unknown[]) => extractTextDocument(...args);
  },
}));

import { handle } from '@/workers/external-context-extraction/handler';

beforeEach(() => {
  findFirst.mockReset();
  findFirstTx.mockReset();
  update.mockReset();
  tx.mockReset();
  createManyBatch.mockReset();
  findFirstBatch.mockReset();
  updateBatch.mockReset();
  updateManyBatch.mockReset();
  upsertDocumentPage.mockReset();
  writeAuditLog.mockReset();
  getObjectBytes.mockReset();
  rasterizeExternalContextDocuments.mockReset();
  extract.mockReset();
  isFileRouterV2Enabled.mockReset();
  routeClinicalFile.mockReset();
  extractTextDocument.mockReset();
  isFileRouterV2Enabled.mockReturnValue(false);
  upsertDocumentPage.mockResolvedValue({});
  findFirstTx.mockResolvedValue({
    deletedAt: null,
    verifiedAt: null,
    status: 'PENDING_EXTRACTION',
  });
  updateManyBatch.mockResolvedValue({ count: 1 });
  tx.mockImplementation(async (arg) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return arg({
      externalContext: {
        findFirst: (...args: unknown[]) => findFirstTx(...args),
        update: (...args: unknown[]) => update(...args),
      },
      externalContextExtractionBatch: {
        updateMany: (...args: unknown[]) => updateManyBatch(...args),
      },
      externalContextDocumentPage: {
        upsert: (...args: unknown[]) => upsertDocumentPage(...args),
      },
    });
  });
});

function makeJob(overrides: Partial<{ attemptsMade: number; opts: { attempts?: number } }> = {}) {
  return {
    data: {
      externalContextId: 'ec_1',
      orgId: 'org_1',
      requestId: 'req_1',
    },
    attemptsMade: overrides.attemptsMade ?? 0,
    opts: overrides.opts ?? { attempts: 3 },
  };
}

const extractionEnvelope = {
  ocrText: 'OCR text',
  extraction: {
    documentType: 'lab_report',
    summary: 'Lab report summary.',
    diagnoses: [],
    medications: [],
    allergies: [],
    labs: [],
    vitals: [],
    procedures: [],
    documentDateGuess: null,
    extractionNotes: null,
  },
};

describe('external-context-extraction worker', () => {
  it('writes the extracted batch, pauses for review, and audits completion', async () => {
    findFirst.mockResolvedValueOnce({
      id: 'ec_1',
      status: 'PENDING_EXTRACTION',
      mediaKind: 'DOCUMENT',
      source: 'OUTSIDE_PROVIDER',
      sourceLabel: 'Lab photo',
      documentFileKeys: ['documents/external-context/ec_1/0.png'],
      documentMimeTypes: ['image/png'],
      deletedAt: null,
      extractionBatches: [],
    });
    getObjectBytes.mockResolvedValueOnce(Buffer.from('image'));
    rasterizeExternalContextDocuments.mockResolvedValueOnce({
      pageCount: 7,
      images: [{ mediaType: 'image/png', data: 'abc', sourcePage: 1 }],
    });
    createManyBatch.mockResolvedValueOnce({ count: 2 });
    findFirstBatch
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'batch_1',
        batchIndex: 0,
        pageStart: 1,
        pageEnd: 5,
        status: 'PENDING',
      });
    updateBatch.mockResolvedValue({});
    extract.mockResolvedValueOnce({
      envelope: extractionEnvelope,
      model: 'claude-test',
      latencyMs: 25,
      stub: true,
    });
    update.mockResolvedValueOnce({});

    const result = await handle(makeJob() as unknown as Parameters<typeof handle>[0]);

    expect(result).toEqual({ ok: true, externalContextId: 'ec_1', batchId: 'batch_1' });
    expect(createManyBatch).toHaveBeenCalledWith(expect.objectContaining({
      data: [
        expect.objectContaining({ batchIndex: 0, pageStart: 1, pageEnd: 5 }),
        expect.objectContaining({ batchIndex: 1, pageStart: 6, pageEnd: 7 }),
      ],
    }));
    expect(updateManyBatch).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'batch_1',
        status: 'PROCESSING',
      }),
      data: expect.objectContaining({
        status: 'NEEDS_REVIEW',
        ocrText: 'OCR text',
        extractionModel: 'claude-test',
      }),
    }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ec_1' },
      data: expect.objectContaining({
        status: 'PARTIAL_EXTRACTION_REVIEW',
        ocrText: 'OCR text',
        extractionModel: 'claude-test',
        pageCount: 7,
      }),
    }));
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'EXTERNAL_CONTEXT_BATCH_EXTRACTED',
      metadata: expect.objectContaining({
        pageCount: 7,
        batchIndex: 0,
        stub: true,
        requestId: 'req_1',
      }),
    }));
    expect(routeClinicalFile).not.toHaveBeenCalled();
  });

  it('marks EXTRACTION_FAILED only on the final failed attempt', async () => {
    findFirst.mockResolvedValueOnce({
      id: 'ec_1',
      status: 'PENDING_EXTRACTION',
      mediaKind: 'DOCUMENT',
      source: 'OUTSIDE_PROVIDER',
      sourceLabel: 'Lab photo',
      documentFileKeys: ['documents/external-context/ec_1/0.png'],
      documentMimeTypes: ['image/png'],
      deletedAt: null,
      extractionBatches: [],
    });
    findFirst.mockResolvedValueOnce({
      deletedAt: null,
      verifiedAt: null,
      status: 'PENDING_EXTRACTION',
    });
    getObjectBytes.mockRejectedValueOnce(new Error('s3 down'));
    update.mockResolvedValueOnce({});

    await expect(
      handle(makeJob({ attemptsMade: 2, opts: { attempts: 3 } }) as unknown as Parameters<typeof handle>[0]),
    ).rejects.toThrow('s3 down');

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ec_1' },
      data: { status: 'EXTRACTION_FAILED' },
    }));
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'EXTERNAL_CONTEXT_EXTRACTION_FAILED',
      metadata: expect.objectContaining({ attempt: 3 }),
    }));
  });

  it('reuses the current processing batch on retry and resets later stale processing batches', async () => {
    findFirst.mockResolvedValueOnce({
      id: 'ec_1',
      status: 'PENDING_EXTRACTION',
      mediaKind: 'DOCUMENT',
      source: 'OUTSIDE_PROVIDER',
      sourceLabel: 'Lab photo',
      documentFileKeys: ['documents/external-context/ec_1/0.png'],
      documentMimeTypes: ['image/png'],
      deletedAt: null,
      extractionBatches: [
        { id: 'batch_1', batchIndex: 0, pageStart: 1, pageEnd: 5, status: 'PROCESSING' },
        { id: 'batch_2', batchIndex: 1, pageStart: 6, pageEnd: 10, status: 'PROCESSING' },
      ],
    });
    getObjectBytes.mockResolvedValueOnce(Buffer.from('image'));
    findFirstBatch.mockResolvedValueOnce({
      id: 'batch_1',
      batchIndex: 0,
      pageStart: 1,
      pageEnd: 5,
      status: 'PROCESSING',
    });
    updateManyBatch.mockResolvedValueOnce({ count: 1 });
    rasterizeExternalContextDocuments.mockResolvedValueOnce({
      pageCount: 10,
      images: [{ mediaType: 'image/png', data: 'abc', sourcePage: 1 }],
    });
    extract.mockResolvedValueOnce({
      envelope: extractionEnvelope,
      model: 'claude-test',
      latencyMs: 25,
      stub: true,
    });

    await handle(makeJob({ attemptsMade: 1 }) as unknown as Parameters<typeof handle>[0]);

    expect(updateManyBatch).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'PROCESSING',
        batchIndex: { gt: 0 },
      }),
      data: expect.objectContaining({ status: 'PENDING' }),
    }));
    expect(updateBatch).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'batch_1' },
      data: expect.objectContaining({ status: 'PROCESSING' }),
    }));
    expect(extract).toHaveBeenCalledWith(expect.objectContaining({
      images: [expect.objectContaining({ sourcePage: 1 })],
    }));
  });

  it('does not overwrite a document that was verified while extraction was running', async () => {
    findFirst.mockResolvedValueOnce({
      id: 'ec_1',
      status: 'PENDING_EXTRACTION',
      mediaKind: 'DOCUMENT',
      source: 'OUTSIDE_PROVIDER',
      sourceLabel: 'Synthetic packet',
      documentFileKeys: ['documents/external-context/ec_1/0.pdf'],
      documentMimeTypes: ['application/pdf'],
      deletedAt: null,
      verifiedAt: null,
      extractionBatches: [
        { id: 'batch_1', batchIndex: 0, pageStart: 1, pageEnd: 5, status: 'PROCESSING' },
      ],
    });
    getObjectBytes.mockResolvedValueOnce(Buffer.from('image'));
    findFirstBatch.mockResolvedValueOnce({
      id: 'batch_1',
      batchIndex: 0,
      pageStart: 1,
      pageEnd: 5,
      status: 'PROCESSING',
    });
    rasterizeExternalContextDocuments.mockResolvedValueOnce({
      pageCount: 5,
      images: [{ mediaType: 'image/png', data: 'abc', sourcePage: 1 }],
    });
    extract.mockResolvedValueOnce({
      envelope: extractionEnvelope,
      model: 'claude-test',
      latencyMs: 25,
      stub: true,
    });
    findFirstTx.mockResolvedValueOnce({
      deletedAt: null,
      verifiedAt: new Date('2026-05-30T00:00:00Z'),
      status: 'READY',
    });

    const result = await handle(makeJob() as unknown as Parameters<typeof handle>[0]);

    expect(result).toEqual({ skipped: 'verified_after_extraction' });
    expect(updateManyBatch).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'NEEDS_REVIEW' }),
    }));
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PARTIAL_EXTRACTION_REVIEW' }),
    }));
    expect(writeAuditLog).not.toHaveBeenCalledWith(expect.objectContaining({
      action: 'EXTERNAL_CONTEXT_BATCH_EXTRACTED',
    }));
  });

  it('uses router V2 for text-based PDFs and does not rasterize page images', async () => {
    isFileRouterV2Enabled.mockReturnValue(true);
    findFirst.mockResolvedValueOnce({
      id: 'ec_1',
      status: 'PENDING_EXTRACTION',
      mediaKind: 'DOCUMENT',
      source: 'OUTSIDE_PROVIDER',
      sourceLabel: 'Synthetic packet',
      documentFileKeys: ['documents/external-context/ec_1/0.pdf'],
      documentMimeTypes: ['application/pdf'],
      deletedAt: null,
      extractionBatches: [],
    });
    getObjectBytes.mockResolvedValueOnce(Buffer.from('%PDF-1.4'));
    routeClinicalFile.mockResolvedValueOnce({
      route: 'pdf_text_layer',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      extension: 'pdf',
      pageCount: 40,
      text: 'Page 1\nJohn Alvarez\nCreatinine 1.42',
      textLayerUsable: true,
      ocrUsed: false,
      unsupportedReason: null,
      progressStates: ['Uploaded', 'Detecting file type', 'Checking PDF text layer'],
      timings: {
        fileTypeDetectedAt: '2026-05-29T00:00:00.000Z',
        textLayerCheckedAt: '2026-05-29T00:00:00.001Z',
        textExtractionStartedAt: '2026-05-29T00:00:00.000Z',
        textExtractionCompletedAt: '2026-05-29T00:00:00.001Z',
        normalizationCompletedAt: '2026-05-29T00:00:00.002Z',
        clinicianReviewReadyAt: '2026-05-29T00:00:00.003Z',
        ocrDurationMs: 0,
        normalizationDurationMs: 1,
        extractionDurationMs: 2,
      },
    });
    findFirstBatch
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'batch_1',
        batchIndex: 0,
        pageStart: 1,
        pageEnd: 40,
        status: 'PENDING',
      });
    extractTextDocument.mockResolvedValueOnce({
      envelope: extractionEnvelope,
      model: 'test-model',
      latencyMs: 10,
      stub: true,
      tokensIn: 20,
      tokensOut: 30,
    });

    const result = await handle(makeJob() as unknown as Parameters<typeof handle>[0]);

    expect(result).toEqual({
      ok: true,
      externalContextId: 'ec_1',
      batchId: 'batch_1',
      route: 'pdf_text_layer',
    });
    expect(rasterizeExternalContextDocuments).not.toHaveBeenCalled();
    expect(createManyBatch).toHaveBeenCalledWith(expect.objectContaining({
      data: [
        expect.objectContaining({
          batchIndex: 0,
          pageStart: 1,
          pageEnd: 40,
        }),
      ],
    }));
    expect(extractTextDocument).toHaveBeenCalledWith(expect.objectContaining({
      route: 'pdf_text_layer',
      text: expect.stringContaining('John Alvarez'),
    }));
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        routerVersion: 'v2',
        detectedRoutes: ['pdf_text_layer'],
        ocrUsed: false,
      }),
    }));
  });

  it('keeps single-image uploads on the existing fast vision path when router V2 is enabled', async () => {
    isFileRouterV2Enabled.mockReturnValue(true);
    findFirst.mockResolvedValueOnce({
      id: 'ec_1',
      status: 'PENDING_EXTRACTION',
      mediaKind: 'DOCUMENT',
      source: 'OUTSIDE_PROVIDER',
      sourceLabel: 'Lab photo',
      documentFileKeys: ['documents/external-context/ec_1/0.png'],
      documentMimeTypes: ['image/png'],
      deletedAt: null,
      extractionBatches: [],
    });
    getObjectBytes.mockResolvedValueOnce(Buffer.from('image'));
    routeClinicalFile.mockResolvedValueOnce({
      route: 'image_fast_path',
      fileType: 'image',
      mimeType: 'image/png',
      extension: 'png',
      pageCount: 1,
      text: '',
      textLayerUsable: false,
      ocrUsed: false,
      unsupportedReason: null,
      progressStates: ['Uploaded', 'Detecting file type'],
      timings: { ocrDurationMs: 0, normalizationDurationMs: 0, extractionDurationMs: 0 },
    });
    rasterizeExternalContextDocuments.mockResolvedValueOnce({
      pageCount: 1,
      images: [{ mediaType: 'image/png', data: 'abc', sourcePage: 1 }],
    });
    createManyBatch.mockResolvedValueOnce({ count: 1 });
    findFirstBatch
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'batch_1',
        batchIndex: 0,
        pageStart: 1,
        pageEnd: 1,
        status: 'PENDING',
      });
    extract.mockResolvedValueOnce({
      envelope: extractionEnvelope,
      model: 'claude-test',
      latencyMs: 25,
      stub: true,
    });

    await handle(makeJob() as unknown as Parameters<typeof handle>[0]);

    expect(routeClinicalFile).toHaveBeenCalled();
    expect(rasterizeExternalContextDocuments).toHaveBeenCalled();
    expect(extract).toHaveBeenCalled();
    expect(extractTextDocument).not.toHaveBeenCalled();
  });
});
