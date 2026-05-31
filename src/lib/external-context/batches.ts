import {
  DOCUMENT_EXTRACTION_BATCH_SIZE,
  MAX_DOCUMENT_PAGES,
} from '@/lib/external-context/validation';

export type ExtractionBatchRange = {
  batchIndex: number;
  pageStart: number;
  pageEnd: number;
};

export function buildExtractionBatchRanges(pageCount: number): ExtractionBatchRange[] {
  const boundedPageCount = Math.min(Math.max(0, pageCount), MAX_DOCUMENT_PAGES);
  const ranges: ExtractionBatchRange[] = [];
  for (let pageStart = 1; pageStart <= boundedPageCount; pageStart += DOCUMENT_EXTRACTION_BATCH_SIZE) {
    ranges.push({
      batchIndex: ranges.length,
      pageStart,
      pageEnd: Math.min(pageStart + DOCUMENT_EXTRACTION_BATCH_SIZE - 1, boundedPageCount),
    });
  }
  return ranges;
}

export function pagesCoveredByReviewedBatches(
  batches: Array<{ pageStart: number; pageEnd: number; status: string }>,
): number {
  return batches
    .filter((batch) => batch.status === 'REVIEWED')
    .reduce((sum, batch) => sum + Math.max(0, batch.pageEnd - batch.pageStart + 1), 0);
}
