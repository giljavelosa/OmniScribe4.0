import { Division } from '@prisma/client';

/**
 * Resolves which division a note belongs to (spec §E + context/project-
 * overview.md "Multi-division model"). Locked at recording start in Unit 05.
 *
 *   1. If the encounter is tied to an EpisodeOfCare → episode.division.
 *   2. Else if the org's division is not MULTI → org.division.
 *   3. Else fall back to org.defaultDivision; if absent, patient.division.
 *
 * The resolver is pure and side-effect free so it can be unit-tested + invoked
 * from anywhere (worker, API route, RSC).
 */

export type OrgLike = Pick<{ division: Division; defaultDivision: Division | null }, 'division' | 'defaultDivision'>;
export type EpisodeLike = Pick<{ division: Division }, 'division'>;
export type PatientLike = Pick<{ division: Division }, 'division'>;

export function resolveDivisionForNote(args: {
  patient: PatientLike;
  episode: EpisodeLike | null;
  org: OrgLike;
}): Division {
  if (args.episode) return args.episode.division;
  if (args.org.division !== Division.MULTI) return args.org.division;
  return args.org.defaultDivision ?? args.patient.division;
}
