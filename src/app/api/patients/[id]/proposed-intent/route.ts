import { NextResponse } from 'next/server';
import {
  EncounterIntent,
  type Division,
  type EpisodeStatus,
  type EpisodeOfCare,
  type Note,
  type Patient,
  type Schedule,
} from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import {
  proposeIntent,
  type IntentProposalEpisode,
  type IntentProposalPatient,
  type IntentProposalPriorNote,
  type IntentProposalSchedule,
} from '@/services/copilot/intent-proposer';

export const runtime = 'nodejs';

/**
 * Unit 48 PR1 — GET /api/patients/[id]/proposed-intent
 *
 * Returns Miss Cleo's proposed clinical intent for the encounter about to
 * be created. The `<StartVisitDialog>` (PR2) consumes this and renders an
 * intent chip the clinician confirms or overrides; the captured value is
 * persisted on `Encounter.intent` at create time.
 *
 * **Purely deterministic** — no LLM call. The endpoint reads episode
 * state, schedule context, the patient's prior signed notes, and a few
 * patient-level signals (Medicare eligibility, AWV cadence, hospital
 * discharge proximity), then runs the calculator in
 * `src/services/copilot/intent-proposer.ts`.
 *
 * Query params (all optional, all narrow the proposal):
 *   - episodeId — when present, scopes "prior notes" to the episode and
 *     reads episode-state signals (visit count, recert window, progress-note
 *     cadence). Required for accurate REHAB Progress Note proposals.
 *   - caseId — reserved; v1 doesn't branch on it but accepts the param so
 *     PR2's caller can stay uniform with the existing start-visit preflight.
 *   - scheduleId — when present, the schedule's notes field is read for
 *     ACUTE / FAMILY / GROUP heuristics.
 *
 * Response shape:
 *   200 { data: { intent, division, reason, confidence } } — always 200
 *        when authenticated; on any internal error the response degrades
 *        to `{ intent: UNSPECIFIED, ..., confidence: 'low' }` so visit
 *        start is never blocked by proposer latency (Decision 7).
 *   401 / 403 — standard auth failures (unauthenticated, no_org, MFA, etc.)
 *   404 not_found — patient doesn't exist or isn't org-scoped to viewer
 *
 * Cache: 60s in-memory TTL per (patientId, episodeId, clinicianOrgUserId).
 * Episode state changes rarely; this shaves a DB round-trip off the
 * visit-start critical path. Process-scoped — restart clears it.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('VISITS_CREATE', req);
  if ('error' in guard) return guard.error;
  const { authorizationUser, orgUser } = guard;

  const { id: patientId } = await params;
  const url = new URL(req.url);
  const episodeId = url.searchParams.get('episodeId');
  const scheduleId = url.searchParams.get('scheduleId');

  // Cache lookup — keyed on the inputs that drive the proposal.
  const cacheKey = buildCacheKey({
    patientId,
    episodeId,
    scheduleId,
    clinicianOrgUserId: orgUser.id,
  });
  const cached = getCached(cacheKey);
  if (cached) {
    return jsonOk(cached);
  }

  // Patient existence + org scoping. We need division anyway for the
  // proposer; fold both into one query.
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, orgId: authorizationUser.orgId, isDeleted: false },
    select: { id: true, orgId: true, dob: true },
  });
  if (!patient) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(patient.orgId, authorizationUser.orgId);

  // Division comes from the clinician — Encounter inherits the clinician's
  // division at create time (existing behavior), so the proposer should
  // shape its output to match what the clinician will actually record.
  // Defensive fallback to MULTI if the clinician somehow has no division
  // (data inconsistency); the proposer returns UNSPECIFIED + low confidence
  // for MULTI.
  const division: Division = orgUser.division ?? 'MULTI';

  // Wrap the projection + proposer in a try/catch so an internal error
  // degrades to UNSPECIFIED (Decision 7 — Cleo's latency never blocks
  // visit start). Auth + 404 above intentionally stay outside this guard.
  try {
    const [episode, scheduleRow, priorNotes] = await Promise.all([
      episodeId
        ? prisma.episodeOfCare.findFirst({
            where: { id: episodeId, orgId: authorizationUser.orgId, patientId },
          })
        : Promise.resolve(null),
      scheduleId
        ? prisma.schedule.findFirst({
            where: { id: scheduleId, orgId: authorizationUser.orgId, patientId },
            select: { id: true, notes: true },
          })
        : Promise.resolve(null),
      prisma.note.findMany({
        where: {
          patientId,
          orgId: authorizationUser.orgId,
          status: { in: ['SIGNED', 'TRANSFERRED'] },
          ...(episodeId ? { encounter: { episodeOfCareId: episodeId } } : {}),
        },
        select: { signedAt: true, encounter: { select: { intent: true } } },
        orderBy: { signedAt: 'asc' },
      }),
    ]);

    const projectedEpisode = projectEpisode(episode, priorNotes);
    const projectedSchedule = projectSchedule(scheduleRow);
    const projectedPatient = projectPatient(patient);
    const projectedPriorNotes = projectPriorNotes(priorNotes);

    const proposal = proposeIntent({
      division,
      episode: projectedEpisode,
      priorNotes: projectedPriorNotes,
      schedule: projectedSchedule,
      patient: projectedPatient,
    });

    const responseBody = {
      intent: proposal.intent,
      division,
      reason: proposal.reason,
      confidence: proposal.confidence,
    };
    setCached(cacheKey, responseBody);
    return jsonOk(responseBody);
  } catch (err) {
    // Decision 7 — graceful degradation. Log + return UNSPECIFIED so the
    // start-visit dialog opens its picker without delay.
    console.warn(
      '[proposed-intent] proposer failed; falling back to UNSPECIFIED:',
      err instanceof Error ? err.message : err,
    );
    return jsonOk({
      intent: EncounterIntent.UNSPECIFIED,
      division,
      reason: 'visit type not auto-detected — pick from list',
      confidence: 'low',
    });
  }
}

// =============================================================================
// Projection helpers — translate Prisma rows into the proposer's input shape.
// =============================================================================

type PriorNoteRow = Pick<Note, 'signedAt'> & {
  encounter: { intent: EncounterIntent } | null;
};

function projectEpisode(
  episode: EpisodeOfCare | null,
  priorNotes: PriorNoteRow[],
): IntentProposalEpisode | null {
  if (!episode) return null;
  // Count visits since the most recent REHAB_PROGRESS_NOTE in this episode.
  // priorNotes is oldest-first; walk from the tail to find the most recent
  // progress note, then count notes after it.
  let lastProgressNoteAt: Date | null = null;
  let visitsSinceLastProgressNote = 0;
  for (let i = priorNotes.length - 1; i >= 0; i--) {
    const n = priorNotes[i]!;
    if (n.encounter?.intent === EncounterIntent.REHAB_PROGRESS_NOTE) {
      lastProgressNoteAt = n.signedAt ?? null;
      visitsSinceLastProgressNote = priorNotes.length - 1 - i;
      break;
    }
  }
  if (!lastProgressNoteAt) {
    // No progress note yet — every signed note counts.
    visitsSinceLastProgressNote = priorNotes.length;
  }
  return {
    status: episode.status as EpisodeStatus,
    visitsCompleted: episode.visitsCompleted,
    startedAt: episode.startedAt,
    recertDueAt: episode.recertDueAt,
    lastProgressNoteAt,
    visitsSinceLastProgressNote,
  };
}

function projectSchedule(
  schedule: Pick<Schedule, 'notes'> | null,
): IntentProposalSchedule | null {
  if (!schedule) return null;
  return { notes: schedule.notes };
}

/**
 * v1 projection — we don't yet have the FHIR-derived `lastHospitalDischargeAt`
 * or the CCM enrollment flag wired through. Returns conservative defaults
 * so the MEDICAL TCM / CCM branches stay quiet until PR4's spine work
 * extends the projector. Medicare eligibility is approximated by age ≥ 65
 * (covers the bulk of the AWV trigger — the small population of disability-
 * route Medicare under 65 isn't modeled in v1 and falls through to FOLLOW_UP).
 */
function projectPatient(patient: Pick<Patient, 'dob'>): IntentProposalPatient | null {
  const age = patient.dob ? Math.floor((Date.now() - patient.dob.getTime()) / 31_557_600_000) : null;
  const medicareEligible = age !== null && age >= 65;
  return {
    medicareEligible,
    lastAWVAt: null, // wired in a follow-on unit when the AWV detector lands
    lastHospitalDischargeAt: null, // wired with FHIR EncounterClass admission detection
    enrolledInCCM: false, // wired with the CCM enrollment surface
    daysSinceLastSeenInGroup: null, // wired when org-wide last-seen-by-anyone projection lands
  };
}

function projectPriorNotes(priorNotes: PriorNoteRow[]): IntentProposalPriorNote[] {
  const out: IntentProposalPriorNote[] = [];
  for (const n of priorNotes) {
    if (!n.signedAt) continue;
    out.push({
      signedAt: n.signedAt,
      intent: n.encounter?.intent ?? EncounterIntent.UNSPECIFIED,
    });
  }
  return out;
}

// =============================================================================
// Response helpers + in-memory TTL cache (process-scoped).
// =============================================================================

type ProposedIntentBody = {
  intent: EncounterIntent;
  division: Division;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
};

function jsonOk(body: ProposedIntentBody) {
  return new NextResponse(JSON.stringify({ data: body }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // Brief client-side cache too — the dialog often re-fires this if
      // the clinician closes and reopens.
      'Cache-Control': 'private, max-age=30',
    },
  });
}

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 500;
const cache = new Map<string, { value: ProposedIntentBody; expiresAt: number }>();

function buildCacheKey(args: {
  patientId: string;
  episodeId: string | null;
  scheduleId: string | null;
  clinicianOrgUserId: string;
}): string {
  return `${args.clinicianOrgUserId}::${args.patientId}::${args.episodeId ?? ''}::${args.scheduleId ?? ''}`;
}

function getCached(key: string): ProposedIntentBody | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function setCached(key: string, value: ProposedIntentBody): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Cheap eviction: drop the oldest insertion. Map preserves insertion
    // order; the first key is the eldest.
    const eldest = cache.keys().next().value;
    if (eldest) cache.delete(eldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// =============================================================================
// Test-only escape hatch — lets the route's unit tests clear the cache
// between cases without exporting the Map directly.
// =============================================================================

export function __clearCacheForTests(): void {
  cache.clear();
}
