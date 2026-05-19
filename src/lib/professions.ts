import { Profession, Division } from '@prisma/client';

/** Display labels keyed by the categorical Profession enum. Keep terse —
 *  used in selects + admin tables. Sub-specialty detail lives in the
 *  free-text `OrgUser.profession` field. */
const LABELS: Record<Profession, string> = {
  [Profession.MD]: 'Physician (MD)',
  [Profession.DO]: 'Physician (DO)',
  [Profession.NP]: 'Nurse Practitioner (NP)',
  [Profession.PA]: 'Physician Assistant (PA)',
  [Profession.OT]: 'Occupational Therapist (OT)',
  [Profession.PT]: 'Physical Therapist (PT)',
  [Profession.SLP]: 'Speech-Language Pathologist (SLP)',
  [Profession.LCSW]: 'Licensed Clinical Social Worker (LCSW)',
  [Profession.LMFT]: 'Licensed Marriage & Family Therapist (LMFT)',
  [Profession.LPC]: 'Licensed Professional Counselor (LPC)',
  [Profession.PSYCHOLOGIST]: 'Psychologist',
  [Profession.RN]: 'Registered Nurse (RN)',
  [Profession.OTHER]: 'Other',
};

export function professionLabel(p: Profession): string {
  return LABELS[p];
}

/** Concrete divisions a clinician can pick at signup / profile-completion.
 *  MULTI is intentionally excluded — it's an org-aggregate value that
 *  shouldn't be a per-clinician choice. */
export const CLINICIAN_PICKABLE_DIVISIONS: Division[] = [
  Division.MEDICAL,
  Division.REHAB,
  Division.BEHAVIORAL_HEALTH,
];

/** All Profession enum values in display order (matches LABELS object key
 *  insertion order). Useful for rendering `<select>` options. */
export const PROFESSION_OPTIONS: Profession[] = Object.keys(LABELS) as Profession[];
