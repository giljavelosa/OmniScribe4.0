import { performance } from 'node:perf_hooks';

import { MAX_OCR_TEXT_CHARS } from '@/types/external-context-extraction';
import { extractPdfTextLayer, type PdfTextLayerResult } from './pdf-text';
import {
  decodeUtf8Text,
  parseCsvToText,
  parseDocxToText,
  parseJsonToText,
  parseRtfToText,
  parseXlsxToText,
  parseXmlToText,
} from './structured-file-text';
import { getOcrProvider, type OcrDocumentResult, type OcrProvider } from './ocr-provider';

export type ClinicalFileRoute =
  | 'image_fast_path'
  | 'pdf_text_layer'
  | 'pdf_ocr'
  | 'docx_text'
  | 'rtf_text'
  | 'txt_text'
  | 'csv_table'
  | 'xlsx_table'
  | 'xml_structured'
  | 'json_structured'
  | 'unsupported_manual_review';

export type FileRouterTiming = {
  uploadReceivedAt?: string;
  fileTypeDetectedAt?: string;
  textLayerCheckedAt?: string;
  textExtractionStartedAt?: string;
  textExtractionCompletedAt?: string;
  ocrJobSubmittedAt?: string;
  ocrJobCompletedAt?: string;
  normalizationCompletedAt?: string;
  clinicianReviewReadyAt?: string;
  ocrDurationMs: number;
  normalizationDurationMs: number;
  extractionDurationMs: number;
};

export type FileRouterDecision = {
  route: ClinicalFileRoute;
  fileType: string;
  mimeType: string;
  extension: string | null;
  pageCount: number;
  text: string;
  textLayerUsable: boolean;
  ocrUsed: boolean;
  unsupportedReason: string | null;
  progressStates: string[];
  timings: FileRouterTiming;
  pdfTextLayer?: PdfTextLayerResult;
  ocrResult?: OcrDocumentResult;
};

export type RouteClinicalFileInput = {
  documentId: string;
  bytes: Buffer;
  mimeType: string;
  fileName?: string;
  s3Object?: {
    bucket: string;
    key: string;
  };
  uploadReceivedAt?: Date;
  ocrProvider?: OcrProvider;
};

const TRUTHY_FLAGS = new Set(['1', 'true', 'yes', 'on']);

export function isFileRouterV2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return TRUTHY_FLAGS.has((env.OMNISCRIBE_FILE_ROUTER_V2 ?? '').toLowerCase());
}

export async function routeClinicalFile(input: RouteClinicalFileInput): Promise<FileRouterDecision> {
  const started = performance.now();
  const timings: FileRouterTiming = {
    uploadReceivedAt: input.uploadReceivedAt?.toISOString(),
    ocrDurationMs: 0,
    normalizationDurationMs: 0,
    extractionDurationMs: 0,
  };
  const progressStates = ['Uploaded', 'Detecting file type'];
  const detected = detectClinicalFileType(input.bytes, input.mimeType, input.fileName);
  timings.fileTypeDetectedAt = new Date().toISOString();

  if (detected.fileType === 'image') {
    timings.clinicianReviewReadyAt = new Date().toISOString();
    timings.extractionDurationMs = Math.round(performance.now() - started);
    return {
      route: 'image_fast_path',
      fileType: detected.fileType,
      mimeType: detected.mimeType,
      extension: detected.extension,
      pageCount: 1,
      text: '',
      textLayerUsable: false,
      ocrUsed: false,
      unsupportedReason: null,
      progressStates,
      timings,
    };
  }

  if (detected.fileType === 'pdf') {
    progressStates.push('Checking PDF text layer');
    const textStarted = performance.now();
    timings.textExtractionStartedAt = new Date().toISOString();
    const pdfText = extractPdfTextLayer(input.bytes);
    timings.textLayerCheckedAt = new Date().toISOString();
    timings.textExtractionCompletedAt = timings.textLayerCheckedAt;

    if (pdfText.textLayerUsable) {
      progressStates.push('Extracting text', 'Normalizing extracted content', 'Ready for clinician review');
      timings.normalizationCompletedAt = new Date().toISOString();
      timings.clinicianReviewReadyAt = timings.normalizationCompletedAt;
      timings.normalizationDurationMs = Math.round(performance.now() - textStarted);
      timings.extractionDurationMs = Math.round(performance.now() - started);
      return {
        route: 'pdf_text_layer',
        fileType: detected.fileType,
        mimeType: detected.mimeType,
        extension: detected.extension,
        pageCount: pdfText.pageCount,
        text: truncateText(pdfText.text),
        textLayerUsable: true,
        ocrUsed: false,
        unsupportedReason: null,
        progressStates,
        timings,
        pdfTextLayer: pdfText,
      };
    }

    progressStates.push('OCR running', 'Normalizing extracted content');
    const provider = input.ocrProvider ?? getOcrProvider();
    const ocrResult = await provider.extractDocumentText({
      documentId: input.documentId,
      bytes: input.bytes,
      mimeType: detected.mimeType,
      pageCount: pdfText.pageCount,
      s3Object: input.s3Object,
    });
    timings.ocrJobSubmittedAt = ocrResult.submittedAt.toISOString();
    timings.ocrJobCompletedAt = ocrResult.completedAt.toISOString();
    timings.ocrDurationMs = ocrResult.durationMs;
    timings.normalizationCompletedAt = new Date().toISOString();
    timings.clinicianReviewReadyAt = timings.normalizationCompletedAt;
    timings.extractionDurationMs = Math.round(performance.now() - started);
    progressStates.push('Ready for clinician review');
    return {
      route: 'pdf_ocr',
      fileType: detected.fileType,
      mimeType: detected.mimeType,
      extension: detected.extension,
      pageCount: pdfText.pageCount,
      text: truncateText(ocrResult.text),
      textLayerUsable: false,
      ocrUsed: true,
      unsupportedReason: null,
      progressStates,
      timings,
      pdfTextLayer: pdfText,
      ocrResult,
    };
  }

  const parsed = parseDirectTextRoute(detected.fileType, input.bytes);
  timings.textExtractionStartedAt = new Date().toISOString();
  timings.textExtractionCompletedAt = new Date().toISOString();
  timings.normalizationCompletedAt = timings.textExtractionCompletedAt;
  timings.clinicianReviewReadyAt = timings.normalizationCompletedAt;
  timings.extractionDurationMs = Math.round(performance.now() - started);

  return {
    route: parsed.route,
    fileType: detected.fileType,
    mimeType: detected.mimeType,
    extension: detected.extension,
    pageCount: 1,
    text: truncateText(parsed.text),
    textLayerUsable: parsed.route !== 'unsupported_manual_review',
    ocrUsed: false,
    unsupportedReason: parsed.unsupportedReason,
    progressStates: [
      ...progressStates,
      parsed.route === 'unsupported_manual_review' ? 'Failed or needs manual review' : 'Extracting text',
      'Normalizing extracted content',
      'Ready for clinician review',
    ],
    timings,
  };
}

export function detectClinicalFileType(
  bytes: Buffer,
  mimeTypeRaw: string,
  fileName?: string,
): { fileType: string; mimeType: string; extension: string | null } {
  const mimeType = normalizeMimeType(mimeTypeRaw);
  const extension = extensionFromName(fileName);
  const signature = bytes.subarray(0, 8);

  if (signature.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { fileType: 'pdf', mimeType: 'application/pdf', extension: extension ?? 'pdf' };
  }
  if (isImageSignature(signature) || mimeType.startsWith('image/')) {
    return { fileType: 'image', mimeType, extension };
  }
  if (mimeType === 'application/pdf' || extension === 'pdf') return { fileType: 'pdf', mimeType, extension };
  if (isDocx(mimeType, extension)) return { fileType: 'docx', mimeType, extension };
  if (isXlsx(mimeType, extension)) return { fileType: 'xlsx', mimeType, extension };
  if (mimeType === 'text/csv' || mimeType === 'application/csv' || extension === 'csv') {
    return { fileType: 'csv', mimeType, extension };
  }
  if (mimeType === 'application/json' || extension === 'json') return { fileType: 'json', mimeType, extension };
  if (mimeType === 'application/xml' || mimeType === 'text/xml' || extension === 'xml') {
    return { fileType: 'xml', mimeType, extension };
  }
  if (mimeType === 'application/rtf' || mimeType === 'text/rtf' || extension === 'rtf') {
    return { fileType: 'rtf', mimeType, extension };
  }
  if (mimeType === 'text/plain' || extension === 'txt') return { fileType: 'txt', mimeType, extension };
  return { fileType: 'unknown', mimeType, extension };
}

function parseDirectTextRoute(
  fileType: string,
  bytes: Buffer,
): { route: ClinicalFileRoute; text: string; unsupportedReason: string | null } {
  try {
    switch (fileType) {
      case 'txt':
        return { route: 'txt_text', text: decodeUtf8Text(bytes), unsupportedReason: null };
      case 'csv':
        return { route: 'csv_table', text: parseCsvToText(bytes), unsupportedReason: null };
      case 'json':
        return { route: 'json_structured', text: parseJsonToText(bytes), unsupportedReason: null };
      case 'xml':
        return { route: 'xml_structured', text: parseXmlToText(bytes), unsupportedReason: null };
      case 'rtf':
        return { route: 'rtf_text', text: parseRtfToText(bytes), unsupportedReason: null };
      case 'docx':
        return { route: 'docx_text', text: parseDocxToText(bytes), unsupportedReason: null };
      case 'xlsx':
        return { route: 'xlsx_table', text: parseXlsxToText(bytes), unsupportedReason: null };
      default:
        return {
          route: 'unsupported_manual_review',
          text: 'Unsupported file type. Manual review is required.',
          unsupportedReason: `Unsupported file type: ${fileType}`,
        };
    }
  } catch (err) {
    return {
      route: 'unsupported_manual_review',
      text: 'The file could not be parsed safely. Manual review is required.',
      unsupportedReason: err instanceof Error ? err.message : 'Unknown parser error',
    };
  }
}

function normalizeMimeType(value: string): string {
  const mimeType = value.split(';')[0]?.trim().toLowerCase() || 'application/octet-stream';
  return mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
}

function extensionFromName(fileName?: string): string | null {
  if (!fileName) return null;
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? null;
}

function isImageSignature(signature: Buffer): boolean {
  return (
    signature.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ||
    signature.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ||
    signature.subarray(0, 4).toString('latin1') === 'RIFF'
  );
}

function isDocx(mimeType: string, extension: string | null): boolean {
  return (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    extension === 'docx'
  );
}

function isXlsx(mimeType: string, extension: string | null): boolean {
  return (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    extension === 'xlsx'
  );
}

function truncateText(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_OCR_TEXT_CHARS) return trimmed;
  return trimmed.slice(0, MAX_OCR_TEXT_CHARS - 3).trimEnd() + '...';
}
