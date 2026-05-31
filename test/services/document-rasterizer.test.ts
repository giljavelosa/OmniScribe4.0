import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());
const mkdtempMock = vi.hoisted(() => vi.fn());
const readFileMock = vi.hoisted(() => vi.fn());
const rmMock = vi.hoisted(() => vi.fn());
const writeFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  default: { execFile: execFileMock },
  execFile: execFileMock,
}));

vi.mock('node:fs/promises', () => ({
  default: {
    mkdtemp: mkdtempMock,
    readFile: readFileMock,
    rm: rmMock,
    writeFile: writeFileMock,
  },
  mkdtemp: mkdtempMock,
  readFile: readFileMock,
  rm: rmMock,
  writeFile: writeFileMock,
}));

import { MAX_DOCUMENT_PAGES } from '@/lib/external-context/validation';
import { rasterizeExternalContextDocuments } from '@/services/external-context/document-rasterizer';

describe('rasterizeExternalContextDocuments', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    mkdtempMock.mockReset();
    readFileMock.mockReset();
    rmMock.mockReset();
    writeFileMock.mockReset();

    execFileMock.mockImplementation((_cmd, _args, callback) => callback(null, '', ''));
    mkdtempMock.mockResolvedValue('/tmp/omniscribe-doc-test');
    readFileMock.mockImplementation(async (file: string) => Buffer.from(`png:${file}`));
    rmMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
  });

  it('renders multi-page PDFs up to the configured page image cap', async () => {
    const pdf = Buffer.from(
      Array.from({ length: MAX_DOCUMENT_PAGES + 2 }, () => '/Type /Page ').join(''),
      'latin1',
    );

    const result = await rasterizeExternalContextDocuments([
      { bytes: pdf, mimeType: 'application/pdf', label: 'packet' },
    ]);

    expect(result.pageCount).toBe(MAX_DOCUMENT_PAGES + 2);
    expect(result.images).toHaveLength(MAX_DOCUMENT_PAGES);
    expect(result.images.map((image) => image.sourcePage)).toEqual(
      Array.from({ length: MAX_DOCUMENT_PAGES }, (_, index) => index + 1),
    );
    expect(result.images.map((image) => image.label)).toEqual(
      Array.from({ length: MAX_DOCUMENT_PAGES }, (_, index) => `packet page ${index + 1}`),
    );
    expect(execFileMock).toHaveBeenCalledWith(
      'swift',
      expect.arrayContaining([
        '/tmp/omniscribe-doc-test/render.swift',
        '/tmp/omniscribe-doc-test/source.pdf',
        '/tmp/omniscribe-doc-test',
        '1',
        '2',
        '3',
      ]),
      expect.any(Function),
    );
  });
});
