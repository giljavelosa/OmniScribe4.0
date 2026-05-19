import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * DELETE /api/notes/[id] — discard-draft coverage.
 *
 * Soft-delete only: an unsigned note's row is flagged isDeleted, the S3
 * audio is never touched (rule 7), and a SIGNED/TRANSFERRED note can never
 * be deleted (rule 3 — signed notes are immutable records).
 *
 * Anti-regression: this test gates (a) the SIGNED/TRANSFERRED 409 refusal,
 * (b) the soft-delete write shape, and (c) the NOTE_DELETED audit row.
 */

const noteFindFirst = vi.fn();
const noteUpdate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    note: {
      findFirst: (...a: unknown[]) => noteFindFirst(...a),
      update: (...a: unknown[]) => noteUpdate(...a),
    },
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

vi.mock('@/lib/phi-access', () => ({
  // assertOrgScoped is a no-op when the two org ids match; the route always
  // passes matching ids in these tests.
  assertOrgScoped: () => {},
}));

import { DELETE } from '@/app/api/notes/[id]/route';

function authedGuard(role = 'CLINICIAN') {
  return {
    user: { id: 'user_1' },
    orgUser: { orgId: 'org_1' },
    authorizationUser: {
      userId: 'user_1',
      orgUserId: 'ou_caller',
      orgId: 'org_1',
      role,
      division: 'MEDICAL',
      canManagePatients: false,
    },
  };
}

function noteFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'note_1',
    orgId: 'org_1',
    status: 'DRAFT',
    captureMode: 'LIVE',
    audioFileKey: 's3/note_1/seg-0.wav',
    clinicianOrgUserId: 'ou_caller',
    ...overrides,
  };
}

function req() {
  return new Request('http://test.local/api/notes/note_1', { method: 'DELETE' });
}

const params = { params: Promise.resolve({ id: 'note_1' }) };

beforeEach(() => {
  noteFindFirst.mockReset();
  noteUpdate.mockReset();
  requireFeatureAccess.mockReset();
  writeAuditLog.mockReset();
  requireFeatureAccess.mockResolvedValue(authedGuard());
  noteUpdate.mockResolvedValue({});
});

describe('DELETE /api/notes/[id]', () => {
  it('soft-deletes an unsigned draft and audits NOTE_DELETED', async () => {
    noteFindFirst.mockResolvedValueOnce(noteFixture({ status: 'DRAFT' }));

    const res = await DELETE(req(), params);
    expect(res.status).toBe(200);

    // Soft-delete write: isDeleted true + deletedAt set.
    expect(noteUpdate).toHaveBeenCalledOnce();
    const data = (noteUpdate.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.isDeleted).toBe(true);
    expect(data.deletedAt).toBeInstanceOf(Date);

    const audit = writeAuditLog.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'NOTE_DELETED',
    );
    expect(audit).toBeDefined();
    const meta = (audit![0] as { metadata: Record<string, unknown> }).metadata;
    expect(meta.softDelete).toBe(true);
    expect(meta.statusAtDelete).toBe('DRAFT');
    expect(meta.hadAudio).toBe(true);
  });

  it('refuses a SIGNED note with 409 and does not write', async () => {
    noteFindFirst.mockResolvedValueOnce(noteFixture({ status: 'SIGNED' }));

    const res = await DELETE(req(), params);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('note_signed');
    expect(noteUpdate).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('refuses a TRANSFERRED note with 409', async () => {
    noteFindFirst.mockResolvedValueOnce(noteFixture({ status: 'TRANSFERRED' }));

    const res = await DELETE(req(), params);
    expect(res.status).toBe(409);
    expect(noteUpdate).not.toHaveBeenCalled();
  });

  it('404s when the note does not exist (or is already deleted)', async () => {
    noteFindFirst.mockResolvedValueOnce(null);

    const res = await DELETE(req(), params);
    expect(res.status).toBe(404);
    expect(noteUpdate).not.toHaveBeenCalled();
  });

  it('403s when a different clinician (non-admin) tries to delete', async () => {
    noteFindFirst.mockResolvedValueOnce(noteFixture({ clinicianOrgUserId: 'ou_someone_else' }));

    const res = await DELETE(req(), params);
    expect(res.status).toBe(403);
    expect(noteUpdate).not.toHaveBeenCalled();
  });

  it('allows an ORG_ADMIN to delete a draft they do not own', async () => {
    requireFeatureAccess.mockResolvedValue(authedGuard('ORG_ADMIN'));
    noteFindFirst.mockResolvedValueOnce(noteFixture({ clinicianOrgUserId: 'ou_someone_else' }));

    const res = await DELETE(req(), params);
    expect(res.status).toBe(200);
    expect(noteUpdate).toHaveBeenCalledOnce();
  });
});
