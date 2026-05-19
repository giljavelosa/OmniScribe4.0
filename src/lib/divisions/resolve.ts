import { Division, Profession } from '@prisma/client';

import { divisionForProfession } from '@/lib/professions';

/**
 * Resolves which division a note belongs to. Locked at recording start.
 *
 *   1. PROFESSION_TO_DIVISION[clinician.professionType] — the recording
 *      clinician's profession is the primary determinant. An MD records
 *      Medical notes, a PT records Rehab notes, etc.
 *   2. If professionType maps to null (only OTHER) → fall through to
 *      clinician.division (the value the clinician picked at profile
 *      completion). The profile-completion gate refuses OTHER, so this
 *      branch is reachable only for legacy rows or admin-bypass edits.
 *   3. Final safety net (clinician.division also missing): org.defaultDivision
 *      → org.division when non-MULTI. Throws if no division can be derived.
 *
 * Pure + side-effect free so it can be unit-tested + invoked from anywhere.
 */

export type OrgLike = Pick<
  { division: Division; defaultDivision: Division | null },
  'division' | 'defaultDivision'
>;

export type ClinicianLike = {
  professionType: Profession | null;
  division: Division | null;
};

export class DivisionResolutionError extends Error {
  constructor(public readonly code: 'profession_other_blocked' | 'no_division_resolvable') {
    super(code);
    this.name = 'DivisionResolutionError';
  }
}

export function resolveDivisionForNote(args: {
  clinician: ClinicianLike;
  org: OrgLike;
}): Division {
  const fromProfession = divisionForProfession(args.clinician.professionType);
  if (fromProfession) return fromProfession;

  if (args.clinician.professionType === Profession.OTHER) {
    throw new DivisionResolutionError('profession_other_blocked');
  }

  if (args.clinician.division && args.clinician.division !== Division.MULTI) {
    return args.clinician.division;
  }

  if (args.org.defaultDivision) return args.org.defaultDivision;
  if (args.org.division !== Division.MULTI) return args.org.division;

  throw new DivisionResolutionError('no_division_resolvable');
}
