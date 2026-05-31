import { createHash } from 'node:crypto';

import type { Prisma } from '@prisma/client';

type PrismaWriteClient = {
  externalContextDocumentPage: {
    upsert(args: Prisma.ExternalContextDocumentPageUpsertArgs): Prisma.PrismaPromise<unknown>;
  };
};

export type DocumentPageText = {
  fileIndex: number;
  pageNumber: number;
  text: string;
};

type RouterDecisionPageSource = {
  text: string;
  pageCount: number;
  pdfTextLayer?: {
    pages: Array<{ pageNumber: number; text: string }>;
  };
  ocrResult?: {
    text: string;
  };
};

export function splitTextIntoDocumentPages(
  text: string | null | undefined,
  options: { pageCount?: number | null; fileIndex?: number } = {},
): DocumentPageText[] {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return [];
  const fileIndex = options.fileIndex ?? 0;
  const pageMatches = [...trimmed.matchAll(/^Page\s+(\d+)\s*$/gim)];

  if (pageMatches.length === 0) {
    return [{
      fileIndex,
      pageNumber: 1,
      text: trimmed,
    }];
  }

  const pages: DocumentPageText[] = [];
  for (let i = 0; i < pageMatches.length; i += 1) {
    const match = pageMatches[i]!;
    const pageNumber = Number(match[1]);
    const start = match.index! + match[0].length;
    const end = pageMatches[i + 1]?.index ?? trimmed.length;
    const pageText = trimmed.slice(start, end).trim();
    pages.push({
      fileIndex,
      pageNumber: Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : i + 1,
      text: pageText,
    });
  }

  const pageCount = options.pageCount ?? pages.length;
  const byNumber = new Map(pages.map((page) => [page.pageNumber, page]));
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    if (!byNumber.has(pageNumber)) {
      byNumber.set(pageNumber, { fileIndex, pageNumber, text: '' });
    }
  }
  return [...byNumber.values()].sort((a, b) => a.pageNumber - b.pageNumber);
}

export function documentPagesFromRouterDecisions(
  decisions: RouterDecisionPageSource[],
): DocumentPageText[] {
  return decisions.flatMap((decision, fileIndex) => {
    if (decision.pdfTextLayer?.pages.length) {
      return decision.pdfTextLayer.pages.map((page) => ({
        fileIndex,
        pageNumber: page.pageNumber,
        text: page.text.trim(),
      }));
    }
    if (decision.ocrResult?.text) {
      return splitTextIntoDocumentPages(decision.ocrResult.text, {
        pageCount: decision.pageCount,
        fileIndex,
      });
    }
    return splitTextIntoDocumentPages(decision.text, {
      pageCount: decision.pageCount,
      fileIndex,
    });
  });
}

export function buildDocumentPageUpserts(args: {
  client: PrismaWriteClient;
  orgId: string;
  externalContextId: string;
  pages: DocumentPageText[];
  extractedAt?: Date | null;
  verifiedAt?: Date | null;
}): Array<Prisma.PrismaPromise<unknown>> {
  return args.pages.map((page) => {
    const text = page.text.trim();
    const textHash = hashPageText(text);
    return args.client.externalContextDocumentPage.upsert({
      where: {
        externalContextId_fileIndex_pageNumber: {
          externalContextId: args.externalContextId,
          fileIndex: page.fileIndex,
          pageNumber: page.pageNumber,
        },
      },
      create: {
        orgId: args.orgId,
        externalContextId: args.externalContextId,
        fileIndex: page.fileIndex,
        pageNumber: page.pageNumber,
        text,
        textHash,
        extractedAt: args.extractedAt ?? null,
        verifiedAt: args.verifiedAt ?? null,
      },
      update: {
        text,
        textHash,
        extractedAt: args.extractedAt ?? null,
        verifiedAt: args.verifiedAt ?? null,
      },
    });
  });
}

export function hashPageText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
