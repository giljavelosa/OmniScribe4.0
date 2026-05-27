import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * POST /api/notes/[id]/sign — edited-since-analysis attestation gate.
 *
 * Spec: context/specs/sprint-0-flag-analysis-lockdown.md (decision L-8).
 *
 * The pipeline-injected flag analyzer (run #1) stamps a per-section
 * content-hash snapshot at the end of each run. The sign route compares
 * those hashes to the current `draftJson` content; when they differ AND
 * the clinician did NOT tick the attestation, sign refuses 409
 * `edited_since_analysis_unattested` with the list of edited section
 * ids. When the clinician DOES tick the attestation, sign proceeds and
 * the audit chain gets a `NOTE_SIGNED_WITH_EDITED_SINCE_ANALYSIS_ATTESTATION`
 * row alongside the existing `NOTE_SIGNED`.
 *
 * This test pins the route-side behavior; the worker-side hash stamping
 * is covered by analyze-flags-handler.test.ts and flag-analysis-state.test.ts.
 */

import { createHash } from 'node:crypto';

const noteFindFirst = vi.fn();
const noteUpdate = vi.fn();
const userFindUnique = vi.fn();
const followUpFindMany = vi.fn();
const encounterFindUnique = vi.fn();
const reviewFlagCount = vi.fn();
const txMock = vi.fn();
const writeAuditLog = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    note: {
      findFirst: (...a: unknown[]) => noteFindFirst(...a),
      update: (...a: unknown[]) => noteUpdate(...a),
    },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    followUp: { findMany: (...a: unknown[]) => followUpFindMany(...a) },
    encounter: { findUnique: (...a: unknown[]) => encounterFindUnique(...a) },
    episodeOfCare: { update: vi.fn() },
    copilotPatientState: { findMany: vi.fn().mockResolvedValue([]) },
    reviewFlag: { count: (...a: unknown[]) => reviewFlagCount(...a) },
    $transaction: (cb: (tx: unknown) => unknown) =>
      txMock(cb) ?? cb({ note: { update: (...a: unknown[]) => noteUpdate(...a) } }),
  },
}));

const requireFeatureAccess = vi.fn();
vi.mock('@/lib/authz/server', () => ({
  requireFeatureAccess: (...a: unknown[]) => requireFeatureAccess(...a),
}));

vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));

vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn(async () => true) },
}));

vi.mock('@/lib/queue', () => ({
  enqueueNoteBriefJob: vi.fn(async () => {}),
  enqueuePostSignArtifactJob: vi.fn(async () => {}),
  enqueueCleoStateRefresh: vi.fn(async () => {}),
}));

vi.mock('@/lib/notes/section-status', () => ({
  readSectionStatus: () => ({ s1: { status: 'edited' } }),
}));

vi.mock('@/lib/notes/derive-progress-strip', () => ({
  deriveProgressStrip: () => [{ sectionId: 's1', state: 'ready', required: true }],
  isReadyForSign: () => true,
}));

import { POST } from '@/app/api/notes/[id]/sign/route';

const ORIGINAL_CONTENT = 'Patient reports cough x 3 days.';
const EDITED_CONTENT = 'Patient reports cough x 5 days, with sputum.';

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function authedGuard() {
  return {
    user: { id: 'user_1' },
    orgUser: { orgId: 'org_1' },
    authorizationUser: {
      userId: 'user_1',
      orgUserId: 'ou_caller',
      orgId: 'org_1',
      role: 'CLINICIAN',
      division: 'MEDICAL',
      canManagePatients: false,
    },
  };
}

function noteFixture(overrides: Partial<Record<string, unknown>> = {}) {
  // Defaults: a fully-analyzed note with one section. The hash snapshot
  // matches the current draft so no edits are detected. Individual
  // tests override `draftJson` (to simulate edits) or override
  // `flagAnalysisSectionHashes` (to simulate a never-analyzed note).
  return {
    id: 'note_1',
    orgId: 'org_1',
    patientId: 'pat_1',
    encounterId: 'enc_1',
    clinicianOrgUserId: 'ou_caller',
    status: 'DRAFT',
    draftJson: {
      s1: { content: ORIGINAL_CONTENT, updatedAt: '2026-05-25T00:00:00Z' },
    },
    template: {
      sectionSchema: {
        sections: [{ id: 's1', label: 'Section 1', required: true }],
      },
    },
    isLateEntry: false,
    lateEntryDaysGap: null,
    dateOfService: new Date('2026-05-25T00:00:00Z'),
    encounter: { caseManagement: { status: 'ACTIVE' } },
    flagAnalysisStartedAt: new Date('2026-05-25T00:00:00Z'),
    flagAnalysisCompletedAt: new Date('2026-05-25T00:00:01Z'),
    flagAnalysisRunCount: 1,
    flagAnalysisSectionHashes: { s1: hash(ORIGINAL_CONTENT) },
    ...overrides,
  };
}

function buildRequest(body: Record<string, unknown> = { signPin: '1234' }) {
  return new Request('http://test.local/api/notes/note_1/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  noteFindFirst.mockReset();
  noteUpdate.mockReset();
  userFindUnique.mockReset();
  followUpFindMany.mockReset();
  encounterFindUnique.mockReset();
  reviewFlagCount.mockReset();
  txMock.mockReset();
  requireFeatureAccess.mockReset();
  writeAuditLog.mockReset();

  requireFeatureAccess.mockResolvedValue(authedGuard());
  followUpFindMany.mockResolvedValue([]);
  userFindUnique.mockResolvedValue({
    signingPinHash: '$2a$12$hash',
    signUnlockedUntil: new Date(Date.now() + 5 * 60 * 1000),
  });
  txMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({ note: { update: noteUpdate } }),
  );
  noteUpdate.mockResolvedValue({});
  encounterFindUnique.mockResolvedValue({ episodeOfCareId: null });
  reviewFlagCount.mockResolvedValue(0);
  writeAuditLog.mockResolvedValue(undefined);
});

describe('POST /api/notes/[id]/sign — edited-since-analysis attestation', () => {
  it('signs cleanly when hashes match (no edits)', async () => {
    noteFindFirst.mockResolvedValueOnce(noteFixture());

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'note_1' }) });
    expect(res.status).toBe(200);

    // No attestation audit row when no edits.
    const attestationCalls = writeAuditLog.mock.calls.filter(
      (c) =>
        (c[0] as { action: string }).action ===
        'NOTE_SIGNED_WITH_EDITED_SINCE_ANALYSIS_ATTESTATION',
    );
    expect(attestationCalls).toHaveLength(0);
  });

  it('refuses 409 edited_since_analysis_unattested when content changed and no attestation', async () => {
    noteFindFirst.mockResolvedValueOnce(
      noteFixture({
        draftJson: {
          s1: { content: EDITED_CONTENT, updatedAt: '2026-05-25T00:01:00Z' },
        },
      }),
    );

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'note_1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('edited_since_analysis_unattested');
    expect(body.data.editedSectionIds).toEqual(['s1']);
    expect(body.data.lastAnalysisCompletedAt).toBe('2026-05-25T00:00:01.000Z');

    // No sign happened.
    expect(noteUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SIGNED' }) }),
    );
  });

  it('signs successfully and writes the attestation audit row when content changed and attestation present', async () => {
    noteFindFirst.mockResolvedValueOnce(
      noteFixture({
        draftJson: {
          s1: { content: EDITED_CONTENT, updatedAt: '2026-05-25T00:01:00Z' },
        },
      }),
    );

    const res = await POST(
      buildRequest({ signPin: '1234', editedSinceAnalysisAttested: true }),
      { params: Promise.resolve({ id: 'note_1' }) },
    );
    expect(res.status).toBe(200);

    const attestationCall = writeAuditLog.mock.calls.find(
      (c) =>
        (c[0] as { action: string }).action ===
        'NOTE_SIGNED_WITH_EDITED_SINCE_ANALYSIS_ATTESTATION',
    );
    expect(attestationCall).toBeDefined();
    const metadata = (attestationCall![0] as { metadata: Record<string, unknown> }).metadata;
    expect(metadata.editedSectionIds).toEqual(['s1']);
    expect(metadata.flagAnalysisRunCount).toBe(1);
    expect(metadata.lastAnalysisCompletedAt).toBe('2026-05-25T00:00:01.000Z');
  });

  it('silently ignores an attestation tick when no edits actually occurred', async () => {
    noteFindFirst.mockResolvedValueOnce(noteFixture());

    const res = await POST(
      buildRequest({ signPin: '1234', editedSinceAnalysisAttested: true }),
      { params: Promise.resolve({ id: 'note_1' }) },
    );
    expect(res.status).toBe(200);

    // No false-positive attestation row when the gate wasn't actually
    // engaged (hashes match).
    const attestationCalls = writeAuditLog.mock.calls.filter(
      (c) =>
        (c[0] as { action: string }).action ===
        'NOTE_SIGNED_WITH_EDITED_SINCE_ANALYSIS_ATTESTATION',
    );
    expect(attestationCalls).toHaveLength(0);
  });

  it('is a no-op for pre-deploy notes that never carried a hash snapshot', async () => {
    // Backward-compat: notes with flagAnalysisSectionHashes = null (the
    // pipeline analyzer was never run on them) should sign normally
    // without the attestation gate firing.
    noteFindFirst.mockResolvedValueOnce(
      noteFixture({
        flagAnalysisSectionHashes: null,
        flagAnalysisRunCount: 0,
        draftJson: {
          s1: { content: EDITED_CONTENT, updatedAt: '2026-05-25T00:01:00Z' },
        },
      }),
    );

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'note_1' }) });
    expect(res.status).toBe(200);
  });
});
