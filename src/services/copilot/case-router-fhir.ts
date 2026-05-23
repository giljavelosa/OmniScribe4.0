/**
 * Sprint 0.15 — FHIR Condition fetcher for Miss Cleo's case-router.
 *
 * Pure projector that turns the patient's verified, locally-cached FHIR
 * `Condition` resources into the structured input the case-router agent
 * consumes (one entry per active Condition).
 *
 * Rule 20 (verified FHIR resources only) lives at two gates:
 *   1. `PatientFhirIdentity.matchConfidence === 'verified'` — the
 *      clinician-confirmed link from Unit 20 (F2). No verified link → no
 *      Conditions returned.
 *   2. We read from `FhirCachedResource`, which is populated EXCLUSIVELY
 *      by the F3 sync orchestrator after a verified link. The cache IS
 *      the canonical "verified FHIR" projection. We do NOT make live
 *      FHIR HTTP calls here — the worker has no clinician-in-the-loop
 *      OAuth identity, and the brief enrichment path
 *      (`loadExternalEhrContext`) already established the cache-read
 *      convention for "verified-only" reads.
 *
 * Decision 7 (graceful degradation): every non-happy path returns
 * `{ ok: false, errorKind: ... }` instead of throwing. The worker maps
 * those kinds to the `CASE_ROUTER_FHIR_UNAVAILABLE` audit and continues
 * with an empty `fhirConditions` array — the routing decision still
 * ships using native data. The fetcher never bubbles into BullMQ retries
 * (rule 10) because a transient FHIR issue should NOT burn the agent's
 * three retry attempts.
 *
 * Active-only filter (decision 2): we surface only Conditions whose
 * `clinicalStatus = active`. The agent should not propose "open new
 * from a resolved diagnosis."
 *
 * 4-second wall-clock timeout (decision 2): a cache read is well under
 * 50ms in practice, but we bound it so a worst-case Prisma stall can't
 * push the whole routing decision past the 60s panel timeout.
 */

import type { Prisma } from '@prisma/client';

import { prisma as defaultPrisma } from '@/lib/prisma';
import type { SimplifiedCondition } from '@/services/fhir/adapters';
import { isStale } from '@/lib/fhir/staleness';

const TIMEOUT_MS = 4_000;

/**
 * Shape the case-router agent consumes. Stays narrow on purpose — the
 * agent reasons about routing, not about the full FHIR resource.
 */
export type FhirConditionForRouter = {
  fhirId: string;
  /** ICD-10 code (or whatever coding system the EHR uses). Required —
   *  the routing decision turns on having a coded value. */
  icd: string;
  icdLabel: string;
  /** Per spec — Conditions returned by the fetcher are always
   *  clinically-active in this sprint. We carry the field through so
   *  Sprint 0.16's reconciliation work doesn't need a schema change. */
  clinicalStatus: 'active';
  /** ISO YYYY-MM-DD. */
  recordedDate: string;
  /** Practitioner display name from `Condition.recorder.display` when
   *  present, otherwise null. The EHR may not always populate it. */
  recorderName: string | null;
  /** ISO datetime from `Resource.meta.lastUpdated`, falling back to the
   *  cache's `fetchedAt` so we always carry SOMETHING for the citation
   *  pill + audit metadata. */
  lastUpdated: string;
};

/**
 * Error kinds the worker turns into audit metadata. Spec decision 7
 * lists `'timeout'|'auth'|'5xx'` for a live-call implementation; we
 * read from cache instead and map to the equivalent
 * cache-and-link-state failure modes:
 *
 *   - `'not_linked'` — no verified `PatientFhirIdentity` for the
 *     patient + ehrSystem. (Most common — non-FHIR patients.) The
 *     worker should NOT emit `CASE_ROUTER_FHIR_UNAVAILABLE` on this
 *     kind; "the patient was never linked" isn't a system failure,
 *     it's the baseline state for non-EHR patients.
 *   - `'no_cache'` — link verified, but the resource cache is empty
 *     or fully stale (> 7d per `staleness.ts`). Roughly analogous to
 *     a live `404 + auth-ok` outcome.
 *   - `'timeout'` — the cache read didn't return inside 4s.
 *   - `'cache_error'` — Prisma threw or the cache row JSON was
 *     malformed. Analogous to a live 5xx.
 *
 * Worker emits `CASE_ROUTER_FHIR_UNAVAILABLE` for `no_cache`,
 * `timeout`, and `cache_error` — i.e. cases where the org HAS FHIR
 * wired and SOMETHING went wrong fetching this patient's Conditions.
 */
export type FhirFetchErrorKind =
  | 'not_linked'
  | 'no_cache'
  | 'timeout'
  | 'cache_error';

export type FetchPatientConditionsResult =
  | { ok: true; conditions: FhirConditionForRouter[]; ehrSystem: string }
  | { ok: false; errorKind: FhirFetchErrorKind };

export type FetchPatientConditionsArgs = {
  /** Org scope for the cache read. The cache is keyed on patientId +
   *  ehrSystem, but org-scoping the read is defense in depth. */
  orgId: string;
  patientId: string;
  /** Defaults to 'nextgen' to match the existing brief enrichment path
   *  in `loadExternalEhrContext`. Multi-EHR per org is Unit 24 / F6 polish. */
  ehrSystem?: string;
  /** Optional — used by tests to control the staleness clock. */
  now?: Date;
};

/**
 * Read the patient's locally-cached active FHIR Conditions and project
 * them into the case-router-agent-friendly shape. See module header for
 * the rule-20 + cache-vs-live design rationale.
 */
export async function fetchPatientConditions(
  args: FetchPatientConditionsArgs,
  client: Pick<typeof defaultPrisma, 'patientFhirIdentity' | 'fhirCachedResource'> =
    defaultPrisma,
): Promise<FetchPatientConditionsResult> {
  const ehrSystem = args.ehrSystem ?? 'nextgen';
  const now = args.now ?? new Date();

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<FetchPatientConditionsResult>((resolve) => {
    timeoutHandle = setTimeout(
      () => resolve({ ok: false, errorKind: 'timeout' }),
      TIMEOUT_MS,
    );
  });

  const work = (async (): Promise<FetchPatientConditionsResult> => {
    try {
      // Gate 1: verified patient-level FHIR link. No verified link means
      // the agent never sees Conditions — same as a non-FHIR patient.
      const verifiedLink = await client.patientFhirIdentity.findFirst({
        where: {
          patientId: args.patientId,
          ehrSystem,
          matchConfidence: 'verified',
        },
        select: { id: true, fhirPatientId: true },
      });
      if (!verifiedLink) {
        return { ok: false, errorKind: 'not_linked' };
      }

      // Gate 2: locally-cached Condition rows for this patient.
      const rows = await client.fhirCachedResource.findMany({
        where: {
          patientId: args.patientId,
          ehrSystem,
          resourceType: 'Condition',
        },
        orderBy: { fetchedAt: 'desc' },
        select: {
          fhirResourceId: true,
          resource: true,
          fetchedAt: true,
        },
      });

      const fresh = rows.filter((r) => !isStale(r.fetchedAt, now));
      if (fresh.length === 0) {
        return { ok: false, errorKind: 'no_cache' };
      }

      const conditions: FhirConditionForRouter[] = [];
      for (const row of fresh) {
        const bundle = row.resource as
          | {
              raw?: Record<string, unknown> & { meta?: { lastUpdated?: string } };
              simplified?: SimplifiedCondition;
            }
          | null;
        const simplified = bundle?.simplified;
        const raw = bundle?.raw;
        if (!simplified) continue;
        // Active-only filter per spec decision 2.
        if (simplified.clinicalStatus !== 'active') continue;
        if (!simplified.code || !simplified.display) continue;
        if (!simplified.recordedDate) continue;

        conditions.push({
          fhirId: row.fhirResourceId,
          icd: simplified.code,
          icdLabel: simplified.display,
          clinicalStatus: 'active',
          recordedDate: simplified.recordedDate,
          recorderName: extractRecorderName(raw),
          lastUpdated:
            raw?.meta?.lastUpdated ?? row.fetchedAt.toISOString(),
        });
      }

      return { ok: true, conditions, ehrSystem };
    } catch (err) {
      // Malformed cache JSON, Prisma timeout, etc. We swallow the
      // class + message inside the audit metadata via the worker, NOT
      // here — anti-regression rule 8 says audit writes belong to the
      // caller, not this fetcher.
      void err;
      return { ok: false, errorKind: 'cache_error' };
    }
  })();

  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/** Reach into the raw FHIR Condition for `recorder.display`. Tolerant
 *  of missing structure — many EHRs send only a reference URL. */
function extractRecorderName(
  raw: Record<string, unknown> | undefined,
): string | null {
  if (!raw) return null;
  const recorder = raw.recorder as
    | { display?: unknown; reference?: unknown }
    | undefined;
  if (recorder && typeof recorder.display === 'string' && recorder.display.trim()) {
    return recorder.display.trim();
  }
  return null;
}

// =============================================================================
// Audit-citation projection — what the worker stamps onto
// `proposalJson.fhirCitations` + the `CASE_ROUTER_FHIR_CITED` audit row.
// =============================================================================

export type FhirCitation = {
  resourceType: 'Condition';
  fhirId: string;
  lastUpdated: string;
  recorder: string | null;
  recordedDate: string;
};

/**
 * Project the fetcher's output into the audit-citation shape stamped onto
 * `CaseRouterRun.proposalJson.fhirCitations`. Exported so the worker +
 * tests share one source of truth.
 */
export function toFhirCitations(
  conditions: FhirConditionForRouter[],
): FhirCitation[] {
  return conditions.map((c) => ({
    resourceType: 'Condition' as const,
    fhirId: c.fhirId,
    lastUpdated: c.lastUpdated,
    recorder: c.recorderName,
    recordedDate: c.recordedDate,
  }));
}

// Re-export the Prisma JSON shape so callers don't need to import Prisma
// directly when forwarding cached resource JSON.
export type FhirCachedResourceJson = Prisma.JsonValue;
