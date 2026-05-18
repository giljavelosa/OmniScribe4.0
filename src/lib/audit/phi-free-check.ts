/**
 * PHI denylist — scans audit-log metadata keys for known PHI fields and
 * throws if found. Defense in depth: even if a future contributor forgets
 * the rule, the writer rejects.
 *
 * Anti-regression rule 8: audit log writes NEVER wrapped in try-catch that
 * silently swallows errors.
 */

const PHI_KEY_DENYLIST = new Set([
  'dob',
  'dateofbirth',
  'birthdate',
  'mrn',
  'medicalrecordnumber',
  'ssn',
  'firstname',
  'lastname',
  'fullname',
  'patientname',
  'patient_name',
  'notecontent',
  'note_content',
  'transcript',
  'transcripttext',
  'audiosegment',
  'audiokey',
  'address',
  'streetaddress',
  'phone',
  'phonenumber',
]);

export class PhiInAuditMetadataError extends Error {
  constructor(key: string) {
    super(`Audit-log metadata may not contain PHI key "${key}". (Rule 8 + Audit Logging.)`);
    this.name = 'PhiInAuditMetadataError';
  }
}

export function assertPhiFreeMetadata(metadata: unknown): void {
  if (metadata == null) return;
  if (typeof metadata !== 'object') return;
  for (const rawKey of Object.keys(metadata as Record<string, unknown>)) {
    const norm = rawKey.toLowerCase().replace(/[-_\s]/g, '');
    if (PHI_KEY_DENYLIST.has(norm)) throw new PhiInAuditMetadataError(rawKey);
  }
}
