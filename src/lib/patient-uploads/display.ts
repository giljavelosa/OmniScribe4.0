import type { PatientUploadKind, PatientUploadStatus } from '@prisma/client';

export const UPLOAD_KIND_LABEL: Record<PatientUploadKind, string> = {
  MED_LIST: 'Medication list',
  LAB_REPORT: 'Lab report',
  IMAGING_REPORT: 'Imaging report',
  INSURANCE_CARD: 'Insurance card',
  ID_CARD: 'ID card',
  OUTSIDE_RECORDS: 'Outside records',
  OTHER: 'Other document',
};

/** Statuses where the clinician can Accept or Deny. */
export function uploadAwaitingReview(status: PatientUploadStatus): boolean {
  return status === 'EXTRACTED' || status === 'MANUAL_ONLY' || status === 'EXTRACTION_FAILED';
}

export function uploadIsProcessing(status: PatientUploadStatus): boolean {
  return status === 'PENDING_EXTRACTION' || status === 'EXTRACTING';
}

export function uploadStatusLabel(status: PatientUploadStatus): string {
  switch (status) {
    case 'PENDING_EXTRACTION':
    case 'EXTRACTING':
      return 'Reading photo…';
    case 'EXTRACTED':
    case 'MANUAL_ONLY':
      return 'Needs your review';
    case 'EXTRACTION_FAILED':
      return 'Could not read — review';
    case 'ATTESTED':
      return 'Accepted';
    case 'REJECTED':
      return 'Denied';
    default:
      return status;
  }
}

export function uploadStatusBadgeVariant(
  status: PatientUploadStatus,
): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (status === 'ATTESTED') return 'success';
  if (status === 'REJECTED') return 'neutral';
  if (uploadIsProcessing(status)) return 'info';
  if (uploadAwaitingReview(status)) return 'warning';
  return 'neutral';
}
