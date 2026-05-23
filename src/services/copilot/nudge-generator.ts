import { createHash } from 'node:crypto';

import type {
  CleoNudgeKind,
  CleoNudgePriority,
  CleoNudgeSurface,
} from '@prisma/client';

import type { ObservedPatternsJson } from '@/services/copilot/state-builder';

/**
 * Sprint 0.18 — proactive nudge generator (PURE).
 *
 * Reads the patterns the Sprint-0.14/0.16/0.17 detectors already
 * emitted (via `CopilotPatientState.observedPatternsJson`) plus a
 * small bundle of Sprint-0.17 write-back failures and returns a list
 * of `CleoNudgeCandidate` rows. The worker (`cleo-state/handler.ts`)
 * upserts these candidates into `CleoNudge` rows via the compound
 * unique key `(clinicianOrgUserId, patientId, kind, sourcePatternSnapshotHash)`
 * so a re-run on unchanged patterns is idempotent.
 *
 * NO DB writes, NO HTTP, NO LLM calls (anti-spam discipline —
 * decision 11). Importing `@/services/llm/*` here is a regression.
 * The "voice" of each nudge comes through label copy that's already
 * decided in the state-builder; the DECISION of what to surface is
 * rule-based.
 *
 * Hash inputs (per kind) — stable for the same logical signal so
 * dedup at the unique key works:
 *   - RECERT_DUE_SOON:           `recert:${episodeId}:due:${dueIso}`
 *   - CASE_FHIR_STATUS_DRIFT:    `drift:${driftLogId}`
 *   - FHIR_WRITEBACK_FAILED_PERM:`writeback:${proposalId}`
 *   - MEASURE_TREND:             `trend:${measureName}:${noteId}`
 *   - GOAL_STALLED:              `goal:${goalId}:since:${sinceIso}`
 *   - TOPIC_MENTIONED_UNADDRESSED:`topic:${topic}:lastSeen:${lastSeenIso}`
 *
 * Decision 3a (escalation): the hash includes the escalation axis
 * (next due date / latest measure value / next stalled-since
 * timestamp), so an escalating signal yields a NEW hash → a NEW
 * row. The old DISMISSED row is left in place for the cooldown
 * audit; the new row surfaces with full priority.
 */

// =============================================================================
// Public types — the worker calls into `generateNudgeCandidates`.
// =============================================================================

export type NudgeGeneratorPermanentFailure = {
  proposalId: string;
  caseManagementId: string;
  /** Stable timestamp string (ISO). Drives the snapshot-hash escalation
   *  axis — a later failure on the same proposal stamps a new hash. */
  failedAt: string;
  /** PHI-free — categorical only. */
  failureKind: 'PERMANENT' | 'CONFLICT';
  /** Worker-side counter; included in the snapshot payload so the UI
   *  can show "tried 3 times" without re-reading the proposal row. */
  failureCount: number;
};

export type NudgeGeneratorInput = {
  orgId: string;
  patientId: string;
  clinicianOrgUserId: string;
  observedPatterns: ObservedPatternsJson;
  /** Sprint 0.17 — PROPOSED/APPROVED/EXECUTING/SUCCEEDED/CANCELLED
   *  rows DO NOT belong here. Only FAILED + (PERMANENT|CONFLICT) make
   *  it into the nudge stream. TRANSIENT failures are excluded by
   *  design — they're retryable through the regular Sprint-0.17
   *  retry affordance and shouldn't pollute the proactive surface. */
  pendingPermanentWritebackFailures: NudgeGeneratorPermanentFailure[];
};

export type CleoNudgeCandidate = {
  kind: CleoNudgeKind;
  priority: CleoNudgePriority;
  eligibleSurfaces: CleoNudgeSurface;
  sourcePatternSnapshotHash: string;
  /** Stored verbatim on `CleoNudge.sourcePatternSnapshotJson`. PHI-bearing
   *  by definition (measure values etc.); clinical-surface only — the
   *  audit log persists `{nudgeId, kind, priority, personaVersion}`,
   *  never this payload (decision 9). */
  sourcePatternSnapshotJson: Record<string, unknown>;
  /** Slug recorded on `_ACTED` — the categorical record of which path
   *  the clinician chose. Decision 7. */
  affordanceSlug:
    | 'open-reconcile-flow'
    | 'start-recert-visit'
    | 'open-plan-editor'
    | 'review-failed-writeback'
    | 'reevaluate-goal';
  /** For UI render — NOT persisted to audit (decision 9). The
   *  card-presenter may extend / decorate this string; the generator
   *  picks a stable default. */
  label: string;
  /** Optional second line for the card body — additional cited
   *  evidence ("PHQ-9 12 → 17 → 19 across the last 3 visits"). UI may
   *  render or hide. PHI-bearing on some kinds; same posture as
   *  `label`. */
  subtitle?: string;
};

// =============================================================================
// Public entry point.
// =============================================================================

/**
 * Run all six per-kind mappers, concatenate, return. Deterministic +
 * stable: the same input produces the same output (including identical
 * snapshot hashes), so the worker's upsert is idempotent.
 */
export function generateNudgeCandidates(
  input: NudgeGeneratorInput,
): CleoNudgeCandidate[] {
  const out: CleoNudgeCandidate[] = [];

  for (const pattern of input.observedPatterns.patterns) {
    switch (pattern.kind) {
      case 'recert_due_soon':
        out.push(...mapRecertDueSoon(pattern));
        break;
      case 'case_fhir_status_drift':
        out.push(...mapCaseFhirDrift(pattern));
        break;
      case 'measure_trend':
        out.push(...mapMeasureTrend(pattern));
        break;
      case 'goal_stalled':
        out.push(...mapGoalStalled(pattern));
        break;
      case 'topic_mentioned_unaddressed':
        out.push(...mapTopicMentionedUnaddressed(pattern));
        break;
      case 'fhir_writeback_failed_permanent':
        // The pattern-derived path is the canonical one — the
        // separate `pendingPermanentWritebackFailures` input is
        // tolerated for tests + future direct-call scenarios.
        out.push(...mapWritebackFailedPermanent(pattern));
        break;
      default:
        // Unknown kind — skip rather than throw. Defensive against a
        // future state-builder version that ships a kind ahead of
        // this generator.
        break;
    }
  }

  // Direct write-back failure inputs (used by the worker when the
  // pattern projection hasn't been rebuilt yet — Sprint-0.17 state
  // may produce failures between state rebuilds). Dedup against
  // pattern-derived candidates via the shared snapshot hash.
  const seenHashes = new Set(out.map((c) => `${c.kind}:${c.sourcePatternSnapshotHash}`));
  for (const failure of input.pendingPermanentWritebackFailures) {
    const cand = buildWritebackFailedCandidate({
      proposalId: failure.proposalId,
      caseManagementId: failure.caseManagementId,
      failedAt: failure.failedAt,
      failureKind: failure.failureKind,
      failureCount: failure.failureCount,
    });
    const key = `${cand.kind}:${cand.sourcePatternSnapshotHash}`;
    if (!seenHashes.has(key)) {
      seenHashes.add(key);
      out.push(cand);
    }
  }

  return out;
}

// =============================================================================
// Per-kind mappers.
// =============================================================================

type Pattern = ObservedPatternsJson['patterns'][number];

/** Defensive accessor — patterns from older state-builder versions
 *  may omit `detail` entirely (the Zod schema currently allows any
 *  record, including empty). Returns an empty object so the per-kind
 *  mappers' destructuring is safe. */
function detailOf<T>(pattern: Pattern): T {
  return (pattern.detail ?? {}) as T;
}

function mapRecertDueSoon(pattern: Pattern): CleoNudgeCandidate[] {
  const detail = detailOf<{
    episodeId?: string;
    diagnosis?: string;
    division?: string;
    dueAt?: string;
    daysUntilDue?: number;
  }>(pattern);
  if (!detail.episodeId || !detail.dueAt) return [];

  // The escalation axis is the daysUntilDue threshold band, not the
  // raw day count. `dueAt` is static per episode; the countdown
  // shouldn't spawn a new nudge each day, but a band crossing
  // (e.g. 14 → 7 → 3) is escalation worth re-surfacing past a
  // prior dismissal. Bands:
  //   band 1 ("due-soon"):       8..14 days
  //   band 2 ("urgent"):         4..7 days
  //   band 3 ("very-urgent"):    0..3 days
  //   band 4 ("overdue"):       < 0 days
  // 14 → 13 → 8 all stay in band 1; 14 → 3 crosses to band 3 → fresh hash.
  const band =
    typeof detail.daysUntilDue !== 'number'
      ? 0
      : detail.daysUntilDue < 0
        ? 4
        : detail.daysUntilDue <= 3
          ? 3
          : detail.daysUntilDue <= 7
            ? 2
            : 1;
  const hash = hashSnapshot(`recert:${detail.episodeId}:band:${band}:due:${detail.dueAt}`);

  return [
    {
      kind: 'RECERT_DUE_SOON',
      priority: 'HIGH',
      eligibleSurfaces: 'BOTH',
      sourcePatternSnapshotHash: hash,
      sourcePatternSnapshotJson: {
        episodeId: detail.episodeId,
        diagnosis: detail.diagnosis ?? null,
        division: detail.division ?? null,
        dueAt: detail.dueAt,
        daysUntilDue: detail.daysUntilDue ?? null,
      },
      affordanceSlug: 'start-recert-visit',
      label: pattern.label,
      subtitle:
        typeof detail.daysUntilDue === 'number'
          ? `Due in ${detail.daysUntilDue} day${detail.daysUntilDue === 1 ? '' : 's'}`
          : undefined,
    },
  ];
}

function mapCaseFhirDrift(pattern: Pattern): CleoNudgeCandidate[] {
  const detail = detailOf<{
    driftLogId?: string;
    caseManagementId?: string;
    fhirConditionId?: string;
    driftKind?: 'STATUS' | 'ICD';
    detectedAt?: string;
  }>(pattern);
  if (!detail.driftLogId || !detail.caseManagementId) return [];
  const hash = hashSnapshot(`drift:${detail.driftLogId}`);
  return [
    {
      kind: 'CASE_FHIR_STATUS_DRIFT',
      priority: 'HIGH',
      eligibleSurfaces: 'BOTH',
      sourcePatternSnapshotHash: hash,
      sourcePatternSnapshotJson: {
        driftLogId: detail.driftLogId,
        caseManagementId: detail.caseManagementId,
        fhirConditionId: detail.fhirConditionId ?? null,
        driftKind: detail.driftKind ?? null,
        detectedAt: detail.detectedAt ?? null,
      },
      affordanceSlug: 'open-reconcile-flow',
      label: pattern.label,
      subtitle:
        detail.driftKind === 'ICD'
          ? 'ICD code differs from EHR'
          : detail.driftKind === 'STATUS'
            ? 'Status differs from EHR'
            : undefined,
    },
  ];
}

function buildWritebackFailedCandidate(args: {
  proposalId: string;
  caseManagementId: string;
  failedAt: string;
  failureKind: 'PERMANENT' | 'CONFLICT';
  failureCount: number;
}): CleoNudgeCandidate {
  // The escalation axis is the failureCount — each retry that fails
  // bumps the count + spawns a fresh nudge so a dismissed nudge
  // can't silence a repeatedly failing write.
  const hash = hashSnapshot(
    `writeback:${args.proposalId}:attempts:${args.failureCount}`,
  );
  return {
    kind: 'FHIR_WRITEBACK_FAILED_PERMANENT',
    priority: 'HIGH',
    eligibleSurfaces: 'BOTH',
    sourcePatternSnapshotHash: hash,
    sourcePatternSnapshotJson: {
      proposalId: args.proposalId,
      caseManagementId: args.caseManagementId,
      failureKind: args.failureKind,
      failureCount: args.failureCount,
      failedAt: args.failedAt,
    },
    affordanceSlug: 'review-failed-writeback',
    label: 'EHR write blocked — needs review',
    subtitle:
      args.failureKind === 'CONFLICT'
        ? 'EHR moved between detection + write. Re-read to retry.'
        : 'Permanent error — review the EHR side or cancel.',
  };
}

function mapWritebackFailedPermanent(pattern: Pattern): CleoNudgeCandidate[] {
  const detail = detailOf<{
    proposalId?: string;
    caseManagementId?: string;
    failureKind?: 'PERMANENT' | 'CONFLICT' | string;
    failureCount?: number;
    failedAt?: string;
  }>(pattern);
  if (!detail.proposalId || !detail.caseManagementId || !detail.failedAt) return [];
  if (detail.failureKind !== 'PERMANENT' && detail.failureKind !== 'CONFLICT') return [];
  return [
    buildWritebackFailedCandidate({
      proposalId: detail.proposalId,
      caseManagementId: detail.caseManagementId,
      failedAt: detail.failedAt,
      failureKind: detail.failureKind,
      failureCount: typeof detail.failureCount === 'number' ? detail.failureCount : 1,
    }),
  ];
}

function mapMeasureTrend(pattern: Pattern): CleoNudgeCandidate[] {
  const detail = detailOf<{
    measureName?: string;
    direction?: 'up' | 'down';
    latestValue?: number | string;
    latestNoteId?: string;
    valuesWindow?: Array<number | string>;
  }>(pattern);
  if (!detail.measureName || !detail.latestNoteId) return [];
  // The escalation axis is the latest measure value — a worsening
  // PHQ-9 (12 → 17 → 19) yields a new hash → new nudge after a
  // prior dismissal. Stable across the same trend window.
  const hash = hashSnapshot(
    `trend:${detail.measureName}:value:${detail.latestValue ?? ''}:note:${detail.latestNoteId}`,
  );
  return [
    {
      kind: 'MEASURE_TREND',
      priority: 'MEDIUM',
      eligibleSurfaces: 'BOTH',
      sourcePatternSnapshotHash: hash,
      sourcePatternSnapshotJson: {
        measureName: detail.measureName,
        direction: detail.direction ?? null,
        latestValue: detail.latestValue ?? null,
        latestNoteId: detail.latestNoteId,
        valuesWindow: detail.valuesWindow ?? [],
      },
      affordanceSlug: 'open-plan-editor',
      label: pattern.label,
      subtitle: Array.isArray(detail.valuesWindow)
        ? detail.valuesWindow.join(' → ')
        : undefined,
    },
  ];
}

function mapGoalStalled(pattern: Pattern): CleoNudgeCandidate[] {
  const detail = detailOf<{
    goalId?: string;
    goalText?: string;
    lastProgressAt?: string | null;
    daysSinceLastProgress?: number;
  }>(pattern);
  if (!detail.goalId) return [];
  // The escalation axis is the days-since bucket (round down to
  // 7-day buckets) so a 28→29→30-day stall doesn't spawn new
  // nudges, but 28→90 does.
  const daysBucket =
    typeof detail.daysSinceLastProgress === 'number'
      ? Math.floor(detail.daysSinceLastProgress / 7)
      : 0;
  const hash = hashSnapshot(
    `goal:${detail.goalId}:bucket:${daysBucket}:since:${detail.lastProgressAt ?? 'never'}`,
  );
  return [
    {
      kind: 'GOAL_STALLED',
      priority: 'MEDIUM',
      eligibleSurfaces: 'VISIT_PREPARE',
      sourcePatternSnapshotHash: hash,
      sourcePatternSnapshotJson: {
        goalId: detail.goalId,
        goalText: detail.goalText ?? null,
        lastProgressAt: detail.lastProgressAt ?? null,
        daysSinceLastProgress: detail.daysSinceLastProgress ?? null,
      },
      affordanceSlug: 'reevaluate-goal',
      label: pattern.label,
      subtitle:
        typeof detail.daysSinceLastProgress === 'number'
          ? `No progress in ${detail.daysSinceLastProgress} days`
          : undefined,
    },
  ];
}

function mapTopicMentionedUnaddressed(pattern: Pattern): CleoNudgeCandidate[] {
  const detail = detailOf<{
    topic?: string;
    lastSeenAt?: string;
    occurrenceCount?: number;
  }>(pattern);
  if (!detail.topic) return [];
  const hash = hashSnapshot(
    `topic:${detail.topic.toLowerCase()}:lastSeen:${detail.lastSeenAt ?? ''}`,
  );
  return [
    {
      kind: 'TOPIC_MENTIONED_UNADDRESSED',
      priority: 'LOW',
      eligibleSurfaces: 'VISIT_PREPARE',
      sourcePatternSnapshotHash: hash,
      sourcePatternSnapshotJson: {
        topic: detail.topic,
        lastSeenAt: detail.lastSeenAt ?? null,
        occurrenceCount: detail.occurrenceCount ?? null,
      },
      affordanceSlug: 'open-plan-editor',
      label: pattern.label,
      subtitle:
        typeof detail.occurrenceCount === 'number'
          ? `Mentioned ${detail.occurrenceCount} times, not yet in plan`
          : undefined,
    },
  ];
}

// =============================================================================
// Hash helper.
// =============================================================================

/** SHA-256 truncated to 16 hex chars — 64 bits, comfortably collision-safe
 *  inside a single patient-clinician scope, and short enough to keep the
 *  unique-key index compact. */
function hashSnapshot(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}
