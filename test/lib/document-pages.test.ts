import { describe, expect, it } from 'vitest';

import {
  documentPagesFromRouterDecisions,
  splitTextIntoDocumentPages,
} from '@/lib/external-context/document-pages';

describe('document page text utilities', () => {
  it('splits extracted text into first-class page rows', () => {
    const pages = splitTextIntoDocumentPages('File 1 route=pdf_text_layer\nPage 1\nAlpha\n\nPage 2\nBeta', {
      pageCount: 2,
    });

    expect(pages).toEqual([
      { fileIndex: 0, pageNumber: 1, text: 'Alpha' },
      { fileIndex: 0, pageNumber: 2, text: 'Beta' },
    ]);
  });

  it('preserves empty missing pages up to pageCount', () => {
    const pages = splitTextIntoDocumentPages('Page 2\nOnly page two', {
      pageCount: 3,
    });

    expect(pages.map((page) => page.pageNumber)).toEqual([1, 2, 3]);
    expect(pages[0]?.text).toBe('');
    expect(pages[1]?.text).toBe('Only page two');
  });

  it('prefers router PDF text-layer pages over truncated aggregate text', () => {
    const pages = documentPagesFromRouterDecisions([
      {
        text: 'Page 1\ntruncated',
        pageCount: 2,
        pdfTextLayer: {
          pages: [
            { pageNumber: 1, text: 'Full page one text' },
            { pageNumber: 2, text: 'Full page two text' },
          ],
        },
      },
    ]);

    expect(pages).toEqual([
      { fileIndex: 0, pageNumber: 1, text: 'Full page one text' },
      { fileIndex: 0, pageNumber: 2, text: 'Full page two text' },
    ]);
  });
});
