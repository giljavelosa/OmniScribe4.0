/**
 * Sprint 0.14 — Miss Cleo's persistent-memory state builder.
 *
 * Pure projection from primary sources (rule 20):
 *   - signed notes (status IN (SIGNED, TRANSFERRED))
 *   - CaseManagement rows
 *   - clinician-confirmed FollowUp rows
 *   - CaseRouterRun history (Sprint 0.13)
 *   - NoteBrief.content (already-extracted objectiveMeasures)
 *   - EpisodeOfCare / EpisodeGoal / GoalProgressEntry
 *
 * No LLM calls inside. Idempotent + deterministic — running twice gives
 * the same output. Zod-validated JSON shapes on write.
 *
 * Rule 24: pattern detectors surface what HAPPENED (citations to source
 * notes / measures / goals) — never what TO DO about it.
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { prisma as defaultPrisma } from '@/lib/prisma';
import { divisionForProfession } from '@/lib/professions';
import { viewerRecencyForCase } from '@/lib/case-management/viewer-recency';
import type { PriorContextBriefContent } from '@/types/brief';

/**
 * Bump when the state JSON shape changes meaningfully. The cleo-state
 * worker writes this onto the row; future sprints can use a mismatch
 * to trigger a forced rebuild without a schema migration.
 *
 * v2 (Sprint 0.15): `fhirMirror` now carries `clinicalStatus` +
 * `lastUpdated` in addition to `conditionId` + `ehrSystem`. v1 rows
 * still parse (the new fields are nullable), but a `cleo-state` event
 * picks up the richer shape on next rebuild.
 *
 * v3 (Sprint 0.16): `observedPatternsJson` gains the
 * `case_fhir_status_drift` kind for each unresolved
 * `CaseFhirDriftLog` row. Existing v2 rows are still readable (the
 * new kind extends an enum on a discriminator); a `cleo-state` event
 * (sign / case-router-accept / drift-resolve) picks up the richer
 * shape on next rebuild.
 */
export const CLEO_STATE_GENERATOR_VERSION = 'cleo-state-v3';

// =============================================================================
// Zod schemas — caseAwarenessJson / observedPatternsJson / conversationFactsJson
// =============================================================================

const CaseAwarenessEntrySchema = z.object({
  id: z.string().min(1),
  primaryIcd: z.string().nullable(),
  primaryIcdLabel: z.string().min(1),
  status: z.enum(['ACTIVE', 'CLOSED', 'CANCELLED', 'PENDING_ROUTER']),
  /** ISO — most recent activity by THIS viewing clinician. */
  lastViewerActivityAt: z.string().nullable(),
  /** ISO — most recent activity by anyone in the viewer's division. */
  lastViewerDivisionActivityAt: z.string().nullable(),
  /** ISO — most recent activity overall. */
  lastActivityAt: z.string().nullable(),
  /** Confidence transitions on this case from the case-router (Sprint 0.13).
   *  Most-recent first. Useful so Cleo knows e.g. "this case used to be
   *  LOW-confidence routing, now HIGH" — drives trust calibration. */
  routingConfidenceHistory: z.array(
    z.object({
      runId: z.string().min(1),
      confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
      acceptedAction: z.string().nullable(),
      at: z.string().min(1),
    }),
  ),
  /** Sprint 0.15 — FHIR Condition mirror. Populated whenever the
   *  underlying `CaseManagement.mirrorsFhirConditionId` is non-null;
   *  null on cases that opened without an EHR link. `clinicalStatus`
   *  + `lastUpdated` are derived from the matching
   *  `FhirCachedResource` row when available — Sprint 0.16's
   *  reconciliation pattern detector reads `clinicalStatus` to flag
   *  status-drift between OmniScribe + EHR. */
  fhirMirror: z
    .object({
      conditionId: z.string().min(1),
      ehrSystem: z.string().min(1),
      clinicalStatus: z.string().min(1).nullable(),
      lastUpdated: z.string().min(1).nullable(),
    })
    .nullable(),
});

export const CaseAwarenessJsonSchema = z.object({
  cases: z.array(CaseAwarenessEntrySchema),
});
export type CaseAwarenessJson = z.infer<typeof CaseAwarenessJsonSchema>;

const ObservedPatternBaseSchema = z.object({
  /** Per-detector entries keep one stable shape so the agent can read all
   *  detectors with one parse. Detector-specific fields hang under `detail`. */
  kind: z.enum([
    'topic_mentioned_unaddressed',
    'measure_trend',
    'recert_due_soon',
    'goal_stalled',
    // Sprint 0.16 — `CaseFhirDriftLog` row exists + is unresolved for
    // a mirrored case on this patient.
    'case_fhir_status_drift',
  ]),
  /** Short label for the card UI ("Sleep mentioned in last 3 visits"). */
  label: z.string().min(1).max(160),
  /** Detector-specific structured payload (validated per-kind by the
   *  detectors themselves; here we accept Record<string, unknown>). */
  detail: z.record(z.string(), z.unknown()),
  /** Source-grounded citations — the notes / goals / episodes this
   *  pattern was observed in. Powers the "cited from" framing in the
   *  card and the agent prompt. */
  observedInNoteIds: z.array(z.string().min(1)),
  observedInGoalIds: z.array(z.string().min(1)).optional(),
  observedInEpisodeIds: z.array(z.string().min(1)).optional(),
  /** How many times this pattern was observed in the window. */
  count: z.number().int().min(1),
  firstSeen: z.string().min(1),
  lastSeen: z.string().min(1),
});

export const ObservedPatternsJsonSchema = z.object({
  patterns: z.array(ObservedPatternBaseSchema),
});
export type ObservedPatternsJson = z.infer<typeof ObservedPatternsJsonSchema>;
export type ObservedPattern = z.infer<typeof ObservedPatternBaseSchema>;

const ConversationFactSchema = z.object({
  summary: z.string().min(1).max(280),
  sourceNoteId: z.string().min(1).optional(),
  sourceFollowUpId: z.string().min(1).optional(),
  sourceGoalId: z.string().min(1).optional(),
  sourceConditionId: z.string().min(1).optional(),
  citedAt: z.string().min(1),
});

export const ConversationFactsJsonSchema = z.object({
  facts: z.array(ConversationFactSchema),
});
export type ConversationFactsJson = z.infer<typeof ConversationFactsJsonSchema>;
export type ConversationFact = z.infer<typeof ConversationFactSchema>;

// =============================================================================
// Tunables — keep tight so the agent prompt stays cheap.
// =============================================================================

/** Window for signed-note look-back. Bounds work + cost. */
const NOTE_WINDOW = 20;
/** A topic must appear in N consecutive recent visits to fire. */
const TOPIC_THRESHOLD = 3;
/** Recert-due window. */
const RECERT_DUE_DAYS = 14;
/** Goal-stalled window: no progress entry in N days. */
const GOAL_STALLED_DAYS = 28;
/** Min consecutive monotonic readings for the measure-trend detector. */
const TREND_THRESHOLD = 3;
/** Cap on facts distilled from prior conversations (oldest dropped first). */
const MAX_CONVERSATION_FACTS = 20;

/** Bounded keyword list per the spec's "fixed taxonomy" decision. Lowercase
 *  for case-insensitive scans. New keywords land via spec-tracked changes
 *  so the projection stays predictable. */
const UNADDRESSED_TOPIC_KEYWORDS: ReadonlyArray<{
  topic: string;
  keywords: ReadonlyArray<string>;
}> = [
  { topic: 'sleep', keywords: ['sleep', 'insomnia', 'sleeping'] },
  { topic: 'anxiety', keywords: ['anxiety', 'anxious', 'worry'] },
  { topic: 'weight', keywords: ['weight', 'overweight', 'obesity'] },
  { topic: 'pain', keywords: ['pain', 'aching', 'sore'] },
  { topic: 'falls', keywords: ['fall', 'falls', 'fell', 'falling'] },
];

// =============================================================================
// Public API
// =============================================================================

export type RebuildArgs = {
  orgId: string;
  patientId: string;
  clinicianOrgUserId: string;
};

export type StateProjections = {
  caseAwareness: CaseAwarenessJson;
  observedPatterns: ObservedPatternsJson;
  conversationFacts: ConversationFactsJson;
};

type Tx = Pick<
  PrismaClient,
  | 'orgUser'
  | 'note'
  | 'caseManagement'
  | 'caseRouterRun'
  | 'episodeOfCare'
  | 'noteBrief'
  | 'copilotMessage'
  | 'copilotConversation'
  // Sprint 0.15 — populate caseAwarenessJson[].fhirMirror from the FHIR
  // cache. Pinned to the narrow Pick so test fixtures can mock just this
  // call without standing up the whole prisma surface.
  | 'fhirCachedResource'
  // Sprint 0.16 — surface unresolved drift logs as the
  // `case_fhir_status_drift` observed pattern.
  | 'caseFhirDriftLog'
>;

/**
 * Build the three projections deterministically. Runs *without* touching
 * the DB write path — the worker handles the upsert + audit. Exported as
 * a pure helper so tests can drive it with a mocked prisma without setting
 * up the worker harness.
 */
export async function buildStateProjections(
  args: RebuildArgs,
  client: Tx = defaultPrisma as unknown as Tx,
): Promise<StateProjections> {
  const { orgId, patientId, clinicianOrgUserId } = args;

  // Viewer's division — drives the viewerDivisionLastActivityAt signal in
  // case-awareness + lets the agent reason about cross-division activity.
  const clinician = await client.orgUser.findUnique({
    where: { id: clinicianOrgUserId },
    select: { professionType: true, division: true },
  });
  const viewerDivision = clinician
    ? divisionForProfession(clinician.professionType) ?? clinician.division ?? null
    : null;

  // Pull the bounded last-N signed notes for the patient. Rule 20 fence:
  // status IN (SIGNED, TRANSFERRED) only — drafts NEVER inform the state.
  const signedNotes = await client.note.findMany({
    where: {
      orgId,
      patientId,
      status: { in: ['SIGNED', 'TRANSFERRED'] },
    },
    orderBy: { signedAt: 'desc' },
    take: NOTE_WINDOW,
    select: {
      id: true,
      signedAt: true,
      division: true,
      clinicianOrgUserId: true,
      transcriptClean: true,
      finalJson: true,
      encounter: { select: { caseManagementId: true, episodeOfCareId: true } },
    },
  });

  const allCases = await client.caseManagement.findMany({
    where: { orgId, patientId },
    select: {
      id: true,
      primaryIcd: true,
      primaryIcdLabel: true,
      status: true,
      // Sprint 0.15 — FHIR mirror link. Populated by the accept-route's
      // `open-new-from-condition` branch; null on all other cases.
      mirrorsFhirConditionId: true,
    },
    orderBy: { openedAt: 'desc' },
  });

  const routerRuns = await client.caseRouterRun.findMany({
    where: { orgId, note: { patientId } },
    include: { note: { select: { encounter: { select: { caseManagementId: true } } } } },
    orderBy: { createdAt: 'desc' },
  });

  // Sprint 0.15 — for cases that mirror a FHIR Condition, look up the
  // matching `FhirCachedResource` so the projection can include
  // clinicalStatus + lastUpdated. Tolerant of cache misses: the mirror
  // entry still populates (conditionId + ehrSystem are authoritative),
  // and the optional fields read null. We default ehrSystem to
  // 'nextgen' for the lookup — multi-EHR is Unit 24 / F6 polish.
  const mirroredConditionIds = allCases
    .map((c) => c.mirrorsFhirConditionId)
    .filter((id): id is string => !!id);
  const fhirMirrorCacheRows = mirroredConditionIds.length > 0
    ? await client.fhirCachedResource.findMany({
        where: {
          patientId,
          resourceType: 'Condition',
          fhirResourceId: { in: mirroredConditionIds },
        },
        select: {
          fhirResourceId: true,
          ehrSystem: true,
          resource: true,
          fetchedAt: true,
        },
      })
    : [];
  const fhirMirrorByConditionId = new Map<
    string,
    { ehrSystem: string; clinicalStatus: string | null; lastUpdated: string | null }
  >();
  for (const row of fhirMirrorCacheRows) {
    const bundle = row.resource as
      | {
          raw?: { meta?: { lastUpdated?: string } };
          simplified?: { clinicalStatus?: string | null };
        }
      | null;
    fhirMirrorByConditionId.set(row.fhirResourceId, {
      ehrSystem: row.ehrSystem,
      clinicalStatus: bundle?.simplified?.clinicalStatus ?? null,
      lastUpdated: bundle?.raw?.meta?.lastUpdated ?? row.fetchedAt.toISOString(),
    });
  }

  // (Open follow-ups deliberately not loaded here in Phase 1. The chart
  // cockpit tile reads them directly, and the conversationFacts derivation
  // already cites them via prior assistant turns. Phase 2 may add a
  // `followup_unanswered` pattern detector; when it does, surface the
  // read here.)

  const episodes = await client.episodeOfCare.findMany({
    where: { orgId, patientId, status: { in: ['ACTIVE', 'RECERT_DUE'] } },
    select: {
      id: true,
      diagnosis: true,
      recertDueAt: true,
      goals: {
        select: {
          id: true,
          goalText: true,
          status: true,
          progressEntries: {
            orderBy: { recordedAt: 'desc' },
            take: 1,
            select: { recordedAt: true },
          },
        },
      },
    },
  });

  const latestBrief = await client.noteBrief.findFirst({
    where: { orgId, patientId },
    orderBy: { generatedAt: 'desc' },
  });

  // Conversation facts come from THIS clinician's CHART conversation only
  // — research-mode chats are patient-agnostic and would dilute the patient
  // projection. Cleo's memory is per (patient × clinician × CHART).
  const conversation = await client.copilotConversation.findUnique({
    where: {
      orgId_patientId_clinicianOrgUserId_mode: {
        orgId,
        patientId,
        clinicianOrgUserId,
        mode: 'CHART',
      },
    },
    select: { id: true },
  });
  const assistantMessages = conversation
    ? await client.copilotMessage.findMany({
        where: { conversationId: conversation.id, role: 'assistant' },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { sourcesJson: true, createdAt: true },
      })
    : [];

  // ---- Case awareness ----
  const routerRunsByCase = new Map<
    string,
    Array<{ runId: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; acceptedAction: string | null; at: string }>
  >();
  for (const run of routerRuns) {
    const caseId = run.note?.encounter?.caseManagementId ?? null;
    if (!caseId) continue;
    const arr = routerRunsByCase.get(caseId) ?? [];
    arr.push({
      runId: run.id,
      confidence: run.confidence,
      acceptedAction: run.acceptedAction,
      at: (run.acceptedAt ?? run.createdAt).toISOString(),
    });
    routerRunsByCase.set(caseId, arr);
  }

  const caseAwareness: CaseAwarenessJson = {
    cases: allCases.map((c) => {
      const recency = viewerRecencyForCase({
        caseId: c.id,
        signedNotes,
        viewerOrgUserId: clinicianOrgUserId,
        viewerDivision,
      });
      // Sprint 0.15 — populate fhirMirror when the case carries a
      // mirrorsFhirConditionId. The cache lookup is best-effort: a
      // cache miss still produces a valid mirror entry (conditionId +
      // ehrSystem from the case, clinicalStatus + lastUpdated null).
      let fhirMirror: CaseAwarenessJson['cases'][number]['fhirMirror'] = null;
      if (c.mirrorsFhirConditionId) {
        const cached = fhirMirrorByConditionId.get(c.mirrorsFhirConditionId);
        fhirMirror = {
          conditionId: c.mirrorsFhirConditionId,
          ehrSystem: cached?.ehrSystem ?? 'nextgen',
          clinicalStatus: cached?.clinicalStatus ?? null,
          lastUpdated: cached?.lastUpdated ?? null,
        };
      }
      return {
        id: c.id,
        primaryIcd: c.primaryIcd,
        primaryIcdLabel: c.primaryIcdLabel,
        status: c.status,
        lastViewerActivityAt: recency.viewerLastActivityAt,
        lastViewerDivisionActivityAt: recency.viewerDivisionLastActivityAt,
        lastActivityAt: recency.lastActivityAt,
        routingConfidenceHistory: routerRunsByCase.get(c.id) ?? [],
        fhirMirror,
      };
    }),
  };

  // Sprint 0.16 — unresolved FHIR drift logs become observed patterns.
  // Patient-wide query (drifts aren't per-clinician); the projection
  // exposes them to whatever clinician's state we're rebuilding so the
  // Cleo's-read card can surface them regardless of who detected the
  // drift originally.
  const openDriftLogs = await client.caseFhirDriftLog.findMany({
    where: { orgId, patientId, resolvedAt: null },
    orderBy: { detectedAt: 'desc' },
    select: {
      id: true,
      caseManagementId: true,
      fhirConditionId: true,
      driftKind: true,
      detectedAt: true,
    },
  });

  // ---- Observed patterns ----
  const patterns: ObservedPattern[] = [];

  const briefContent = latestBrief?.content as PriorContextBriefContent | null;
  patterns.push(
    ...detectTopicMentionedUnaddressed(signedNotes),
    ...detectMeasureTrend(briefContent ?? null, latestBrief?.noteId ?? null),
    ...detectRecertDueSoon(episodes),
    ...detectGoalStalled(episodes),
    ...detectCaseFhirDrift(openDriftLogs),
  );

  const observedPatterns: ObservedPatternsJson = { patterns };

  // ---- Conversation facts (distilled from prior assistant turns) ----
  const facts: ConversationFact[] = [];
  for (const msg of assistantMessages) {
    const sources = parseSources(msg.sourcesJson);
    for (const s of sources) {
      const fact = sourceToFact(s, msg.createdAt);
      if (fact) facts.push(fact);
    }
  }
  // Dedup by (kind:id) — multiple chats may cite the same source.
  const dedup = new Map<string, ConversationFact>();
  for (const f of facts) {
    const key = factKey(f);
    if (!dedup.has(key)) dedup.set(key, f);
  }
  const distinctFacts = Array.from(dedup.values()).slice(0, MAX_CONVERSATION_FACTS);
  const conversationFacts: ConversationFactsJson = { facts: distinctFacts };

  // Zod-validate on the way out so a detector regression surfaces here
  // (not at the DB write or worse, in the agent's prompt).
  return {
    caseAwareness: CaseAwarenessJsonSchema.parse(caseAwareness),
    observedPatterns: ObservedPatternsJsonSchema.parse(observedPatterns),
    conversationFacts: ConversationFactsJsonSchema.parse(conversationFacts),
  };
}

// =============================================================================
// Pattern detectors — each pure, each citational.
// =============================================================================

type NoteForDetector = {
  id: string;
  signedAt: Date | null;
  transcriptClean: Prisma.JsonValue | null;
  finalJson: Prisma.JsonValue | null;
};

/**
 * Detector 1 — `topic_mentioned_unaddressed`.
 *
 * A bounded keyword appears in N consecutive recent notes' transcripts
 * but never in any of their Plan sections. Fires once per topic.
 */
export function detectTopicMentionedUnaddressed(
  signedNotes: NoteForDetector[],
): ObservedPattern[] {
  // Walk newest → oldest. The spec says "N consecutive" — interpret as
  // "appears in the last N consecutive notes" (most-recent window).
  const out: ObservedPattern[] = [];
  if (signedNotes.length < TOPIC_THRESHOLD) return out;

  for (const { topic, keywords } of UNADDRESSED_TOPIC_KEYWORDS) {
    const hitNoteIds: string[] = [];
    let firstSeen: string | null = null;
    let lastSeen: string | null = null;
    // Iterate from most recent window first.
    for (let i = 0; i < Math.min(signedNotes.length, NOTE_WINDOW); i++) {
      const n = signedNotes[i]!;
      const transcript = extractTranscriptText(n.transcriptClean);
      const plan = extractPlanText(n.finalJson);
      const mentioned = keywords.some((k) => containsWord(transcript, k));
      const addressed = keywords.some((k) => containsWord(plan, k));
      if (mentioned && !addressed) {
        hitNoteIds.push(n.id);
        if (n.signedAt) {
          const iso = n.signedAt.toISOString();
          if (!lastSeen) lastSeen = iso;
          firstSeen = iso;
        }
      } else if (mentioned && addressed) {
        // Topic was addressed at least once in the window — the pattern
        // resets. Don't break, but don't carry the streak past this note.
        // (Spec is loose; we err on the side of "if it's been addressed,
        // it's not 'unaddressed' anymore" so the card stops nagging.)
        hitNoteIds.length = 0;
        firstSeen = null;
        lastSeen = null;
      }
    }
    if (hitNoteIds.length >= TOPIC_THRESHOLD && firstSeen && lastSeen) {
      out.push({
        kind: 'topic_mentioned_unaddressed',
        label: `${capitalize(topic)} mentioned in last ${hitNoteIds.length} visits (unaddressed)`,
        detail: { topic, keywords: [...keywords] },
        observedInNoteIds: hitNoteIds,
        count: hitNoteIds.length,
        firstSeen,
        lastSeen,
      });
    }
  }
  return out;
}

/**
 * Detector 2 — `measure_trend`.
 *
 * A SnapshotMeasure value moves monotonically over the last 3+ visits.
 * Source: the latest NoteBrief's `objectiveMeasures` — already extracted
 * by the brief generator (rule 20: pre-attested signal).
 */
export function detectMeasureTrend(
  briefContent: PriorContextBriefContent | null,
  briefNoteId: string | null,
): ObservedPattern[] {
  if (!briefContent || !briefNoteId) return [];
  const out: ObservedPattern[] = [];
  for (const m of briefContent.objectiveMeasures ?? []) {
    // The brief already classifies trend; we only fire when the trend is
    // a real direction AND we have >= 3 readings (latest + priorValues).
    if (m.trend === 'unknown' || m.trend === 'stable') continue;
    const allValues = [m.lastValue, ...(m.priorValues ?? [])];
    if (allValues.length < TREND_THRESHOLD) continue;
    out.push({
      kind: 'measure_trend',
      label: `${m.measure} trending ${m.trend} (${allValues.length} readings)`,
      detail: {
        measure: m.measure,
        measureKey: m.measureKey ?? null,
        unit: m.unit ?? null,
        latestValue: m.lastValue,
        priorValues: m.priorValues ?? [],
        trend: m.trend,
      },
      observedInNoteIds: [m.sourceNoteId, briefNoteId].filter(
        (v, i, a) => a.indexOf(v) === i,
      ),
      count: allValues.length,
      // The brief is the snapshot; the source note is the citation. Use
      // brief generation time as "lastSeen" — it's the most recent
      // attested observation we have.
      firstSeen: '',
      lastSeen: '',
    });
  }
  // Stamp firstSeen / lastSeen based on the brief's generatedAt — the
  // schema requires non-empty strings.
  const at = briefContent.generatedAt ?? new Date().toISOString();
  for (const p of out) {
    p.firstSeen = at;
    p.lastSeen = at;
  }
  return out;
}

/**
 * Detector 3 — `recert_due_soon`.
 *
 * A REHAB episode's recertDueAt falls within RECERT_DUE_DAYS days.
 * (EpisodeOfCare is REHAB-only per Sprint 0.11's CHECK constraint.)
 */
export function detectRecertDueSoon(
  episodes: Array<{
    id: string;
    diagnosis: string;
    recertDueAt: Date | null;
  }>,
  now: Date = new Date(),
): ObservedPattern[] {
  const out: ObservedPattern[] = [];
  const horizonMs = now.getTime() + RECERT_DUE_DAYS * 86_400_000;
  for (const ep of episodes) {
    if (!ep.recertDueAt) continue;
    if (ep.recertDueAt.getTime() <= horizonMs && ep.recertDueAt.getTime() >= now.getTime()) {
      const daysAway = Math.max(
        0,
        Math.ceil((ep.recertDueAt.getTime() - now.getTime()) / 86_400_000),
      );
      out.push({
        kind: 'recert_due_soon',
        label: `Recert due in ${daysAway} day${daysAway === 1 ? '' : 's'} — ${ep.diagnosis}`,
        detail: {
          episodeId: ep.id,
          diagnosis: ep.diagnosis,
          recertDueAt: ep.recertDueAt.toISOString(),
          daysUntilDue: daysAway,
        },
        observedInEpisodeIds: [ep.id],
        observedInNoteIds: [],
        count: 1,
        firstSeen: ep.recertDueAt.toISOString(),
        lastSeen: now.toISOString(),
      });
    }
  }
  return out;
}

/**
 * Detector 4 — `goal_stalled`.
 *
 * A Goal with status ACTIVE has had no GoalProgressEntry update in
 * GOAL_STALLED_DAYS. Helps the clinician see "this goal has been sitting
 * static for a month" without paging through the rehab tab.
 */
export function detectGoalStalled(
  episodes: Array<{
    id: string;
    goals: Array<{
      id: string;
      goalText: string;
      status: string;
      progressEntries: Array<{ recordedAt: Date }>;
    }>;
  }>,
  now: Date = new Date(),
): ObservedPattern[] {
  const out: ObservedPattern[] = [];
  const cutoffMs = now.getTime() - GOAL_STALLED_DAYS * 86_400_000;
  for (const ep of episodes) {
    for (const g of ep.goals) {
      if (g.status !== 'ACTIVE') continue;
      const latestEntry = g.progressEntries[0]?.recordedAt ?? null;
      if (latestEntry && latestEntry.getTime() >= cutoffMs) continue;
      // ACTIVE goal with no entry OR last entry older than the cutoff.
      const lastSeen = latestEntry ?? now;
      out.push({
        kind: 'goal_stalled',
        label: `Goal stalled (${GOAL_STALLED_DAYS}+ days) — ${truncateLabel(g.goalText, 60)}`,
        detail: {
          goalId: g.id,
          episodeId: ep.id,
          goalText: g.goalText,
          stalledDays: latestEntry
            ? Math.floor((now.getTime() - latestEntry.getTime()) / 86_400_000)
            : null,
          lastEntryAt: latestEntry?.toISOString() ?? null,
        },
        observedInGoalIds: [g.id],
        observedInEpisodeIds: [ep.id],
        observedInNoteIds: [],
        count: 1,
        firstSeen: lastSeen.toISOString(),
        lastSeen: now.toISOString(),
      });
    }
  }
  return out;
}

/**
 * Detector 5 (Sprint 0.16) — `case_fhir_status_drift`.
 *
 * One pattern entry per unresolved `CaseFhirDriftLog` row. The
 * loader at the call site filters `resolvedAt IS NULL` (open drifts
 * only); this detector is a pure projection from those rows.
 *
 * `observedInNoteIds` is left empty — drift isn't anchored to a note;
 * it's an event between OmniScribe + EHR. The `detail` carries the
 * driftLogId so the Cleo's-read card / Cases tab can deep-link into
 * the appropriate review surface.
 */
export function detectCaseFhirDrift(
  driftLogs: Array<{
    id: string;
    caseManagementId: string;
    fhirConditionId: string;
    driftKind: 'STATUS' | 'ICD';
    detectedAt: Date;
  }>,
): ObservedPattern[] {
  return driftLogs.map((log) => ({
    kind: 'case_fhir_status_drift' as const,
    label: `EHR drift on case (${log.driftKind.toLowerCase()})`,
    detail: {
      driftLogId: log.id,
      caseManagementId: log.caseManagementId,
      fhirConditionId: log.fhirConditionId,
      driftKind: log.driftKind,
      detectedAt: log.detectedAt.toISOString(),
    },
    observedInNoteIds: [],
    count: 1,
    firstSeen: log.detectedAt.toISOString(),
    lastSeen: log.detectedAt.toISOString(),
  }));
}

// =============================================================================
// Helpers.
// =============================================================================

function extractTranscriptText(json: Prisma.JsonValue | null): string {
  if (!json || typeof json !== 'object') return '';
  const candidate = json as { plaintext?: unknown };
  return typeof candidate.plaintext === 'string' ? candidate.plaintext.toLowerCase() : '';
}

function extractPlanText(json: Prisma.JsonValue | null): string {
  if (!json || typeof json !== 'object') return '';
  const candidate = json as {
    sections?: Array<{ id?: string; label?: string; content?: string }>;
  };
  const sections = Array.isArray(candidate.sections) ? candidate.sections : [];
  const plan = sections.find(
    (s) => (s.label && /plan/i.test(s.label)) || (s.id && /plan/i.test(s.id)),
  );
  return typeof plan?.content === 'string' ? plan.content.toLowerCase() : '';
}

function containsWord(haystack: string, needle: string): boolean {
  if (!haystack) return false;
  const re = new RegExp(`\\b${escapeRegex(needle)}\\b`, 'i');
  return re.test(haystack);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function truncateLabel(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

type AssistantSource = {
  kind: 'note' | 'follow-up' | 'goal' | 'patient' | 'fhir' | 'literature' | 'llm-intrinsic';
  id: string;
  label: string;
};

function parseSources(json: Prisma.JsonValue | null): AssistantSource[] {
  if (!json) return [];
  if (!Array.isArray(json)) return [];
  const out: AssistantSource[] = [];
  for (const item of json) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    if (
      (s.kind === 'note' ||
        s.kind === 'follow-up' ||
        s.kind === 'goal' ||
        s.kind === 'patient' ||
        s.kind === 'fhir' ||
        s.kind === 'literature' ||
        s.kind === 'llm-intrinsic') &&
      typeof s.id === 'string' &&
      typeof s.label === 'string'
    ) {
      out.push({ kind: s.kind, id: s.id, label: s.label });
    }
  }
  return out;
}

function sourceToFact(s: AssistantSource, citedAt: Date): ConversationFact | null {
  // Map source kinds → fact fields. literature + llm-intrinsic + patient
  // sources don't anchor to a primary clinical record; we skip them in
  // Phase 1 so the projection stays tight.
  const at = citedAt.toISOString();
  if (s.kind === 'note') {
    return { summary: s.label, sourceNoteId: s.id, citedAt: at };
  }
  if (s.kind === 'follow-up') {
    return { summary: s.label, sourceFollowUpId: s.id, citedAt: at };
  }
  if (s.kind === 'goal') {
    return { summary: s.label, sourceGoalId: s.id, citedAt: at };
  }
  if (s.kind === 'fhir') {
    return { summary: s.label, sourceConditionId: s.id, citedAt: at };
  }
  return null;
}

function factKey(f: ConversationFact): string {
  if (f.sourceNoteId) return `note:${f.sourceNoteId}`;
  if (f.sourceFollowUpId) return `followup:${f.sourceFollowUpId}`;
  if (f.sourceGoalId) return `goal:${f.sourceGoalId}`;
  if (f.sourceConditionId) return `fhir:${f.sourceConditionId}`;
  return `summary:${f.summary}`;
}
