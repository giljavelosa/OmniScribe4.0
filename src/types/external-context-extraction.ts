import { z } from 'zod';

export const MAX_EXTRACTION_ITEMS_PER_GROUP = 100;
export const MAX_EXTRACTION_SOURCE_PAGE = 100;
export const MAX_OCR_TEXT_CHARS = 100_000;
export const MAX_VERBATIM_CHARS = 1_000;

export const ExtractionDocumentTypeSchema = z.enum([
  'lab_report',
  'referral_letter',
  'discharge_summary',
  'progress_note',
  'imaging_report',
  'medication_list',
  'other',
  'illegible',
]);
export type ExtractionDocumentType = z.infer<typeof ExtractionDocumentTypeSchema>;

export const ExtractionConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type ExtractionConfidence = z.infer<typeof ExtractionConfidenceSchema>;

export const ExtractionProvenanceSchema = z
  .object({
    sourcePage: z.number().int().min(1).max(MAX_EXTRACTION_SOURCE_PAGE),
    confidence: ExtractionConfidenceSchema,
    verbatim: z.string().min(1).max(MAX_VERBATIM_CHARS),
  })
  .strict();
export type ExtractionProvenance = z.infer<typeof ExtractionProvenanceSchema>;

export const ExtractedDiagnosisSchema = ExtractionProvenanceSchema.extend({
  text: z.string().min(1).max(500),
  icdHint: z.string().min(1).max(32).nullable(),
  status: z.enum(['active', 'historical', 'resolved', 'suspected', 'ruled_out', 'unknown']),
}).strict();
export type ExtractedDiagnosis = z.infer<typeof ExtractedDiagnosisSchema>;

export const ExtractedMedicationSchema = ExtractionProvenanceSchema.extend({
  name: z.string().min(1).max(250),
  dose: z.string().min(1).max(120).nullable(),
  route: z.string().min(1).max(120).nullable(),
  frequency: z.string().min(1).max(160).nullable(),
  status: z.enum(['current', 'discontinued', 'historical', 'planned', 'unknown']),
}).strict();
export type ExtractedMedication = z.infer<typeof ExtractedMedicationSchema>;

export const ExtractedAllergySchema = ExtractionProvenanceSchema.extend({
  substance: z.string().min(1).max(250),
  reaction: z.string().min(1).max(300).nullable(),
  severity: z.enum(['mild', 'moderate', 'severe', 'unknown']).nullable(),
}).strict();
export type ExtractedAllergy = z.infer<typeof ExtractedAllergySchema>;

export const ExtractedLabSchema = ExtractionProvenanceSchema.extend({
  name: z.string().min(1).max(250),
  value: z.string().min(1).max(120),
  unit: z.string().min(1).max(80).nullable(),
  referenceRange: z.string().min(1).max(160).nullable(),
  abnormalFlag: z.enum(['normal', 'high', 'low', 'abnormal', 'critical', 'unknown']).nullable(),
  collectedDate: z.string().min(1).max(80).nullable(),
}).strict();
export type ExtractedLab = z.infer<typeof ExtractedLabSchema>;

export const ExtractedVitalSchema = ExtractionProvenanceSchema.extend({
  type: z.string().min(1).max(160),
  value: z.string().min(1).max(120),
  unit: z.string().min(1).max(80).nullable(),
  measuredDate: z.string().min(1).max(80).nullable(),
}).strict();
export type ExtractedVital = z.infer<typeof ExtractedVitalSchema>;

export const ExtractedProcedureSchema = ExtractionProvenanceSchema.extend({
  text: z.string().min(1).max(500),
  date: z.string().min(1).max(80).nullable(),
}).strict();
export type ExtractedProcedure = z.infer<typeof ExtractedProcedureSchema>;

export const ExtractionJsonSchema = z
  .object({
    documentType: ExtractionDocumentTypeSchema,
    summary: z.string().min(1).max(2_000),
    diagnoses: z.array(ExtractedDiagnosisSchema).max(MAX_EXTRACTION_ITEMS_PER_GROUP),
    medications: z.array(ExtractedMedicationSchema).max(MAX_EXTRACTION_ITEMS_PER_GROUP),
    allergies: z.array(ExtractedAllergySchema).max(MAX_EXTRACTION_ITEMS_PER_GROUP),
    labs: z.array(ExtractedLabSchema).max(MAX_EXTRACTION_ITEMS_PER_GROUP),
    vitals: z.array(ExtractedVitalSchema).max(MAX_EXTRACTION_ITEMS_PER_GROUP),
    procedures: z.array(ExtractedProcedureSchema).max(MAX_EXTRACTION_ITEMS_PER_GROUP),
    documentDateGuess: z.string().min(1).max(80).nullable(),
    extractionNotes: z.string().min(1).max(1_000).nullable(),
  })
  .strict();
export type ExtractionJson = z.infer<typeof ExtractionJsonSchema>;

export const ExtractionEnvelopeSchema = z
  .object({
    ocrText: z.string().min(1).max(MAX_OCR_TEXT_CHARS),
    extraction: ExtractionJsonSchema,
  })
  .strict();
export type ExtractionEnvelope = z.infer<typeof ExtractionEnvelopeSchema>;

export function isExtractionEnvelope(value: unknown): value is ExtractionEnvelope {
  return ExtractionEnvelopeSchema.safeParse(value).success;
}
