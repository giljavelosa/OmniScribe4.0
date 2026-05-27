import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// POST /api/admin/users — admin-creates-user-with-password.
// authz, prisma, bcrypt, and audit are mocked; the handler's body validation,
// password policy enforcement, email-uniqueness check, transaction wiring,
// and audit-row shape are what's under test.
// ---------------------------------------------------------------------------

const requireAdminOrgRole = vi.fn();
const userFindUnique = vi.fn();
const userCreate = vi.fn();
const orgUserCreate = vi.fn();
const transaction = vi.fn();
const writeAuditLog = vi.fn();
const bcryptHash = vi.fn();

vi.mock('@/lib/authz/server', () => ({
  requireAdminOrgRole: (...a: unknown[]) => requireAdminOrgRole(...a),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...a),
      create: (...a: unknown[]) => userCreate(...a),
    },
    orgUser: { create: (...a: unknown[]) => orgUserCreate(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));
vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));
vi.mock('bcryptjs', () => ({
  default: { hash: (...a: unknown[]) => bcryptHash(...a) },
}));

import { POST } from '@/app/api/admin/users/route';

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function bodyOf(res: Response): Promise<{
  error?: { code?: string; message?: string };
  data?: { userId?: string; email?: string };
}> {
  return (await res.json()) as never;
}

/** A password that passes the 12-char + 3-of-4-class policy. */
const STRONG_PW = 'Pilot2026!Run';

beforeEach(() => {
  requireAdminOrgRole.mockReset().mockResolvedValue({
    user: { id: 'user_admin', email: 'admin@org.test' },
    orgUser: { id: 'ou_admin', orgId: 'org_1', role: 'ORG_ADMIN' },
  });
  userFindUnique.mockReset().mockResolvedValue(null);
  userCreate.mockReset().mockResolvedValue({ id: 'user_new', email: 'jane@org.test' });
  orgUserCreate.mockReset().mockResolvedValue({ id: 'ou_new' });
  transaction.mockReset().mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      user: { create: (...a: unknown[]) => userCreate(...a) },
      orgUser: { create: (...a: unknown[]) => orgUserCreate(...a) },
    }),
  );
  writeAuditLog.mockReset().mockResolvedValue(undefined);
  bcryptHash.mockReset().mockResolvedValue('hashed_pw');
});

describe('POST /api/admin/users — happy path', () => {
  it('creates a CLINICIAN with a pre-set password and writes USER_CREATED audit', async () => {
    const res = await POST(
      postReq({
        email: 'Jane@Org.Test',
        password: STRONG_PW,
        role: 'CLINICIAN',
        division: 'MEDICAL',
        name: 'Dr. Jane Doe',
        profession: 'Family Medicine MD',
        canManagePatients: true,
      }),
    );
    expect(res.status).toBe(201);
    const body = await bodyOf(res);
    expect(body.data?.email).toBe('jane@org.test');
    expect(body.data?.userId).toBe('user_new');

    expect(userFindUnique).toHaveBeenCalledWith({
      where: { email: 'jane@org.test' },
      select: { id: true },
    });
    expect(bcryptHash).toHaveBeenCalledWith(STRONG_PW, 12);
    expect(userCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'jane@org.test',
        name: 'Dr. Jane Doe',
        passwordHash: 'hashed_pw',
      }),
    });
    expect(orgUserCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user_new',
        orgId: 'org_1',
        role: 'CLINICIAN',
        division: 'MEDICAL',
        profession: 'Family Medicine MD',
        canManagePatients: true,
        isActive: true,
      }),
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_new',
        actingUserId: 'user_admin',
        orgId: 'org_1',
        action: 'USER_CREATED',
        resourceType: 'User',
        resourceId: 'user_new',
        metadata: expect.objectContaining({ via: 'admin_direct', role: 'CLINICIAN' }),
      }),
    );
  });

  it('lowercases the email before checking uniqueness and writing the row', async () => {
    await POST(postReq({ email: 'MIXED@Case.test', password: STRONG_PW, role: 'CLINICIAN', division: 'MEDICAL' }));
    expect(userFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'mixed@case.test' } }));
    expect(userCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: 'mixed@case.test' }) }));
  });
});

describe('POST /api/admin/users — validation', () => {
  it('rejects a weak password without touching the DB', async () => {
    const res = await POST(postReq({ email: 'a@b.test', password: 'short', role: 'CLINICIAN', division: 'MEDICAL' }));
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error?.code).toBe('weak_password');
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(userCreate).not.toHaveBeenCalled();
    expect(bcryptHash).not.toHaveBeenCalled();
  });

  it('refuses ORG_ADMIN role elevation via this route', async () => {
    const res = await POST(postReq({ email: 'a@b.test', password: STRONG_PW, role: 'ORG_ADMIN', division: 'MEDICAL' }));
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error?.code).toBe('bad_request');
    expect(userCreate).not.toHaveBeenCalled();
  });

  it('returns 409 email_in_use when the email already exists on any User', async () => {
    userFindUnique.mockResolvedValue({ id: 'user_existing' });
    const res = await POST(postReq({ email: 'taken@org.test', password: STRONG_PW, role: 'CLINICIAN', division: 'MEDICAL' }));
    expect(res.status).toBe(409);
    expect((await bodyOf(res)).error?.code).toBe('email_in_use');
    expect(userCreate).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('returns 400 bad_request on a malformed body', async () => {
    const res = await POST(postReq({ email: 'not-an-email', password: STRONG_PW, role: 'CLINICIAN', division: 'MEDICAL' }));
    expect(res.status).toBe(400);
    expect((await bodyOf(res)).error?.code).toBe('bad_request');
    expect(userCreate).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/users — authz', () => {
  it('bubbles the authz guard error and writes nothing', async () => {
    const { NextResponse } = await import('next/server');
    requireAdminOrgRole.mockResolvedValue({
      error: NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 }),
    });

    const res = await POST(postReq({ email: 'a@b.test', password: STRONG_PW, role: 'CLINICIAN', division: 'MEDICAL' }));
    expect(res.status).toBe(403);
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(userCreate).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});
