import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Division, OrgRole, PrismaClient } from '@prisma/client';

import { POST } from '@/app/api/onboarding/[token]/password/route';

/**
 * Verify-when-done #8 (Unit 08 spec): expired invite tokens return 410 Gone.
 *
 * Hits the real local Postgres via Prisma (no mocking — the route's branch
 * is "look up the invite + if expired-or-consumed return 410," which is
 * cheaper to validate end-to-end than to mock module by module).
 *
 * Cleans up its own fixtures regardless of pass/fail (idempotent re-runs).
 *
 * Skipped in CI (no Postgres). Run locally via `npm test` with
 * `DATABASE_URL` set.
 */
const hasDb = !!process.env.DATABASE_URL;
const describeMaybe = hasDb ? describe : describe.skip;
const prisma = hasDb ? new PrismaClient() : (null as unknown as PrismaClient);

const TEST_ORG_ID = 'test-org-unit-08-expired-invite';
const TEST_INVITE_ID = 'test-inv-unit-08-expired';
const TEST_INVITE_TOKEN = 'unit-08-expired-token-' + Math.random().toString(36).slice(2, 10);

beforeAll(async () => {
  if (!hasDb) return;
  await prisma.organization.upsert({
    where: { id: TEST_ORG_ID },
    update: {},
    create: {
      id: TEST_ORG_ID,
      name: 'Unit 08 Test Org',
      division: Division.MEDICAL,
      billingEmail: 'unit08@test.local',
    },
  });
  await prisma.invite.upsert({
    where: { id: TEST_INVITE_ID },
    update: {},
    create: {
      id: TEST_INVITE_ID,
      email: 'unit08-invite@test.local',
      orgId: TEST_ORG_ID,
      role: OrgRole.CLINICIAN,
      division: Division.MEDICAL,
      token: TEST_INVITE_TOKEN,
      expiresAt: new Date(Date.now() - 60_000), // already expired 1m ago
      invitedByUserId: 'test-user-not-real',
    },
  });
});

afterAll(async () => {
  if (!hasDb) return;
  await prisma.invite.deleteMany({ where: { id: TEST_INVITE_ID } });
  // OrgUser fixtures may exist if a sibling test crossed paths — best-effort.
  await prisma.orgUser.deleteMany({ where: { orgId: TEST_ORG_ID } });
  await prisma.organization.deleteMany({ where: { id: TEST_ORG_ID } });
  await prisma.$disconnect();
});

describeMaybe('POST /api/onboarding/[token]/password', () => {
  it('returns 410 Gone for an expired invite token', async () => {
    const req = new Request('http://test.local/api/onboarding/_/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'AStrongDemo1234!' }),
    });

    const res = await POST(req, {
      params: Promise.resolve({ token: TEST_INVITE_TOKEN }),
    });

    expect(res.status).toBe(410);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('gone');
  });

  it('returns 410 Gone for an unknown token (no enumeration distinction)', async () => {
    const req = new Request('http://test.local/api/onboarding/_/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'AStrongDemo1234!' }),
    });

    const res = await POST(req, {
      params: Promise.resolve({ token: 'token-that-does-not-exist' }),
    });

    expect(res.status).toBe(410);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('gone');
  });
});
