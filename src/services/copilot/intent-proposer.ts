/**
 * Unit 48 PR1 — Miss Cleo's visit-type intent proposer.
 *
 * Pure deterministic calculator (NO LLM call) that takes a snapshot of
 * patient + episode + schedule + prior-note state and returns the most
 * likely clinical intent for the encounter about to be created. The
 * `<StartVisitDialog>` reads this and renders an intent chip Cleo proposes
 * to the clinician; the clinician confirms or overrides.
 *
 * Decision 6 in the spec: this is deterministic by design.
 * - Sub-millisecond response (no network call)
 * - $0 cost (no LLM token spend)
 * - Unit-testable per branch
 * - Predictable across deploys (no model-version drift)
 *
 * Source rules: references/visit-type-taxonomy.md §3.2 (REHAB), §4.2 (BH),
 * §5.2 (MEDICAL). CMS Pub. 100-02 Ch. 15 §220.3 governs the REHAB cadence
 * (Progress Note every 10 visits OR 30 days, whichever first).
 *
 * Out of scope for this proposer:
 *   - LLM-based intent inference (deferred; deterministic rules cover the
 *     90% case and the clinician overrides for the rest)
 *   - "Significant change" detection for REHAB_REEVAL (the input field
 *     `clinicianRequestedReeval` is the v1 signal; copilot-detected
 *     significant change lands in a follow-on unit)
 *   - Risk-escalation detection for BH_CRISIS_REASSESSMENT (same — input
 *     field signals it; auto-detection deferred)
 */

import type { Division } from '@prisma/client';
import { EncounterIntent } from '@prisma/client';

// =============================================================================
// Input shape — projected from the encounter-creation preflight queries.
// Caller (the API route) does the projection; the proposer is pure.
// =============================================================================

export type IntentProposalInput = {
  division: Division;
  /** Null when the patient has no episode-of-care (ad-hoc visit). */
  episode: IntentProposalEpisode | null;
  /** Oldest-first list of prior signed notes for THIS patient (and same
   *  episode when episode is non-null). Empty array = first encounter. */
  priorNotes: IntentProposalPriorNote[];
  /** Null when start-visit was triggered ad-hoc (not from a schedule row). */
  schedule: IntentProposalSchedule | null;
  /** Patient-level signals (Medicare eligibility, AWV cadence, hospital
   *  discharge proximity). Null when patient row not available; proposer
   *  degrades gracefully (those branches are skipped). */
  patient: IntentProposalPatient | null;
  /** Reserved for v2 — clinician explicitly requested a re-evaluation
   *  via UI before opening the start-visit dialog. v1 callers always
   *  pass false; the field exists so the calculator's signature is
   *  forward-compatible. */
  clinicianRequestedReeval?: boolean;
  /** Reserved for v2 — clinician explicitly requested discharge. */
  clinicianRequestedDischarge?: boolean;
};

export type IntentProposalEpisode = {
  status: 'ACTIVE' | 'RECERT_DUE' | 'DISCHARGED' | 'CANCELLED';
  visitsCompleted: number;
  startedAt: Date;
  recertDueAt: Date | null;
  /** ISO of the last signed note in this episode whose intent was
   *  REHAB_PROGRESS_NOTE — drives the "every 10 visits or 30 days"
   *  cadence. Null when no progress note has been written in this
   *  episode (first progress note is due as soon as the 10/30 threshold
   *  is hit, counting from episode start). */
  lastProgressNoteAt: Date | null;
  /** Visits completed since the most recent REHAB_PROGRESS_NOTE in this
   *  episode (counted across SIGNED + TRANSFERRED notes). Equals
   *  visitsCompleted when lastProgressNoteAt is null. */
  visitsSinceLastProgressNote: number;
};

export type IntentProposalPriorNote = {
  signedAt: Date;
  intent: EncounterIntent;
};

export type IntentProposalSchedule = {
  /** Free-text admin note on the schedule row. Heuristics on this drive
   *  the ACUTE / TELEHEALTH-checkin / SAME-DAY branches. */
  notes: string | null;
  /** Reserved for v2 — explicit schedule-template-driven intent. */
  templateIntent?: EncounterIntent | null;
};

export type IntentProposalPatient = {
  /** Drives MEDICAL_ANNUAL_WELLNESS proposal — AWV is a Medicare benefit. */
  medicareEligible: boolean;
  /** ISO of most recent AWV; null if patient has never had one. Drives the
   *  11-month "due now" window. */
  lastAWVAt: Date | null;
  /** ISO of most recent hospital discharge known to the system; null if
   *  unknown. Drives MEDICAL_DISCHARGE_TCM (≤14d window). */
  lastHospitalDischargeAt: Date | null;
  /** Whether the patient is enrolled in a Chronic Care Management
   *  program — drives MEDICAL_CHRONIC_CARE proposal. */
  enrolledInCCM: boolean;
  /** Days since this patient was last seen by ANY clinician in this org.
   *  Drives the MEDICAL_NEW_PATIENT 3-year window. Null when never seen
   *  (= first encounter ever; new-patient branch fires from priorNotes
   *  emptiness alone). */
  daysSinceLastSeenInGroup: number | null;
};

// =============================================================================
// Output shape — what the API returns + the chip renders.
// =============================================================================

export type IntentProposal = {
  intent: EncounterIntent;
  /** Human-readable cue for the chip subtitle. ~80 chars max; written to
   *  read naturally inline ("visit 10 of 30, last progress note at the
   *  eval"). Never PHI. */
  reason: string;
  /** Drives the dialog's behavior — `low` keeps the picker open by
   *  default; `medium`/`high` lets auto-post fire with the proposal. */
  confidence: 'high' | 'medium' | 'low';
};

// =============================================================================
// Cadence constants — Medicare/CMS-anchored. Centralized so a single
// audit-driven adjustment touches one place.
// =============================================================================

/** CMS Pub. 100-02 Ch. 15 §220.3 — Progress Report every 10 visits OR every
 *  30 calendar days, whichever is first. */
const REHAB_PROGRESS_VISIT_THRESHOLD = 10;
const REHAB_PROGRESS_DAYS_THRESHOLD = 30;

/** Most BH payers require Treatment Plan Review every 90 days. */
const BH_TPR_DAYS_THRESHOLD = 90;

/** Medicare AWV is annual — proposer fires at 11 months so the clinician
 *  has a buffer to schedule and bill within the calendar year. */
const MEDICAL_AWV_MONTHS_THRESHOLD = 11;

/** TCM (CPT 99495 / 99496) — first post-discharge contact must occur
 *  within 7 or 14 days of discharge. Proposer fires the wider window. */
const MEDICAL_TCM_DAYS_THRESHOLD = 14;

/** Medicare "new patient" definition — not seen in the same group in
 *  the prior 3 years (≈1095 days). */
const MEDICAL_NEW_PATIENT_DAYS_THRESHOLD = 1095;

/** Heuristic: schedule notes containing any of these words → ACUTE intent. */
const ACUTE_SCHEDULE_KEYWORDS = ['urgent', 'same-day', 'same day', 'acute', 'walk-in', 'walk in'];

// =============================================================================
// Public API — the calculator.
// =============================================================================

/**
 * Propose the clinical intent for the encounter about to be created.
 *
 * Pure function — same input always produces the same output. Branches per
 * `input.division`. Falls back to UNSPECIFIED + low confidence in the rare
 * case where division is MULTI or none of the division-specific branches
 * apply (defense — every branch below normally returns).
 */
export function proposeIntent(input: IntentProposalInput): IntentProposal {
  switch (input.division) {
    case 'REHAB':
      return proposeRehabIntent(input);
    case 'BEHAVIORAL_HEALTH':
      return proposeBehavioralHealthIntent(input);
    case 'MEDICAL':
      return proposeMedicalIntent(input);
    case 'MULTI':
    default:
      // MULTI-division clinicians don't get a confident proposal — the
      // clinician knows what they're doing today, we don't.
      return {
        intent: EncounterIntent.UNSPECIFIED,
        reason: 'multi-division clinician — pick the visit type',
        confidence: 'low',
      };
  }
}

// =============================================================================
// REHAB calculator — taxonomy §3.2
// =============================================================================

function proposeRehabIntent(input: IntentProposalInput): IntentProposal {
  if (input.priorNotes.length === 0) {
    return {
      intent: EncounterIntent.REHAB_INITIAL_EVAL,
      reason: 'first visit on file — Initial Evaluation',
      confidence: 'high',
    };
  }

  if (input.clinicianRequestedDischarge || rehabDischargeReady(input)) {
    return {
      intent: EncounterIntent.REHAB_DISCHARGE,
      reason: input.clinicianRequestedDischarge
        ? 'discharge requested'
        : 'episode discharged or ready for discharge',
      confidence: input.clinicianRequestedDischarge ? 'high' : 'medium',
    };
  }

  if (input.clinicianRequestedReeval) {
    return {
      intent: EncounterIntent.REHAB_REEVAL,
      reason: 'clinician requested re-evaluation',
      confidence: 'high',
    };
  }

  // Progress Note cadence per CMS Pub. 100-02 Ch. 15 §220.3:
  // every 10 visits OR every 30 days, whichever is first.
  if (input.episode) {
    const visitsSince = input.episode.visitsSinceLastProgressNote;
    const daysSince = input.episode.lastProgressNoteAt
      ? daysBetween(input.episode.lastProgressNoteAt, new Date())
      : daysBetween(input.episode.startedAt, new Date());
    if (
      visitsSince >= REHAB_PROGRESS_VISIT_THRESHOLD ||
      daysSince >= REHAB_PROGRESS_DAYS_THRESHOLD
    ) {
      const visitNum = input.episode.visitsCompleted + 1;
      const planned = visitNum;
      const reason = input.episode.lastProgressNoteAt
        ? `visit ${visitNum} · ${visitsSince} visits / ${daysSince} days since last Progress Note`
        : `visit ${visitNum} · first Progress Note for this episode (${daysSince}d in)`;
      // Suppress unused-var lint without changing logic; reserved for
      // chip "visit X of Y" rendering when authorization is populated.
      void planned;
      return {
        intent: EncounterIntent.REHAB_PROGRESS_NOTE,
        reason,
        confidence: 'high',
      };
    }
  }

  // Default — routine treatment visit.
  return {
    intent: EncounterIntent.REHAB_DAILY_NOTE,
    reason: input.episode
      ? `visit ${input.episode.visitsCompleted + 1} · routine treatment`
      : 'routine treatment',
    confidence: 'high',
  };
}

function rehabDischargeReady(input: IntentProposalInput): boolean {
  if (!input.episode) return false;
  return (
    input.episode.status === 'DISCHARGED' || input.episode.status === 'CANCELLED'
  );
}

// =============================================================================
// BEHAVIORAL_HEALTH calculator — taxonomy §4.2
// =============================================================================

function proposeBehavioralHealthIntent(input: IntentProposalInput): IntentProposal {
  if (input.priorNotes.length === 0) {
    return {
      intent: EncounterIntent.BH_INITIAL_ASSESSMENT,
      reason: 'first visit on file — Initial Assessment',
      confidence: 'high',
    };
  }

  if (input.clinicianRequestedDischarge) {
    return {
      intent: EncounterIntent.BH_DISCHARGE,
      reason: 'discharge requested',
      confidence: 'high',
    };
  }

  // Treatment Plan Review cadence — most payers require every 90 days.
  const lastTpr = mostRecentByIntent(input.priorNotes, EncounterIntent.BH_TREATMENT_PLAN_REVIEW);
  const daysSinceTpr = lastTpr
    ? daysBetween(lastTpr, new Date())
    : daysBetween(input.priorNotes[0]!.signedAt, new Date());
  if (daysSinceTpr >= BH_TPR_DAYS_THRESHOLD) {
    return {
      intent: EncounterIntent.BH_TREATMENT_PLAN_REVIEW,
      reason: lastTpr
        ? `${daysSinceTpr} days since last Treatment Plan Review`
        : `${daysSinceTpr} days since intake — Treatment Plan Review due`,
      confidence: 'high',
    };
  }

  // Schedule-driven family / group cues. These are heuristic — the schedule
  // notes field is admin free-text; clinician can override.
  if (input.schedule?.notes) {
    const n = input.schedule.notes.toLowerCase();
    if (n.includes('family')) {
      return {
        intent: EncounterIntent.BH_SESSION_FAMILY,
        reason: 'schedule notes indicate family session',
        confidence: 'medium',
      };
    }
    if (n.includes('group')) {
      return {
        intent: EncounterIntent.BH_SESSION_GROUP,
        reason: 'schedule notes indicate group session',
        confidence: 'medium',
      };
    }
  }

  return {
    intent: EncounterIntent.BH_SESSION_INDIVIDUAL,
    reason: 'routine individual session',
    confidence: 'high',
  };
}

// =============================================================================
// MEDICAL calculator — taxonomy §5.2
// =============================================================================

function proposeMedicalIntent(input: IntentProposalInput): IntentProposal {
  // New-patient branch — fires when the patient has no prior signed
  // notes OR hasn't been seen in this group within 3 years (Medicare
  // definition).
  const lastSeenDays = input.patient?.daysSinceLastSeenInGroup;
  if (
    input.priorNotes.length === 0 ||
    (lastSeenDays !== null && lastSeenDays !== undefined && lastSeenDays > MEDICAL_NEW_PATIENT_DAYS_THRESHOLD)
  ) {
    return {
      intent: EncounterIntent.MEDICAL_NEW_PATIENT,
      reason:
        input.priorNotes.length === 0
          ? 'first visit on file'
          : `not seen in this group for ${lastSeenDays} days (>3 years)`,
      confidence: 'high',
    };
  }

  // TCM window — first post-discharge contact within 14 days.
  if (input.patient?.lastHospitalDischargeAt) {
    const daysSinceDischarge = daysBetween(input.patient.lastHospitalDischargeAt, new Date());
    if (daysSinceDischarge <= MEDICAL_TCM_DAYS_THRESHOLD) {
      return {
        intent: EncounterIntent.MEDICAL_DISCHARGE_TCM,
        reason: `${daysSinceDischarge}d post-hospital-discharge — TCM window`,
        confidence: 'high',
      };
    }
  }

  // AWV — Medicare-eligible + ≥11 months since last AWV (or never had one).
  if (input.patient?.medicareEligible) {
    const monthsSinceAWV = input.patient.lastAWVAt
      ? monthsBetween(input.patient.lastAWVAt, new Date())
      : Infinity;
    if (monthsSinceAWV >= MEDICAL_AWV_MONTHS_THRESHOLD) {
      return {
        intent: EncounterIntent.MEDICAL_ANNUAL_WELLNESS,
        reason: input.patient.lastAWVAt
          ? `${Math.floor(monthsSinceAWV)} months since last AWV`
          : 'Medicare-eligible — first AWV due',
        confidence: 'high',
      };
    }
  }

  // Schedule notes → ACUTE.
  if (input.schedule?.notes) {
    const n = input.schedule.notes.toLowerCase();
    if (ACUTE_SCHEDULE_KEYWORDS.some((kw) => n.includes(kw))) {
      return {
        intent: EncounterIntent.MEDICAL_ACUTE_VISIT,
        reason: 'schedule flagged as acute / same-day',
        confidence: 'medium',
      };
    }
  }

  // CCM — chronic-care management touch.
  if (input.patient?.enrolledInCCM) {
    return {
      intent: EncounterIntent.MEDICAL_CHRONIC_CARE,
      reason: 'enrolled in Chronic Care Management',
      confidence: 'medium',
    };
  }

  // Default — established-patient follow-up.
  return {
    intent: EncounterIntent.MEDICAL_FOLLOW_UP,
    reason: 'established patient — routine follow-up',
    confidence: 'high',
  };
}

// =============================================================================
// Date helpers — kept inline so the proposer has zero non-Prisma deps.
// =============================================================================

const MS_PER_DAY = 86_400_000;

function daysBetween(earlier: Date, later: Date): number {
  return Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / MS_PER_DAY));
}

function monthsBetween(earlier: Date, later: Date): number {
  // Approximate — good enough for cadence math (we're comparing to month
  // thresholds, not billing periods). 30.4375 = avg days/month over 4 yrs.
  return (later.getTime() - earlier.getTime()) / (MS_PER_DAY * 30.4375);
}

function mostRecentByIntent(
  notes: IntentProposalPriorNote[],
  intent: EncounterIntent,
): Date | null {
  let latest: Date | null = null;
  for (const n of notes) {
    if (n.intent !== intent) continue;
    if (!latest || n.signedAt > latest) latest = n.signedAt;
  }
  return latest;
}

// =============================================================================
// Supported pairs — used by the worker dispatcher (PR3) to decide
// whether to route to IntentAwareBriefGenerator. Co-located here so
// "valid intent for division" is one source of truth. v1 returns ALL
// non-UNSPECIFIED variants per their division prefix; the dispatcher
// in PR3 narrows this further to the four MVP pairs that actually
// have spine modules.
// =============================================================================

export function isIntentValidForDivision(
  intent: EncounterIntent,
  division: Division,
): boolean {
  if (intent === EncounterIntent.UNSPECIFIED) return true;
  switch (division) {
    case 'REHAB':
      return intent.startsWith('REHAB_');
    case 'BEHAVIORAL_HEALTH':
      return intent.startsWith('BH_');
    case 'MEDICAL':
      return intent.startsWith('MEDICAL_');
    case 'MULTI':
      // MULTI clinicians can pick anything (their professionType decides).
      return true;
    default:
      return false;
  }
}
