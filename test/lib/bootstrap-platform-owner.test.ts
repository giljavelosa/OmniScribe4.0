import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

import {
  bootstrapPlatformOwner,
  readBootstrapEmail,
} from '@/lib/auth/bootstrap-platform-owner';

/**
 * bootstrapPlatformOwner integration tests.
 *
 * Hits the live Postgres via Prisma. Each test sets up its own User rows in
 * isolation and cleans them up in afterAll. We don't use the seeded
 * owner@demo.local because the seed already creates them as PLATFORM_OWNER
 * — the bootstrap helper would correctly no-op on every run.
 */

const hasDb = !!process.env.DATABASE_URL;
const describeMaybe = hasDb ? describe : describe.skip;
const prisma = hasDb ? new PrismaClient() : (null as unknown as PrismaClient);

const ORG_ID = 'test-org-bootstrap';
const USER_A_ID = 'test-user-bootstrap-a';
const USER_B_ID = 'test-user-bootstrap-b';
const EMAIL_A = 'bootstrap-a@test.local';
const EMAIL_B = 'bootstrap-b@test.local';

/**
 * The seed creates owner@demo.local as PLATFORM_OWNER. The bootstrap helper
 * is idempotent on the existence of ANY platform owner, so we temporarily
 * demote pre-existing owners to NONE for the duration of these tests and
 * restore them in afterAll. Cleaner than seed-coupling.
 */
let preExistingOwnerIds: string[] = [];

beforeAll(async () => {
  if (!hasDb) return;
  await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: {},
    create: {
      id: ORG_ID,
      name: 'Bootstrap Test Org',
      division: 'MULTI',
      billingEmail: 'bootstrap@test.local',
    },
  });
  const existing = await prisma.user.findMany({
    where: { platformRole: 'PLATFORM_OWNER' },
    select: { id: true },
  });
  preExistingOwnerIds = existing.map((u) => u.id);
});

beforeEach(async () => {
  if (!hasDb) return;
  // Demote any platform owners so the test starts with no existing owner.
  await prisma.user.updateMany({
    where: { platformRole: 'PLATFORM_OWNER' },
    data: { platformRole: 'NONE' },
  });
  await prisma.auditLog.deleteMany({
    where: { userId: { in: [USER_A_ID, USER_B_ID] }, action: 'PLATFORM_OWNER_BOOTSTRAPPED' },
  });
  await prisma.user.deleteMany({ where: { id: { in: [USER_A_ID, USER_B_ID] } } });
  await prisma.user.create({
    data: { id: USER_A_ID, email: EMAIL_A, passwordHash: 'x', platformRole: 'NONE' },
  });
  await prisma.user.create({
    data: { id: USER_B_ID, email: EMAIL_B, passwordHash: 'x', platformRole: 'NONE' },
  });
});

afterAll(async () => {
  if (!hasDb) return;
  await prisma.auditLog.deleteMany({
    where: { userId: { in: [USER_A_ID, USER_B_ID] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [USER_A_ID, USER_B_ID] } } });
  await prisma.organization.delete({ where: { id: ORG_ID } });
  // Restore the pre-existing platform owners we demoted in beforeEach.
  if (preExistingOwnerIds.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: preExistingOwnerIds } },
      data: { platformRole: 'PLATFORM_OWNER' },
    });
  }
  await prisma.$disconnect();
  // Always clean the env var after testing so other test files don't inherit it.
  delete process.env.BOOTSTRAP_PLATFORM_OWNER_EMAIL;
});

describe('readBootstrapEmail', () => {
  it('returns null when env var is unset', () => {
    delete process.env.BOOTSTRAP_PLATFORM_OWNER_EMAIL;
    expect(readBootstrapEmail()).toBe(null);
  });

  it('returns null when env var is empty / whitespace', () => {
    process.env.BOOTSTRAP_PLATFORM_OWNER_EMAIL = '   ';
    expect(readBootstrapEmail()).toBe(null);
  });

  it('lowercases + trims the configured email', () => {
    process.env.BOOTSTRAP_PLATFORM_OWNER_EMAIL = '  GiL@AnThRoPiC.COM  ';
    expect(readBootstrapEmail()).toBe('gil@anthropic.com');
  });
});

describeMaybe('bootstrapPlatformOwner', () => {
  it('returns { status: disabled } when env var is unset', async () => {
    delete process.env.BOOTSTRAP_PLATFORM_OWNER_EMAIL;
    const result = await bootstrapPlatformOwner({ source: 'startup' });
    expect(result.status).toBe('disabled');
  });

  it('returns { status: waiting_for_user } when env is set but no User matches', async () => {
    process.env.BOOTSTRAP_PLATFORM_OWNER_EMAIL = 'nobody@nowhere.local';
    const result = await bootstrapPlatformOwner({ source: 'startup' });
    expect(result.status).toBe('waiting_for_user');
  });

  it('elevates the configured user when no platform owner exists yet', async () => {
    process.env.BOOTSTRAP_PLATFORM_OWNER_EMAIL = EMAIL_A;
    const result = await bootstrapPlatformOwner({ source: 'startup' });
    expect(result.status).toBe('elevated');
    if (result.status !== 'elevated') return;
    expect(result.email).toBe(EMAIL_A);
    expect(result.source).toBe('startup');
    const after = await prisma.user.findUnique({ where: { id: USER_A_ID } });
    expect(after?.platformRole).toBe('PLATFORM_OWNER');
  });

  it('writes a PLATFORM_OWNER_BOOTSTRAPPED audit row on success', async () => {
    process.env.BOOTSTRAP_PLATFORM_OWNER_EMAIL = EMAIL_A;
    await bootstrapPlatformOwner({ source: 'signup' });
    const audit = await prisma.auditLog.findFirst({
      where: { userId: USER_A_ID, action: 'PLATFORM_OWNER_BOOTSTRAPPED' },
    });
    expect(audit).not.toBeNull();
    expect((audit?.metadata as { source?: string })?.source).toBe('signup');
  });

  it('is idempotent: returns already_bootstrapped on second call', async () => {
    process.env.BOOTSTRAP_PLATFORM_OWNER_EMAIL = EMAIL_A;
    await bootstrapPlatformOwner({ source: 'startup' });
    const second = await bootstrapPlatformOwner({ source: 'startup' });
    expect(second.status).toBe('already_bootstrapped');
    if (second.status !== 'already_bootstrapped') return;
    expect(second.existingOwnerUserId).toBe(USER_A_ID);
  });

  it('does not promote a different user when one platform owner already exists', async () => {
    // User A becomes the owner first.
    process.env.BOOTSTRAP_PLATFORM_OWNER_EMAIL = EMAIL_A;
    await bootstrapPlatformOwner({ source: 'startup' });
    // Operator rotates the env to user B.
    process.env.BOOTSTRAP_PLATFORM_OWNER_EMAIL = EMAIL_B;
    const result = await bootstrapPlatformOwner({ source: 'startup' });
    expect(result.status).toBe('already_bootstrapped');
    const b = await prisma.user.findUnique({ where: { id: USER_B_ID } });
    expect(b?.platformRole).toBe('NONE');
  });
});
