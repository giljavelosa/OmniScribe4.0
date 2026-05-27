import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * POST /api/notes/[id]/sign — late-entry metadata coverage.
 *
 * The spec extends the existing NOTE_SIGNED audit metadata with
 * { isLateEntry, lateEntryDaysGap, dateOfService } so a reviewer can prove
 * the attestation-copy switch fired without joining tables. This test
 * mocks the surrounding machinery (auth, prisma, MFA, queue) and exercises
 * the happy path twice — once for a normal visit, once for a late entry —
 * verifying the NOTE_SIGNED audit row carries the correct shape both ways.
 *
 * Anti-regression: this test is the gate on the metadata SHAPE. If the
 * sign route ever drops or renames isLateEntry / lateEntryDaysGap /
 * dateOfService in its audit row, this test fails.
 */

const noteFindFirst = vi.fn();
const noteUpdate = vi.fn();
const userFindUnique = vi.fn();
const followUpFindMany = vi.fn();
const encounterFindUnique = vi.fn();
const episodeOfCareUpdate = vi.fn();
const txMock = vi.fn();

const reviewFlagCount = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    note: {
      findFirst: (...a: unknown[]) => noteFindFirst(...a),
      update: (...a: unknown[]) => noteUpdate(...a),
    },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    followUp: { findMany: (...a: unknown[]) => followUpFindMany(...a) },
    encounter: { findUnique: (...a: unknown[]) => encounterFindUnique(...a) },
    episodeOfCare: { update: (...a: unknown[]) => episodeOfCareUpdate(...a) },
    reviewFlag: { count: (...a: unknown[]) => reviewFlagCount(...a) },
    copilotPatientState: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: (cb: (tx: unknown) => unknown) =>
      txMock(cb) ??
      cb({
        note: { update: (...a: unknown[]) => noteUpdate(...a) },
      }),
  },
}));

const requireFeatureAccess = vi.fn();
vi.mock('@/lib/authz/server', () => ({
  requireFeatureAccess: (...a: unknown[]) => requireFeatureAccess(...a),
}));

const writeAuditLog = vi.fn();
vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));

vi.mock('@/lib/queue', () => ({
  enqueueNoteBriefJob: vi.fn(async () => {}),
  enqueuePostSignArtifactJob: vi.fn(async () => {}),
}));

vi.mock('@/lib/notes/section-status', () => ({
  readSectionStatus: () => ({ s1: { status: 'edited' } }),
}));

vi.mock('@/lib/notes/derive-progress-strip', () => ({
  deriveProgressStrip: () => [
    { sectionId: 's1', state: 'ready', required: true },
  ],
  isReadyForSign: () => true,
}));

import { POST } from '@/app/api/notes/[id]/sign/route';

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

beforeEach(() => {
  noteFindFirst.mockReset();
  noteUpdate.mockReset();
  userFindUnique.mockReset();
  followUpFindMany.mockReset();
  encounterFindUnique.mockReset();
  episodeOfCareUpdate.mockReset();
  txMock.mockReset();
  requireFeatureAccess.mockReset();
  writeAuditLog.mockReset();

  // Defaults that exercise the happy path.
  requireFeatureAccess.mockResolvedValue(authedGuard());
  followUpFindMany.mockResolvedValue([]); // No open follow-ups → no sweep
  // Sprint 0.20 — MFA removed; sign-time auth is signing-PIN only.
  // Setting signUnlockedUntil in the future short-circuits the PIN
  // prompt so the test focuses on the late-entry audit metadata.
  userFindUnique.mockResolvedValue({
    signingPinHash: '$2b$10$bogusbcrypthashfortest',
    signUnlockedUntil: new Date(Date.now() + 5 * 60 * 1000),
  });
  // Transaction commits its callback against a stub tx. Sprint pre-sign-
  // followup-suggest added a `tx.followUp.updateMany` call inside the sign
  // tx to auto-DROP unreviewed PROPOSED rows on sign — mock it as a no-op
  // ({ count: 0 }) so this older test doesn't crash on the missing method.
  txMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      note: { update: noteUpdate },
      followUp: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    }),
  );
  noteUpdate.mockResolvedValue({});
  encounterFindUnique.mockResolvedValue({ episodeOfCareId: null });
});

function noteFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'note_1',
    orgId: 'org_1',
    patientId: 'pat_1',
    encounterId: 'enc_1',
    clinicianOrgUserId: 'ou_caller',
    status: 'DRAFT',
    draftJson: { s1: { content: 'A', updatedAt: '2026-05-18T00:00:00Z' } },
    template: { sectionSchema: { sections: [{ id: 's1', label: 'Section 1', required: true }] } },
    isLateEntry: false,
    lateEntryDaysGap: null,
    dateOfService: new Date('2026-05-18T00:00:00Z'),
    ...overrides,
  };
}

function buildRequest(body: unknown) {
  return new Request('http://test.local/api/notes/note_1/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/notes/[id]/sign — late-entry audit metadata', () => {
  it('NOTE_SIGNED metadata carries isLateEntry=false on a normal visit', async () => {
    noteFindFirst.mockResolvedValueOnce(noteFixture());

    const res = await POST(buildRequest({}), {
      params: Promise.resolve({ id: 'note_1' }),
    });
    expect(res.status).toBe(200);

    const noteSignedCall = writeAuditLog.mock.calls.find(
      (call) => (call[0] as { action: string }).action === 'NOTE_SIGNED',
    );
    expect(noteSignedCall).toBeDefined();
    const meta = (noteSignedCall![0] as { metadata: Record<string, unknown> }).metadata;
    expect(meta.isLateEntry).toBe(false);
    expect(meta.lateEntryDaysGap).toBeNull();
    expect(meta.dateOfService).toBe('2026-05-18T00:00:00.000Z');
  });

  it('NOTE_SIGNED metadata carries isLateEntry=true + day gap on a late entry', async () => {
    noteFindFirst.mockResolvedValueOnce(
      noteFixture({
        isLateEntry: true,
        lateEntryDaysGap: 14,
        dateOfService: new Date('2026-05-04T00:00:00Z'),
      }),
    );

    const res = await POST(buildRequest({}), {
      params: Promise.resolve({ id: 'note_1' }),
    });
    expect(res.status).toBe(200);

    const noteSignedCall = writeAuditLog.mock.calls.find(
      (call) => (call[0] as { action: string }).action === 'NOTE_SIGNED',
    );
    expect(noteSignedCall).toBeDefined();
    const meta = (noteSignedCall![0] as { metadata: Record<string, unknown> }).metadata;
    expect(meta.isLateEntry).toBe(true);
    expect(meta.lateEntryDaysGap).toBe(14);
    expect(meta.dateOfService).toBe('2026-05-04T00:00:00.000Z');
  });
});
