/**
 * Seed for local dev. Creates a single Demo Clinic org with 5 users covering
 * every role (SUPER_ADMIN, CLINICIAN, VIEWER, SITE_ADMIN, PLATFORM_OWNER),
 * one site with two rooms, and 5 seats. All passwords hash to `Demo1234!`.
 *
 * D9 — admin@demo.local seeds with MFA pre-enrolled using the canonical otplib
 * test vector secret `JBSWY3DPEHPK3PXP`. Document at docs/SEED_CREDENTIALS.md.
 *
 * Anti-regression rule 4: ALWAYS run `npx prisma db seed` after schema changes.
 */

import { PrismaClient, Division, OrgRole, PlatformRole, SeatTier, NoteStyle, ComplianceProfile } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { generate as generateTotp } from 'otplib';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Demo1234!';
const BCRYPT_ROUNDS = 12;
// Stable test secret (20 bytes / 32 base32 chars) — predictable for local dev only.
// Never set this secret in any deployed environment. otplib v13 enforces a
// 16-byte minimum; the old 10-byte JBSWY3DPEHPK3PXP test vector is too short.
const DEMO_ADMIN_MFA_SECRET = '7FSWEU6M2MYDQONC5WHDM72MK3FUQZ4Q';

async function hashPassword(plain: string) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/** Returns 10 plain recovery codes and their bcrypt hashes. */
async function generateRecoveryCodes(count = 10) {
  const plain: string[] = [];
  const hashed: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = Math.random().toString(36).slice(2, 7) + '-' + Math.random().toString(36).slice(2, 7);
    plain.push(code);
    hashed.push(await bcrypt.hash(code, BCRYPT_ROUNDS));
  }
  return { plain, hashed };
}

async function main() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const adminRecoveryCodes = await generateRecoveryCodes(10);

  console.log('Seeding Demo Clinic …');

  // ---------------- Organization + Site + Rooms ----------------
  const org = await prisma.organization.upsert({
    where: { id: 'seed-demo-clinic' },
    update: {},
    create: {
      id: 'seed-demo-clinic',
      name: 'Demo Clinic',
      division: Division.MULTI,
      defaultDivision: Division.MEDICAL,
      billingEmail: 'billing@demo.local',
      forceMfa: false,
      // BAA pre-attested so the Owner console shows green for the demo org.
      baaExecutedAt: new Date('2026-05-17T00:00:00Z'),
      baaVersion: '2026.05.01',
      // Note: countersignedBy filled in after we create the owner user below.
      complianceProfile: ComplianceProfile.STANDARD,
    },
  });

  const site = await prisma.site.upsert({
    where: { id: 'seed-demo-site' },
    update: {},
    create: {
      id: 'seed-demo-site',
      orgId: org.id,
      name: 'Demo Main Office',
      address: '1 Demo Way, Springfield, USA',
      phone: '+1-555-0100',
      primaryDivision: Division.MEDICAL,
    },
  });

  await prisma.room.upsert({
    where: { id: 'seed-demo-room-1' },
    update: {},
    create: { id: 'seed-demo-room-1', siteId: site.id, name: 'Exam Room 1' },
  });
  await prisma.room.upsert({
    where: { id: 'seed-demo-room-2' },
    update: {},
    create: { id: 'seed-demo-room-2', siteId: site.id, name: 'Exam Room 2' },
  });

  // ---------------- Users + OrgUsers + Seats ----------------
  // Tuple shape: [email, OrgRole, Division, profession?, canManagePatients?, mfaEnabled?, platformRole?]
  const users: Array<{
    email: string;
    role: OrgRole;
    division: Division;
    profession?: string;
    canManagePatients?: boolean;
    mfaEnabled: boolean;
    platformRole?: PlatformRole;
  }> = [
    { email: 'admin@demo.local', role: OrgRole.SUPER_ADMIN, division: Division.MULTI, mfaEnabled: true },
    {
      email: 'clinician@demo.local',
      role: OrgRole.CLINICIAN,
      division: Division.MEDICAL,
      profession: 'Family Medicine MD',
      canManagePatients: true,
      mfaEnabled: false,
    },
    { email: 'viewer@demo.local', role: OrgRole.VIEWER, division: Division.MEDICAL, mfaEnabled: false },
    {
      email: 'siteadmin@demo.local',
      role: OrgRole.SITE_ADMIN,
      division: Division.MEDICAL,
      mfaEnabled: false,
    },
    {
      email: 'owner@demo.local',
      role: OrgRole.CLINICIAN, // org-membership role; platform-owner-ness lives on User.platformRole
      division: Division.MEDICAL,
      mfaEnabled: false,
      platformRole: PlatformRole.PLATFORM_OWNER,
    },
  ];

  let ownerUserId: string | null = null;

  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        passwordHash,
        mfaSecret: u.mfaEnabled ? DEMO_ADMIN_MFA_SECRET : null,
        mfaEnabled: u.mfaEnabled,
        mfaRecoveryCodes: u.mfaEnabled ? (adminRecoveryCodes.hashed as unknown as object) : undefined,
        platformRole: u.platformRole ?? PlatformRole.NONE,
      },
      create: {
        email: u.email,
        name: u.email.split('@')[0]!.replace(/\./g, ' '),
        passwordHash,
        mfaSecret: u.mfaEnabled ? DEMO_ADMIN_MFA_SECRET : null,
        mfaEnabled: u.mfaEnabled,
        mfaRecoveryCodes: u.mfaEnabled ? (adminRecoveryCodes.hashed as unknown as object) : undefined,
        platformRole: u.platformRole ?? PlatformRole.NONE,
      },
    });

    if (u.email === 'owner@demo.local') ownerUserId = user.id;

    // Seat (tier TEAM, 1y expiry)
    const seat = await prisma.seat.upsert({
      where: { id: `seed-seat-${u.email}` },
      update: {},
      create: {
        id: `seed-seat-${u.email}`,
        orgId: org.id,
        tier: SeatTier.TEAM,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });

    // OrgUser membership
    await prisma.orgUser.upsert({
      where: { userId_orgId: { userId: user.id, orgId: org.id } },
      update: {
        role: u.role,
        division: u.division,
        profession: u.profession,
        canManagePatients: u.canManagePatients ?? false,
        preferredNoteStyle: NoteStyle.HYBRID,
        isActive: true,
      },
      create: {
        userId: user.id,
        orgId: org.id,
        role: u.role,
        division: u.division,
        profession: u.profession,
        canManagePatients: u.canManagePatients ?? false,
        preferredNoteStyle: NoteStyle.HYBRID,
        isActive: true,
        seatId: seat.id,
      },
    });

    // Practitioner profile for the clinician
    if (u.email === 'clinician@demo.local') {
      const ou = await prisma.orgUser.findUnique({
        where: { userId_orgId: { userId: user.id, orgId: org.id } },
      });
      if (ou) {
        await prisma.practitionerProfile.upsert({
          where: { orgUserId: ou.id },
          update: {},
          create: {
            orgUserId: ou.id,
            npi: '1234567890',
            specialty: 'Family Medicine',
            displayName: 'Dr. Clinician Demo',
          },
        });
      }
    }
  }

  // Backfill org.baaCountersignedBy with the platform owner now that they exist.
  if (ownerUserId) {
    await prisma.organization.update({
      where: { id: org.id },
      data: { baaCountersignedBy: ownerUserId },
    });
  }

  // Sanity: generate a TOTP token against the seeded secret so devs know
  // their authenticator app will accept it.
  const token = await generateTotp({ secret: DEMO_ADMIN_MFA_SECRET });
  console.log(`Seeded admin@demo.local MFA secret (test vector): ${DEMO_ADMIN_MFA_SECRET}`);
  console.log(`Current TOTP token (changes every 30s): ${token}`);
  console.log(`Recovery codes (one-time print): ${adminRecoveryCodes.plain.join(', ')}`);

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
