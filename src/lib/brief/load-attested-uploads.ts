import type { PatientUploadKind } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { UPLOAD_KIND_LABEL } from '@/lib/patient-uploads/display';
import type { BriefAttestedUploadProjection } from '@/lib/notes/build-brief-prompt';

export const MAX_BRIEF_ATTESTED_UPLOADS = 5;

export type { BriefAttestedUploadProjection };

function summarizeAttestedJson(kind: PatientUploadKind, json: unknown): string {
  if (!json || typeof json !== 'object') return '(no structured fields)';
  const o = json as Record<string, unknown>;
  if (kind === 'MED_LIST' && Array.isArray(o.medications)) {
    return (o.medications as Array<{ name?: string }>)
      .map((m) => m.name)
      .filter(Boolean)
      .slice(0, 12)
      .join('; ');
  }
  if (kind === 'LAB_REPORT' && Array.isArray(o.labs)) {
    return (o.labs as Array<{ name?: string; value?: string }>)
      .map((l) => `${l.name ?? '?'}=${l.value ?? '?'}`)
      .slice(0, 12)
      .join('; ');
  }
  if (kind === 'IMAGING_REPORT') {
    return [o.studyType, o.impression, o.findings]
      .filter((x) => typeof x === 'string')
      .join(' · ')
      .slice(0, 500);
  }
  if (kind === 'INSURANCE_CARD') {
    return [o.carrier, o.memberId, o.planName].filter((x) => typeof x === 'string').join(' · ');
  }
  if (kind === 'ID_CARD') {
    return [o.firstName, o.lastName, o.dob].filter((x) => typeof x === 'string').join(' · ');
  }
  if (kind === 'OUTSIDE_RECORDS' && typeof o.summary === 'string') {
    return o.summary.slice(0, 500);
  }
  return JSON.stringify(json).slice(0, 500);
}

/**
 * Load clinician-attested PatientUpload rows for brief generation.
 * Rule 20 — only ATTESTED status; never EXTRACTED or REJECTED.
 */
export async function loadAttestedUploadsForBrief(args: {
  patientId: string;
  orgId: string;
}): Promise<BriefAttestedUploadProjection[]> {
  const rows = await prisma.patientUpload.findMany({
    where: {
      patientId: args.patientId,
      orgId: args.orgId,
      status: 'ATTESTED',
      isDeleted: false,
    },
    orderBy: { attestedAt: 'desc' },
    take: MAX_BRIEF_ATTESTED_UPLOADS,
    select: {
      id: true,
      kind: true,
      attestedAt: true,
      captureContext: true,
      attestedJson: true,
    },
  });

  return rows
    .filter((r) => r.attestedAt)
    .map((r) => ({
      uploadId: r.id,
      kind: r.kind,
      kindLabel: UPLOAD_KIND_LABEL[r.kind],
      attestedAtIso: r.attestedAt!.toISOString(),
      captureContext: r.captureContext,
      findingsSummary: summarizeAttestedJson(r.kind, r.attestedJson),
    }));
}
