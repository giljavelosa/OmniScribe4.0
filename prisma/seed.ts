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

import {
  PrismaClient,
  Division,
  OrgRole,
  PlatformRole,
  SeatTier,
  NoteStyle,
  ComplianceProfile,
  PatientSex,
  VisitType,
  ScheduleStatus,
  EpisodeStatus,
  GoalType,
  GoalStatus,
} from '@prisma/client';
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

  // ---------------- Unit 02: Departments + Patients + Schedules ----------------

  // Three demo departments, one per division — wired to the demo site.
  const deptMedical = await prisma.department.upsert({
    where: { id: 'seed-dept-medical' },
    update: {},
    create: {
      id: 'seed-dept-medical',
      orgId: org.id,
      siteId: site.id,
      name: 'Family Medicine',
      division: Division.MEDICAL,
    },
  });
  const deptRehab = await prisma.department.upsert({
    where: { id: 'seed-dept-rehab' },
    update: {},
    create: {
      id: 'seed-dept-rehab',
      orgId: org.id,
      siteId: site.id,
      name: 'Outpatient Physical Therapy',
      division: Division.REHAB,
    },
  });
  const deptBh = await prisma.department.upsert({
    where: { id: 'seed-dept-bh' },
    update: {},
    create: {
      id: 'seed-dept-bh',
      orgId: org.id,
      siteId: site.id,
      name: 'Behavioral Health Clinic',
      division: Division.BEHAVIORAL_HEALTH,
    },
  });

  // Find the seeded clinician's OrgUser id (we'll use it for schedules + episodes).
  const clinicianUser = await prisma.user.findUnique({
    where: { email: 'clinician@demo.local' },
    include: { orgUsers: { where: { orgId: org.id }, take: 1 } },
  });
  const clinicianOrgUserId = clinicianUser?.orgUsers[0]?.id;
  if (!clinicianOrgUserId) throw new Error('Seed: missing clinician OrgUser');

  // Three patients, one per division.
  const patients = [
    {
      id: 'seed-patient-medical',
      mrn: 'MED-1001',
      firstName: 'James',
      lastName: 'Park',
      sex: PatientSex.MALE,
      dob: new Date('1971-04-12'),
      division: Division.MEDICAL,
      department: deptMedical,
      diagnosis: 'Essential hypertension',
      goalText: 'Reduce average BP to <130/80 over 12 weeks.',
    },
    {
      id: 'seed-patient-rehab',
      mrn: 'REH-2001',
      firstName: 'Maria',
      lastName: 'Alvarez',
      sex: PatientSex.FEMALE,
      dob: new Date('1958-09-23'),
      division: Division.REHAB,
      department: deptRehab,
      diagnosis: 'Right knee OA s/p arthroscopy',
      goalText: 'Restore right-knee flexion to 120° within 8 weeks.',
    },
    {
      id: 'seed-patient-bh',
      mrn: 'BH-3001',
      firstName: 'Devon',
      lastName: 'Mitchell',
      sex: PatientSex.OTHER,
      dob: new Date('1995-11-02'),
      division: Division.BEHAVIORAL_HEALTH,
      department: deptBh,
      diagnosis: 'Generalized anxiety disorder',
      goalText: 'Reduce GAD-7 score from 14 to <8 within 12 weeks.',
    },
  ];

  for (const p of patients) {
    const patient = await prisma.patient.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        orgId: org.id,
        siteId: site.id,
        division: p.division,
        firstName: p.firstName,
        lastName: p.lastName,
        mrn: p.mrn,
        dob: p.dob,
        sex: p.sex,
        preferredLanguage: 'en',
      },
    });

    // One active episode per patient, anchored to the matching department.
    const episode = await prisma.episodeOfCare.upsert({
      where: { id: `seed-episode-${p.id}` },
      update: {},
      create: {
        id: `seed-episode-${p.id}`,
        orgId: org.id,
        patientId: patient.id,
        clinicianOrgUserId,
        departmentId: p.department.id,
        division: p.division,
        diagnosis: p.diagnosis,
        status: EpisodeStatus.ACTIVE,
      },
    });
    await prisma.episodeGoal.upsert({
      where: { id: `seed-goal-${p.id}` },
      update: {},
      create: {
        id: `seed-goal-${p.id}`,
        episodeId: episode.id,
        goalType: GoalType.LTG,
        goalText: p.goalText,
        status: GoalStatus.ACTIVE,
      },
    });
  }

  // Three scheduled appointments for today (one per patient) — staggered.
  const today = new Date();
  today.setHours(9, 0, 0, 0);
  const visitOffsets = [0, 60, 120]; // minutes
  for (let i = 0; i < patients.length; i++) {
    const p = patients[i]!;
    const start = new Date(today.getTime() + (visitOffsets[i] ?? 0) * 60_000);
    const end = new Date(start.getTime() + 30 * 60_000);
    await prisma.schedule.upsert({
      where: { id: `seed-schedule-${p.id}` },
      update: {},
      create: {
        id: `seed-schedule-${p.id}`,
        orgId: org.id,
        patientId: p.id,
        clinicianOrgUserId,
        siteId: site.id,
        roomId: i === 0 ? 'seed-demo-room-1' : 'seed-demo-room-2',
        visitType: i === 2 ? VisitType.TELEHEALTH : VisitType.IN_PERSON,
        scheduledStart: start,
        scheduledEnd: end,
        status: ScheduleStatus.SCHEDULED,
      },
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
