import {
  ExtractionJsonSchema,
  MAX_EXTRACTION_ITEMS_PER_GROUP,
  type ExtractionJson,
} from '@/types/external-context-extraction';

export type ReviewedExtractionBatchForMerge = {
  batchIndex: number;
  pageStart: number;
  pageEnd: number;
  ocrText: string | null;
  extractionJson: unknown;
  vettedExtractionJson: unknown;
};

export type MergedExtraction = {
  ocrText: string;
  extraction: ExtractionJson;
};

export function mergeReviewedExtractionBatches(
  batches: ReviewedExtractionBatchForMerge[],
): MergedExtraction {
  const ordered = [...batches].sort((a, b) => a.batchIndex - b.batchIndex);
  if (ordered.length === 0) {
    throw new Error('Cannot merge document extraction: no reviewed batches.');
  }

  const extractions = ordered.map((batch) => ({
    batch,
    extraction: ExtractionJsonSchema.parse(batch.vettedExtractionJson ?? batch.extractionJson),
  }));

  const ocrText = ordered
    .map((batch) => {
      const label = `Pages ${batch.pageStart}-${batch.pageEnd}`;
      return [label, batch.ocrText ?? ''].filter(Boolean).join('\n');
    })
    .join('\n\n')
    .trim();

  const summaries = extractions
    .map(({ batch, extraction }) => `Pages ${batch.pageStart}-${batch.pageEnd}: ${extraction.summary}`)
    .filter((summary) => summary.trim().length > 0);
  const notes = extractions
    .map(({ batch, extraction }) =>
      extraction.extractionNotes
        ? `Pages ${batch.pageStart}-${batch.pageEnd}: ${extraction.extractionNotes}`
        : null,
    )
    .filter((note): note is string => Boolean(note));
  notes.push(`Merged from ${ordered.length} clinician-reviewed extraction batch${ordered.length === 1 ? '' : 'es'}.`);

  const firstExtraction = extractions[0]!.extraction;
  const firstNonIllegible = extractions.find(({ extraction }) => extraction.documentType !== 'illegible')
    ?.extraction;

  return {
    ocrText,
    extraction: ExtractionJsonSchema.parse({
      documentType: firstNonIllegible?.documentType ?? firstExtraction.documentType,
      summary: truncateForField(summaries.join('\n'), 2_000) || 'Clinician-reviewed document extraction.',
      diagnoses: capItems(extractions.flatMap(({ extraction }) => extraction.diagnoses)),
      medications: capItems(extractions.flatMap(({ extraction }) => extraction.medications)),
      allergies: capItems(extractions.flatMap(({ extraction }) => extraction.allergies)),
      labs: capItems(extractions.flatMap(({ extraction }) => extraction.labs)),
      vitals: capItems(extractions.flatMap(({ extraction }) => extraction.vitals)),
      procedures: capItems(extractions.flatMap(({ extraction }) => extraction.procedures)),
      documentDateGuess: extractions.find(({ extraction }) => extraction.documentDateGuess)
        ?.extraction.documentDateGuess ?? null,
      extractionNotes: truncateForField(notes.join('\n'), 1_000) || null,
    }),
  };
}

function capItems<T>(items: T[]): T[] {
  return items.slice(0, MAX_EXTRACTION_ITEMS_PER_GROUP);
}

function truncateForField(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, Math.max(0, max - 3)).trimEnd() + '...';
}
