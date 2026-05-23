import { describe, expect, it, vi } from 'vitest';

import {
  fetchPatientConditions,
  toFhirCitations,
} from '@/services/copilot/case-router-fhir';

/**
 * Sprint 0.15 — case-router FHIR fetcher tests.
 *
 * Coverage targets per the spec's "Verify when done":
 *   1. Happy path — verified patient link + fresh active Condition →
 *      structured FhirConditionForRouter[] returned.
 *   2. Non-linked patient → { ok: false, errorKind: 'not_linked' } so
 *      the worker doesn't audit a degradation that isn't one.
 *   3. Empty cache → { ok: false, errorKind: 'no_cache' }.
 *   4. Stale-only cache → 'no_cache' (we only surface fresh rows).
 *   5. clinicalStatus filter — resolved Conditions are excluded.
 *   6. Cache read throws → { ok: false, errorKind: 'cache_error' }.
 *   7. recorder.display fallback — null when missing or non-string.
 *   8. `toFhirCitations` projection round-trips correctly.
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function makeClient(opts: {
  identity?: unknown;
  rows?: unknown[];
  throwOnRows?: boolean;
}) {
  const patientFhirIdentity = {
    findFirst: vi.fn().mockResolvedValue(opts.identity ?? null),
  };
  const fhirCachedResource = {
    findMany: opts.throwOnRows
      ? vi.fn().mockRejectedValue(new Error('cache exploded'))
      : vi.fn().mockResolvedValue(opts.rows ?? []),
  };
  return { patientFhirIdentity, fhirCachedResource };
}

function activeConditionRow(opts: {
  fhirId: string;
  code?: string;
  display?: string;
  recordedDate?: string | null;
  recorder?: { display?: unknown } | null;
  lastUpdated?: string | null;
  fetchedAtDaysAgo?: number;
  clinicalStatus?: 'active' | 'resolved';
}) {
  const fetchedAt = new Date(Date.now() - (opts.fetchedAtDaysAgo ?? 1) * ONE_DAY_MS);
  return {
    fhirResourceId: opts.fhirId,
    resource: {
      raw: {
        resourceType: 'Condition',
        id: opts.fhirId,
        ...(opts.recorder !== null ? { recorder: opts.recorder ?? { display: 'Dr. Patel' } } : {}),
        meta: opts.lastUpdated ? { lastUpdated: opts.lastUpdated } : undefined,
      },
      simplified: {
        code: opts.code ?? 'M54.81',
        display: opts.display ?? 'Cervicogenic headache',
        clinicalStatus: opts.clinicalStatus ?? 'active',
        onsetDate: '2024-08-15',
        recordedDate: opts.recordedDate ?? '2024-08-15',
      },
    },
    fetchedAt,
  };
}

describe('fetchPatientConditions', () => {
  it('happy path — returns structured Conditions from verified-linked patient cache', async () => {
    const client = makeClient({
      identity: { id: 'pfi_1', fhirPatientId: 'fhir-pat-1' },
      rows: [
        activeConditionRow({
          fhirId: 'cond_1',
          code: 'M54.81',
          display: 'Cervicogenic headache',
          lastUpdated: '2024-08-16T10:00:00Z',
        }),
      ],
    });

    const result = await fetchPatientConditions(
      { orgId: 'org_1', patientId: 'pat_1' },
      client as never,
    );

    expect(result).toEqual({
      ok: true,
      ehrSystem: 'nextgen',
      conditions: [
        {
          fhirId: 'cond_1',
          icd: 'M54.81',
          icdLabel: 'Cervicogenic headache',
          clinicalStatus: 'active',
          recordedDate: '2024-08-15',
          recorderName: 'Dr. Patel',
          lastUpdated: '2024-08-16T10:00:00Z',
        },
      ],
    });
    expect(client.patientFhirIdentity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          patientId: 'pat_1',
          ehrSystem: 'nextgen',
          matchConfidence: 'verified',
        }),
      }),
    );
  });

  it('non-linked patient returns errorKind: not_linked', async () => {
    const client = makeClient({ identity: null });
    const result = await fetchPatientConditions(
      { orgId: 'org_1', patientId: 'pat_x' },
      client as never,
    );
    expect(result).toEqual({ ok: false, errorKind: 'not_linked' });
    // Cache is never queried when the patient isn't linked.
    expect(client.fhirCachedResource.findMany).not.toHaveBeenCalled();
  });

  it('verified link but empty cache returns errorKind: no_cache', async () => {
    const client = makeClient({
      identity: { id: 'pfi_1', fhirPatientId: 'fhir-pat-1' },
      rows: [],
    });
    const result = await fetchPatientConditions(
      { orgId: 'org_1', patientId: 'pat_1' },
      client as never,
    );
    expect(result).toEqual({ ok: false, errorKind: 'no_cache' });
  });

  it('all-stale cache (>7d) is treated as no_cache', async () => {
    const client = makeClient({
      identity: { id: 'pfi_1', fhirPatientId: 'fhir-pat-1' },
      rows: [
        activeConditionRow({ fhirId: 'cond_stale', fetchedAtDaysAgo: 30 }),
      ],
    });
    const result = await fetchPatientConditions(
      { orgId: 'org_1', patientId: 'pat_1' },
      client as never,
    );
    expect(result).toEqual({ ok: false, errorKind: 'no_cache' });
  });

  it('filters out non-active Conditions per decision 2', async () => {
    const client = makeClient({
      identity: { id: 'pfi_1', fhirPatientId: 'fhir-pat-1' },
      rows: [
        activeConditionRow({
          fhirId: 'cond_resolved',
          clinicalStatus: 'resolved',
        }),
        activeConditionRow({
          fhirId: 'cond_active',
          code: 'I10',
          display: 'Essential hypertension',
        }),
      ],
    });
    const result = await fetchPatientConditions(
      { orgId: 'org_1', patientId: 'pat_1' },
      client as never,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.conditions).toHaveLength(1);
      expect(result.conditions[0]?.fhirId).toBe('cond_active');
    }
  });

  it('cache-read throw maps to errorKind: cache_error (never bubbles)', async () => {
    const client = makeClient({
      identity: { id: 'pfi_1', fhirPatientId: 'fhir-pat-1' },
      throwOnRows: true,
    });
    const result = await fetchPatientConditions(
      { orgId: 'org_1', patientId: 'pat_1' },
      client as never,
    );
    expect(result).toEqual({ ok: false, errorKind: 'cache_error' });
  });

  it('recorderName falls back to null when recorder.display is missing or non-string', async () => {
    const client = makeClient({
      identity: { id: 'pfi_1', fhirPatientId: 'fhir-pat-1' },
      rows: [
        // recorder present but no display string.
        activeConditionRow({
          fhirId: 'cond_a',
          recorder: { display: undefined },
        }),
        // recorder block entirely absent (null sentinel).
        activeConditionRow({
          fhirId: 'cond_b',
          recorder: null,
        }),
      ],
    });
    const result = await fetchPatientConditions(
      { orgId: 'org_1', patientId: 'pat_1' },
      client as never,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.conditions.map((c) => c.recorderName)).toEqual([null, null]);
    }
  });

  it('lastUpdated falls back to fetchedAt when raw.meta is absent', async () => {
    const fixedFetchedAt = new Date('2025-12-01T10:00:00Z');
    const client = makeClient({
      identity: { id: 'pfi_1', fhirPatientId: 'fhir-pat-1' },
      rows: [
        {
          fhirResourceId: 'cond_no_meta',
          resource: {
            raw: { resourceType: 'Condition', id: 'cond_no_meta' },
            simplified: {
              code: 'I10',
              display: 'Essential hypertension',
              clinicalStatus: 'active',
              onsetDate: null,
              recordedDate: '2024-01-01',
            },
          },
          fetchedAt: fixedFetchedAt,
        },
      ],
    });
    const result = await fetchPatientConditions(
      { orgId: 'org_1', patientId: 'pat_1', now: new Date('2025-12-02T10:00:00Z') },
      client as never,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.conditions[0]?.lastUpdated).toBe(fixedFetchedAt.toISOString());
    }
  });
});

describe('toFhirCitations', () => {
  it('projects to the audit-citation shape', () => {
    const citations = toFhirCitations([
      {
        fhirId: 'cond_1',
        icd: 'M54.81',
        icdLabel: 'Cervicogenic headache',
        clinicalStatus: 'active',
        recordedDate: '2024-08-15',
        recorderName: 'Dr. Patel',
        lastUpdated: '2024-08-16T10:00:00Z',
      },
    ]);
    expect(citations).toEqual([
      {
        resourceType: 'Condition',
        fhirId: 'cond_1',
        lastUpdated: '2024-08-16T10:00:00Z',
        recorder: 'Dr. Patel',
        recordedDate: '2024-08-15',
      },
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(toFhirCitations([])).toEqual([]);
  });
});
