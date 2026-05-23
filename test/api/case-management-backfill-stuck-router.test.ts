import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/admin/case-management/backfill-stuck-router — verifies the
 * one-shot operational backfill that resolves PENDING_ROUTER cases stuck
 * with signed notes. The endpoint itself is described in
 * src/app/api/admin/case-management/backfill-stuck-router/route.ts.
 *
 * Coverage:
 *  - happy path with zero stuck rows → scanned 0, backfilled 0
 *  - happy path with one stuck row → promoted to ACTIVE + per-case audit
 *    + sweep summary audit
 *  - dryRun=true → no case updated, no per-case audit, summary still fires
 *    with `dryRun: true`
 *  - one row failing → other rows still backfill; error counter increments
 */

const mockAuth = vi.fn();
vi.mock('@/lib/auth', () => ({
  auth: () => mockAuth(),
}));

const caseFindMany = vi.fn();
const caseUpdate = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    caseManagement: {
      findMany: (...a: unknown[]) => caseFindMany(...a),
      update: (...a: unknown[]) => caseUpdate(...a),
    },
  },
}));

const writeAudit = vi.fn();
vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAudit(...a),
}));

const requireFeatureAccessMock = vi.fn();
vi.mock('@/lib/authz/server', () => ({
  requireFeatureAccess: (...a: unknown[]) => requireFeatureAccessMock(...a),
}));

import { POST } from '@/app/api/admin/case-management/backfill-stuck-router/route';

function ok(orgId = 'org_1') {
  return {
    user: { id: 'u_admin' },
    authorizationUser: { orgId },
  };
}

function req(query = '') {
  return new Request(
    `http://localhost/api/admin/case-management/backfill-stuck-router${query}`,
    { method: 'POST' },
  );
}

describe('POST /api/admin/case-management/backfill-stuck-router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireFeatureAccessMock.mockResolvedValue(ok());
    caseUpdate.mockResolvedValue({});
    writeAudit.mockResolvedValue(undefined);
  });

  it('reports zero work when no stuck cases exist', async () => {
    caseFindMany.mockResolvedValue([]);
    const res = await POST(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.scanned).toBe(0);
    expect(body.data.backfilled).toBe(0);
    expect(body.data.errors).toBe(0);
    expect(body.data.dryRun).toBe(false);
    // Per-case update never fires; only the summary audit row.
    expect(caseUpdate).not.toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledTimes(1);
    expect(writeAudit.mock.calls[0]![0].action).toBe('CASE_BACKFILL_SWEEP_RUN');
  });

  it('promotes a stuck case to ACTIVE with Uncategorized care label + audits', async () => {
    caseFindMany.mockResolvedValue([
      {
        id: 'case-stuck-1',
        encounters: [{ notes: [{ id: 'note-A' }, { id: 'note-B' }] }],
      },
    ]);

    const res = await POST(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.scanned).toBe(1);
    expect(body.data.backfilled).toBe(1);
    expect(body.data.candidates).toEqual([
      { id: 'case-stuck-1', signedNoteCount: 2 },
    ]);

    // The case is updated with the documented placeholder shape.
    expect(caseUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = caseUpdate.mock.calls[0]![0];
    expect(updateArgs.where).toEqual({ id: 'case-stuck-1' });
    expect(updateArgs.data.status).toBe('ACTIVE');
    expect(updateArgs.data.primaryIcd).toBeNull();
    expect(updateArgs.data.primaryIcdLabel).toBe('Uncategorized care');
    expect(updateArgs.data.description).toMatch(/^Backfilled from PENDING_ROUTER on \d{4}-\d{2}-\d{2}/);

    // Two audit rows — one per-case + one sweep summary.
    expect(writeAudit).toHaveBeenCalledTimes(2);
    const perCase = writeAudit.mock.calls[0]![0];
    expect(perCase.action).toBe('CASE_BACKFILLED_FROM_PENDING_ROUTER');
    expect(perCase.resourceType).toBe('CaseManagement');
    expect(perCase.resourceId).toBe('case-stuck-1');
    expect(perCase.metadata.signedNoteCount).toBe(2);
    expect(perCase.metadata.prevStatus).toBe('PENDING_ROUTER');
    expect(perCase.metadata.newStatus).toBe('ACTIVE');

    const sweep = writeAudit.mock.calls[1]![0];
    expect(sweep.action).toBe('CASE_BACKFILL_SWEEP_RUN');
    expect(sweep.metadata.scanned).toBe(1);
    expect(sweep.metadata.backfilled).toBe(1);
    expect(sweep.metadata.dryRun).toBe(false);
  });

  it('dryRun=true reports candidates without mutating or per-case auditing', async () => {
    caseFindMany.mockResolvedValue([
      {
        id: 'case-stuck-1',
        encounters: [{ notes: [{ id: 'note-A' }] }],
      },
    ]);

    const res = await POST(req('?dryRun=true'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.dryRun).toBe(true);
    expect(body.data.scanned).toBe(1);
    expect(body.data.backfilled).toBe(0);
    expect(body.data.candidates).toEqual([
      { id: 'case-stuck-1', signedNoteCount: 1 },
    ]);

    // No state change, no per-case audit.
    expect(caseUpdate).not.toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledTimes(1);
    const sweep = writeAudit.mock.calls[0]![0];
    expect(sweep.action).toBe('CASE_BACKFILL_SWEEP_RUN');
    expect(sweep.metadata.dryRun).toBe(true);
  });

  it('continues past per-row failures and increments the error counter', async () => {
    caseFindMany.mockResolvedValue([
      { id: 'case-stuck-1', encounters: [{ notes: [{ id: 'n-1' }] }] },
      { id: 'case-stuck-2', encounters: [{ notes: [{ id: 'n-2' }] }] },
    ]);
    // First update fails, second succeeds.
    caseUpdate
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({});

    const res = await POST(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.scanned).toBe(2);
    expect(body.data.backfilled).toBe(1);
    expect(body.data.errors).toBe(1);

    // Only the successful row's per-case audit fires + the sweep summary.
    const actions = writeAudit.mock.calls.map((c) => c[0].action);
    expect(actions).toEqual(['CASE_BACKFILLED_FROM_PENDING_ROUTER', 'CASE_BACKFILL_SWEEP_RUN']);
  });

  it('passes through a 4xx response when authorization fails', async () => {
    const denied = new Response(null, { status: 403 });
    requireFeatureAccessMock.mockResolvedValue({ error: denied });

    const res = await POST(req());

    expect(res.status).toBe(403);
    expect(caseFindMany).not.toHaveBeenCalled();
    expect(caseUpdate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });
});
