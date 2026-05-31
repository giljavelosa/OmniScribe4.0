/**
 * External-context shared validation helpers.
 *
 * Spec: context/specs/external-context-upload.md §Endpoints.
 *
 * dateOfRecord rules:
 *   - MUST parse to a valid Date
 *   - MUST be ≤ today (an event in the future is nonsense — prior context
 *     is by definition past)
 *   - MUST be ≥ patient.createdAt - 5 years (sanity bound; prior context
 *     older than that is implausible and almost always a data-entry error)
 *
 * Returns a discriminated result so the caller can render a precise error
 * message in the UI. The parsed Date is the canonical write value.
 */

export const MAX_TRANSCRIPT_BYTES = 200 * 1024; // 200 KB
export const MAX_AUDIO_BYTES = 200 * 1024 * 1024; // 200 MB
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MB per original
export const MAX_DOCUMENT_FILES = 5;
export const MAX_DOCUMENT_PAGES = 100;
export const DOCUMENT_EXTRACTION_BATCH_SIZE = 5;

export const ALLOWED_AUDIO_MIME = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/aac',
]);

export const ALLOWED_DOCUMENT_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

export const ALLOWED_ROUTER_V2_DOCUMENT_MIME = new Set([
  ...ALLOWED_DOCUMENT_MIME,
  'text/plain',
  'text/csv',
  'application/csv',
  'application/json',
  'text/xml',
  'application/xml',
  'text/rtf',
  'application/rtf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export const SANITY_BACKDATE_YEARS = 5;

export type DateValidationResult =
  | { ok: true; parsed: Date }
  | { ok: false; error: string };

/**
 * Parse + range-check a dateOfRecord string against a patient's earliest
 * plausible event window. Returns a structured result; never throws.
 *
 * Comparison is calendar-day-only (in UTC) so a YYYY-MM-DD picker value
 * doesn't shift past/future on TZ boundaries. The persisted Date is the
 * UTC midnight of the picked day.
 *
 * `now` parameter exists so tests can pin the clock — production callers
 * pass `new Date()` (the default).
 */
export function validateDateOfRecord(
  raw: string,
  patientCreatedAt: Date,
  now: Date = new Date(),
): DateValidationResult {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, error: 'Date of underlying event is not a valid date.' };
  }
  // Project parsed + now + sanity floor to UTC day-keys for comparison so
  // the picker's "2026-05-19" is never accepted when "today" is 2026-05-18
  // regardless of the server's local time zone.
  const parsedDayKey = utcDayKey(parsed);
  const todayDayKey = utcDayKey(now);
  if (parsedDayKey > todayDayKey) {
    return { ok: false, error: 'Date of underlying event must be on or before today.' };
  }
  const sanityFloor = new Date(patientCreatedAt);
  sanityFloor.setUTCFullYear(sanityFloor.getUTCFullYear() - SANITY_BACKDATE_YEARS);
  const sanityFloorKey = utcDayKey(sanityFloor);
  if (parsedDayKey < sanityFloorKey) {
    return {
      ok: false,
      error: `Date of underlying event is more than ${SANITY_BACKDATE_YEARS} years before this patient was added. Double-check the date.`,
    };
  }
  return { ok: true, parsed };
}

/** YYYYMMDD integer key for UTC-day comparison. */
function utcDayKey(d: Date): number {
  return d.getUTCFullYear() * 10_000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

/**
 * Pick a file extension for the S3 key given a MIME type. Defaults to wav
 * because Soniox handles it reliably.
 */
export function extensionFromMime(mime: string): string {
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a';
  return 'wav';
}

export function extensionFromDocumentMime(mime: string): string {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'text/plain') return 'txt';
  if (mime === 'text/csv' || mime === 'application/csv') return 'csv';
  if (mime === 'application/json') return 'json';
  if (mime === 'text/xml' || mime === 'application/xml') return 'xml';
  if (mime === 'text/rtf' || mime === 'application/rtf') return 'rtf';
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  return 'bin';
}
