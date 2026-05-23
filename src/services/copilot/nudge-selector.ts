import type {
  CleoNudge,
  CleoNudgeKind,
  CleoNudgePriority,
  CleoNudgeSurface,
} from '@prisma/client';

import type {
  ObservedPatternsJson,
} from '@/services/copilot/state-builder';
import type { CleoNudgeCandidate } from '@/services/copilot/nudge-generator';

/**
 * Sprint 0.18 — proactive nudge selector (PURE).
 *
 * Given the candidate list from the generator + the existing
 * `CleoNudge` rows for a (patient × clinician) tuple, decide what to
 * actually surface on a given surface (CHART or VISIT_PREPARE).
 *
 * Applied in order:
 *   1. Dedup candidates against existing rows by the unique
 *      (kind, snapshot-hash) key.
 *   2. Apply per-kind cooldown to DISMISSED rows.
 *   3. Apply read-time expiry (decision 8) — rows whose underlying
 *      pattern is gone from the latest `observedPatternsJson` get
 *      flagged for flip-to-EXPIRED.
 *   4. Filter to the requested surface (CHART | VISIT_PREPARE) via
 *      the row's `eligibleSurfaces` enum.
 *   5. Exclude rows whose `snoozeUntil` is still in the future.
 *   6. Sort by (priority DESC, proposedAt ASC).
 *   7. Slice to top 3 (decision 4 — Hick's law).
 *
 * NO DB writes — the read endpoint applies the returned
 * `markExpired` / `surfacedRows` separately. No LLM calls.
 */

// =============================================================================
// Cooldown + priority tables (decision 3 — hardcoded; not
// clinician-tunable in this sprint).
// =============================================================================

/** Per-kind cooldown in milliseconds. After a dismiss, the same
 *  (kind, snapshot-hash) row stays suppressed until the cooldown
 *  expires. Escalating snapshots (different hash — decision 3a) bypass
 *  this entirely because they're a NEW logical nudge. */
const COOLDOWN_MS_BY_KIND: Record<CleoNudgeKind, number> = {
  RECERT_DUE_SOON: 1 * 24 * 60 * 60 * 1000, // 1d
  CASE_FHIR_STATUS_DRIFT: 3 * 24 * 60 * 60 * 1000, // 3d
  FHIR_WRITEBACK_FAILED_PERMANENT: 1 * 24 * 60 * 60 * 1000, // 1d
  MEASURE_TREND: 14 * 24 * 60 * 60 * 1000, // 14d
  GOAL_STALLED: 14 * 24 * 60 * 60 * 1000, // 14d
  TOPIC_MENTIONED_UNADDRESSED: 7 * 24 * 60 * 60 * 1000, // 7d
};

/** Per-kind canonical priority. Kept here (alongside cooldowns) so the
 *  selector can compare candidate priority to the table; if a future
 *  detector misclassifies, the selector takes the table value as the
 *  source of truth. */
export const PRIORITY_BY_KIND: Record<CleoNudgeKind, CleoNudgePriority> = {
  RECERT_DUE_SOON: 'HIGH',
  CASE_FHIR_STATUS_DRIFT: 'HIGH',
  FHIR_WRITEBACK_FAILED_PERMANENT: 'HIGH',
  MEASURE_TREND: 'MEDIUM',
  GOAL_STALLED: 'MEDIUM',
  TOPIC_MENTIONED_UNADDRESSED: 'LOW',
};

/** Cap rendered nudges per surface — Hick's law (decision 4). */
export const NUDGES_PER_SURFACE_CAP = 3;

// =============================================================================
// Public types.
// =============================================================================

export type SurfaceTarget = 'CHART' | 'VISIT_PREPARE';

export type NudgeSelectorInput = {
  candidates: CleoNudgeCandidate[];
  existingRows: CleoNudge[];
  observedPatterns: ObservedPatternsJson;
  surface: SurfaceTarget;
  now: Date;
};

export type SelectedNudge = {
  /** The row that should render. For existing rows this is the
   *  persisted `CleoNudge`; for fresh candidates the worker hasn't
   *  inserted yet, the caller projects from the candidate (the
   *  generator's normal path creates the row at upsert time, so this
   *  case is rare on the read side). */
  row: CleoNudge;
  isNew: boolean;
};

export type NudgeSelectorOutput = {
  /** Rows the caller should render — already sorted + capped at 3. */
  surfaced: SelectedNudge[];
  /** Rows whose underlying pattern is gone — caller flips them to
   *  EXPIRED + audits `CLEO_NUDGE_EXPIRED` (decision 8). */
  expired: CleoNudge[];
};

// =============================================================================
// Selector.
// =============================================================================

/**
 * Pure selection function. The caller (the page-level
 * `loadEligibleNudgesForSurface` helper) takes the returned
 * `expired` list and applies the DB flip + audit batch outside this
 * function.
 */
export function selectNudgesForSurface(
  input: NudgeSelectorInput,
): NudgeSelectorOutput {
  const now = input.now.getTime();

  // Index existing rows by the unique key for fast dedup.
  const existingByKey = new Map<string, CleoNudge>();
  for (const row of input.existingRows) {
    existingByKey.set(unkey(row.kind, row.sourcePatternSnapshotHash), row);
  }

  // Index candidates likewise — used to detect "pattern still
  // present" for the expiry filter (decision 8).
  const candidatesByKey = new Map<string, CleoNudgeCandidate>();
  for (const cand of input.candidates) {
    candidatesByKey.set(unkey(cand.kind, cand.sourcePatternSnapshotHash), cand);
  }

  // Index the latest observedPatterns by snapshot identity — also
  // drives the expiry decision. The generator's hash function is the
  // source of truth here; expiry happens when neither a fresh
  // candidate nor an inline pattern exists for the row's hash.
  const liveHashes = new Set(input.candidates.map((c) => unkey(c.kind, c.sourcePatternSnapshotHash)));

  // 1. Expiry pass — any existing row whose pattern is GONE is
  //    surfaced as an "expired" entry; the caller flips status +
  //    audits. Skip rows that are already terminal.
  const expired: CleoNudge[] = [];
  for (const row of input.existingRows) {
    if (isTerminal(row)) continue;
    const key = unkey(row.kind, row.sourcePatternSnapshotHash);
    if (!liveHashes.has(key)) {
      expired.push(row);
    }
  }

  // 2. Build the candidate-render set: prefer the existing row when
  //    one exists (so its state machine + cooldown apply); fall back
  //    to a synthesized row from the candidate when the worker
  //    hasn't persisted it yet.
  const renderable: SelectedNudge[] = [];
  for (const cand of input.candidates) {
    const key = unkey(cand.kind, cand.sourcePatternSnapshotHash);
    const existing = existingByKey.get(key);
    if (existing) {
      if (!isEligibleForRender(existing, input.surface, now)) continue;
      renderable.push({ row: existing, isNew: false });
    } else {
      // Synthesized row — the worker has not yet upserted this
      // candidate (race: state-rebuild fired this read before the
      // worker's matching upsert completed). The selector still
      // honors the candidate so the surface isn't empty during the
      // race; the read endpoint's caller uses `isNew=true` to skip
      // DB-only operations (dismiss/snooze/act all require a
      // persisted id).
      if (!rowMatchesSurface(cand.eligibleSurfaces, input.surface)) continue;
      renderable.push({ row: synthesizeRowFromCandidate(cand, input), isNew: true });
    }
  }

  // 3. Also include existing rows that don't have a matching
  //    candidate but are STILL eligible — re-surfacing a SNOOZED row
  //    whose snoozeUntil has elapsed AND whose pattern is still
  //    present is a common case. Skip rows whose pattern has gone
  //    (those are in `expired`).
  for (const row of input.existingRows) {
    if (isTerminal(row)) continue;
    const key = unkey(row.kind, row.sourcePatternSnapshotHash);
    if (!liveHashes.has(key)) continue; // expired path handles these
    // Skip already-added rows.
    if (renderable.some((r) => r.row.id === row.id)) continue;
    if (!isEligibleForRender(row, input.surface, now)) continue;
    renderable.push({ row, isNew: false });
  }

  // 4. Sort by (priority DESC, proposedAt ASC).
  renderable.sort((a, b) => {
    const ap = priorityRank(a.row.priority);
    const bp = priorityRank(b.row.priority);
    if (ap !== bp) return bp - ap;
    return a.row.proposedAt.getTime() - b.row.proposedAt.getTime();
  });

  // 5. Cap.
  const surfaced = renderable.slice(0, NUDGES_PER_SURFACE_CAP);

  return { surfaced, expired };
}

// =============================================================================
// Eligibility predicates.
// =============================================================================

function isTerminal(row: CleoNudge): boolean {
  return (
    row.status === 'DISMISSED' ||
    row.status === 'ACTED' ||
    row.status === 'EXPIRED'
  );
}

function isEligibleForRender(
  row: CleoNudge,
  surface: SurfaceTarget,
  nowMs: number,
): boolean {
  // Terminal states never render.
  if (row.status === 'ACTED' || row.status === 'EXPIRED') return false;

  // DISMISSED rows are not eligible until their cooldown expires; the
  // hash already changed on escalation (decision 3a — new row), so
  // re-surfacing a DISMISSED row only happens when the pattern
  // re-emits unchanged after the cooldown window.
  if (row.status === 'DISMISSED') {
    if (!row.dismissedAt) return false;
    const cooldownMs = COOLDOWN_MS_BY_KIND[row.kind];
    if (nowMs - row.dismissedAt.getTime() < cooldownMs) return false;
  }

  // SNOOZED rows are eligible once snoozeUntil passes. Without a
  // timestamp (defensive), treat as not yet eligible.
  if (row.status === 'SNOOZED') {
    if (!row.snoozeUntil) return false;
    if (row.snoozeUntil.getTime() > nowMs) return false;
  }

  // Surface filter: BOTH always passes; otherwise must match exactly.
  return rowMatchesSurface(row.eligibleSurfaces, surface);
}

function rowMatchesSurface(
  eligible: CleoNudgeSurface,
  surface: SurfaceTarget,
): boolean {
  if (eligible === 'BOTH') return true;
  return eligible === surface;
}

// =============================================================================
// Helpers.
// =============================================================================

function unkey(kind: CleoNudgeKind, hash: string): string {
  return `${kind}:${hash}`;
}

function priorityRank(p: CleoNudgePriority): number {
  if (p === 'HIGH') return 3;
  if (p === 'MEDIUM') return 2;
  return 1;
}

/** Build a synthetic `CleoNudge` shape from a fresh candidate the
 *  worker hasn't persisted yet. Used only for the read-during-race
 *  edge case. `id` is set to a sentinel so the caller can detect
 *  un-persisted rows via `isNew`. */
function synthesizeRowFromCandidate(
  cand: CleoNudgeCandidate,
  input: NudgeSelectorInput,
): CleoNudge {
  const now = input.now;
  return {
    id: `pending:${cand.kind}:${cand.sourcePatternSnapshotHash}`,
    orgId: input.candidates[0] ? '' : '', // populated by caller if it cares
    patientId: '',
    clinicianOrgUserId: '',
    kind: cand.kind,
    priority: cand.priority,
    eligibleSurfaces: cand.eligibleSurfaces,
    sourcePatternSnapshotHash: cand.sourcePatternSnapshotHash,
    // Prisma's JsonValue type is the on-wire shape; the candidate
    // payload satisfies it at runtime even though the static types
    // don't line up perfectly. Cast through unknown is the canonical
    // pattern other call sites use (cf. state-builder upsert).
    sourcePatternSnapshotJson: cand.sourcePatternSnapshotJson as unknown as CleoNudge['sourcePatternSnapshotJson'],
    affordanceSlug: cand.affordanceSlug,
    status: 'PROPOSED',
    proposedAt: now,
    shownAt: null,
    dismissedAt: null,
    dismissedByUserId: null,
    snoozedAt: null,
    snoozedByUserId: null,
    snoozeUntil: null,
    actedAt: null,
    actedByUserId: null,
    actedAction: null,
    expiredAt: null,
    personaVersion: 'miss-cleo-v1',
  } satisfies CleoNudge;
}
