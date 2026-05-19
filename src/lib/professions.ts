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

/** Profession values offered in the profile-completion picker. OTHER is
 *  intentionally excluded — recording clinicians must pick a concrete
 *  profession because note division is derived from it. Legacy rows with
 *  professionType=OTHER are gated by `requiresProfileCompletion` and routed
 *  back to /onboarding/profile to make a concrete choice. */
export const PROFESSION_OPTIONS: Profession[] = (Object.keys(LABELS) as Profession[]).filter(
  (p) => p !== Profession.OTHER,
);

/** Profession → Division. Load-bearing at recording start: a note's division
 *  is derived from the recording clinician's profession, NOT from the patient.
 *  OTHER maps to null and is blocked at the profile-completion gate — clinicians
 *  must choose a concrete profession before they can record. */
export const PROFESSION_TO_DIVISION: Record<Profession, Division | null> = {
  [Profession.MD]: Division.MEDICAL,
  [Profession.DO]: Division.MEDICAL,
  [Profession.NP]: Division.MEDICAL,
  [Profession.PA]: Division.MEDICAL,
  [Profession.RN]: Division.MEDICAL,
  [Profession.OT]: Division.REHAB,
  [Profession.PT]: Division.REHAB,
  [Profession.SLP]: Division.REHAB,
  [Profession.LCSW]: Division.BEHAVIORAL_HEALTH,
  [Profession.LMFT]: Division.BEHAVIORAL_HEALTH,
  [Profession.LPC]: Division.BEHAVIORAL_HEALTH,
  [Profession.PSYCHOLOGIST]: Division.BEHAVIORAL_HEALTH,
  [Profession.OTHER]: null,
};

export function divisionForProfession(p: Profession | null): Division | null {
  if (!p) return null;
  return PROFESSION_TO_DIVISION[p];
}
