/**
 * Unit 49 — Case-division access gate.
 *
 * The immutable rule: cases are defined by ICD codes AND division. A
 * clinician of one profession (mapped to a division — REHAB / MEDICAL /
 * BEHAVIORAL_HEALTH) may not record audio, attach transcripts, or sign
 * notes against a case stamped to a different division. `MULTI` cases
 * are the rare escape hatch and pass the gate.
 *
 * `assertCanContinueCase` is the single helper that enforces the rule
 * at every API write boundary (`case-router/accept`, edit-case,
 * continue-case, future routes that mutate or attach to a case). The
 * caller catches `CaseDivisionDeniedError` and translates to a 403
 * response plus a `CASE_DIVISION_BLOCKED` audit row — never wrapped in
 * a swallowing try-catch (rule 8).
 *
 * Read-side filtering (case picker, cases panel, home dashboard) is a
 * separate concern handled in those queries directly (`division IN
 * (viewerDivision, 'MULTI')`). This helper is for the write boundary.
 */

import type { CaseManagement, FollowUp, OrgUser } from '@prisma/client';

export class CaseDivisionDeniedError extends Error {
  readonly caseId: string;
  readonly caseDivision: string;
  readonly clinicianDivision: string;

  constructor(
    caseId: string,
    caseDivision: string,
    clinicianDivision: string,
  ) {
    super(
      `Clinician division ${clinicianDivision} cannot continue case ${caseId} (division ${caseDivision})`,
    );
    this.name = 'CaseDivisionDeniedError';
    this.caseId = caseId;
    this.caseDivision = caseDivision;
    this.clinicianDivision = clinicianDivision;
  }
}

/**
 * Assert that a clinician's division permits them to continue (write
 * to / attach a visit to / sign against) a given case.
 *
 * - `MULTI` cases pass for any clinician.
 * - Same-division match passes.
 * - All other combinations throw `CaseDivisionDeniedError`.
 *
 * The error includes the case id and both divisions so the caller can
 * build a PHI-free `CASE_DIVISION_BLOCKED` audit row.
 */
export function assertCanContinueCase(
  c: Pick<CaseManagement, 'id' | 'division'>,
  clinician: Pick<OrgUser, 'division'>,
): void {
  if (c.division === 'MULTI') return;
  if (clinician.division === c.division) return;
  throw new CaseDivisionDeniedError(c.id, c.division, clinician.division);
}

// ---------------------------------------------------------------------------
// PR2 — Follow-up division gate.
//
// Same shape as the case gate but for FollowUp.division. A different-
// division clinician must not be able to mark another division's
// commitment as MET / DROPPED / CARRIED. The triage route catches the
// error and emits the same `CASE_DIVISION_BLOCKED` audit row with
// metadata.route='followup-triage' as the discriminator so an auditor
// can query both case- and follow-up-side blocks from one action type.
// ---------------------------------------------------------------------------

export class FollowUpDivisionDeniedError extends Error {
  readonly followUpId: string;
  readonly followUpDivision: string;
  readonly clinicianDivision: string;

  constructor(
    followUpId: string,
    followUpDivision: string,
    clinicianDivision: string,
  ) {
    super(
      `Clinician division ${clinicianDivision} cannot triage follow-up ${followUpId} (division ${followUpDivision})`,
    );
    this.name = 'FollowUpDivisionDeniedError';
    this.followUpId = followUpId;
    this.followUpDivision = followUpDivision;
    this.clinicianDivision = clinicianDivision;
  }
}

/**
 * Assert that a clinician's division permits them to triage (MET / DROPPED
 * / CARRIED) a follow-up. Same semantics as `assertCanContinueCase` but
 * for `FollowUp` rows:
 *
 * - `MULTI` follow-ups pass for any clinician.
 * - Same-division match passes.
 * - All other combinations throw `FollowUpDivisionDeniedError`.
 *
 * The error includes the follow-up id + both divisions so the caller can
 * build a PHI-free `CASE_DIVISION_BLOCKED` audit row (the shared action
 * keeps the auditor's lens for cross-division write attempts unified).
 */
export function assertCanTriageFollowUp(
  f: Pick<FollowUp, 'id' | 'division'>,
  clinician: Pick<OrgUser, 'division'>,
): void {
  if (f.division === 'MULTI') return;
  if (clinician.division === f.division) return;
  throw new FollowUpDivisionDeniedError(f.id, f.division, clinician.division);
}
