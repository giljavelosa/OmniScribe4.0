/**
 * Seed for local dev. Creates a single Demo Clinic org with 5 users covering
 * every role (ORG_ADMIN, CLINICIAN, VIEWER, SITE_ADMIN, PLATFORM_OWNER),
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
  Profession,
  SeatTier,
  NoteStyle,
  NoteStatus,
  CaptureMode,
  EncounterStatus,
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
  // Tuple shape: [email, OrgRole, Division, profession?, professionType?, canManagePatients?, mfaEnabled?, platformRole?]
  const users: Array<{
    email: string;
    role: OrgRole;
    division: Division;
    profession?: string;
    professionType?: Profession;
    canManagePatients?: boolean;
    mfaEnabled: boolean;
    platformRole?: PlatformRole;
  }> = [
    { email: 'admin@demo.local', role: OrgRole.ORG_ADMIN, division: Division.MULTI, mfaEnabled: true },
    {
      email: 'clinician@demo.local',
      role: OrgRole.CLINICIAN,
      division: Division.MEDICAL,
      profession: 'Family Medicine MD',
      professionType: Profession.MD,
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
        professionType: u.professionType,
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
        professionType: u.professionType,
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

    // Multi-site enrollment seed — pre-enroll the clinician and the site
    // admin at the demo site as primary so the demo flows work end-to-end
    // without an admin click. Org-wide-admins (admin@demo.local /
    // owner@demo.local) don't need rows here.
    if (u.email === 'clinician@demo.local' || u.email === 'siteadmin@demo.local') {
      const ou = await prisma.orgUser.findUnique({
        where: { userId_orgId: { userId: user.id, orgId: org.id } },
      });
      if (ou) {
        await prisma.orgUserSite.upsert({
          where: { orgUserId_siteId: { orgUserId: ou.id, siteId: site.id } },
          update: { isPrimary: true },
          create: {
            orgUserId: ou.id,
            siteId: site.id,
            isPrimary: true,
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

  // ---------------- Preset NoteTemplates (Unit 05) ----------------
  // Four platform-level presets (orgId: null) — one per division except MEDICAL
  // which gets two so the "General SOAP" + "Acute Care" pair shows the
  // template picker working. The ai-generation worker auto-selects the first
  // preset by createdAt when a note has no template assigned, so the SOAP
  // template is intentionally created first within MEDICAL.
  console.log('Seeding preset NoteTemplates …');

  await prisma.noteTemplate.upsert({
    where: { id: 'seed-tmpl-medical-soap' },
    update: {},
    create: {
      id: 'seed-tmpl-medical-soap',
      orgId: null,
      name: 'General SOAP Note',
      description: 'Classic Subjective / Objective / Assessment / Plan structure suitable for any general medical visit.',
      division: Division.MEDICAL,
      visibility: 'PUBLIC',
      isPreset: true,
      version: 1,
      sectionSchema: {
        sections: [
          { id: 'subjective', label: 'Subjective', required: true, promptHint: 'Patient-reported history of present illness, symptoms, timeline, relevant context. Quote the patient sparingly.' },
          { id: 'objective', label: 'Objective', required: true, promptHint: 'Vitals, exam findings, in-room measurements, observable behavior. No interpretation.' },
          { id: 'assessment', label: 'Assessment', required: true, promptHint: 'Clinical impression and differential. Tie to documented findings.' },
          { id: 'plan', label: 'Plan', required: true, promptHint: 'Medications, orders, education, follow-up. Be specific.' },
        ],
      },
    },
  });

  await prisma.noteTemplate.upsert({
    where: { id: 'seed-tmpl-medical-acute' },
    update: {},
    create: {
      id: 'seed-tmpl-medical-acute',
      orgId: null,
      name: 'Acute Care Visit',
      description: 'Focused acute-care template for urgent / same-day visits with a single presenting complaint.',
      division: Division.MEDICAL,
      visibility: 'PUBLIC',
      isPreset: true,
      version: 1,
      sectionSchema: {
        sections: [
          { id: 'chief_complaint', label: 'Chief Complaint', required: true, promptHint: 'One sentence in the patient’s words or close paraphrase.' },
          { id: 'hpi', label: 'History of Present Illness', required: true, promptHint: 'OPQRST when applicable. Relevant negatives.' },
          { id: 'exam', label: 'Physical Exam', required: true, promptHint: 'Targeted exam to the chief complaint. Document pertinent negatives.' },
          { id: 'assessment', label: 'Assessment', required: true, promptHint: 'Working impression. Differential if relevant.' },
          { id: 'plan', label: 'Plan', required: true, promptHint: 'Treatment, return precautions, follow-up.' },
          { id: 'patient_education', label: 'Patient Education', required: false, promptHint: 'What was explained to the patient and any handouts given.' },
        ],
      },
    },
  });

  await prisma.noteTemplate.upsert({
    where: { id: 'seed-tmpl-bh-session' },
    update: {},
    create: {
      id: 'seed-tmpl-bh-session',
      orgId: null,
      name: 'Behavioral Health Session Note',
      description: 'Therapy session note with risk assessment and intervention tracking.',
      division: Division.BEHAVIORAL_HEALTH,
      visibility: 'PUBLIC',
      isPreset: true,
      version: 1,
      sensitivityDefault: 'STANDARD_CLINICAL',
      sectionSchema: {
        sections: [
          { id: 'presenting_concern', label: 'Presenting Concern', required: true, promptHint: 'What the client brought into session today. Their words where useful; brief, non-interpretive.' },
          { id: 'mental_status', label: 'Mental Status Exam', required: true, promptHint: 'Appearance, behavior, mood/affect, speech, thought process/content, perception, cognition, insight/judgment.' },
          { id: 'risk_assessment', label: 'Risk Assessment', required: true, promptHint: 'SI/HI screening. If denied, document explicitly. If endorsed, document plan/means/intent + safety plan.' },
          { id: 'interventions', label: 'Interventions', required: true, promptHint: 'Therapeutic interventions used this session (modality, techniques, client response).' },
          { id: 'plan', label: 'Plan', required: true, promptHint: 'Between-session work, next session focus, referrals, medication coordination.' },
          { id: 'collateral', label: 'Collateral / Coordination', required: false, promptHint: 'Communication with family, other providers, school/work, only if documented in session.' },
        ],
      },
    },
  });

  await prisma.noteTemplate.upsert({
    where: { id: 'seed-tmpl-rehab-daily' },
    update: {},
    create: {
      id: 'seed-tmpl-rehab-daily',
      orgId: null,
      name: 'PT/OT Daily Note',
      description: 'Outpatient rehab daily note with objective measures and goal-progress reporting.',
      division: Division.REHAB,
      visibility: 'PUBLIC',
      isPreset: true,
      version: 1,
      sectionSchema: {
        sections: [
          { id: 'subjective', label: 'Subjective', required: true, promptHint: 'Pain rating, functional changes since last visit, patient report.' },
          { id: 'objective_measures', label: 'Objective Measures', required: true, promptHint: 'ROM, MMT, special tests, outcome measures, gait/functional observations with quantitative values.' },
          { id: 'treatment_performed', label: 'Treatment Performed', required: true, promptHint: 'Therapeutic exercises, manual techniques, modalities, education — with sets/reps/duration where applicable.' },
          { id: 'patient_response', label: 'Patient Response', required: true, promptHint: 'How the patient tolerated treatment, immediate response, any adverse reactions.' },
          { id: 'goal_progress', label: 'Goal Progress', required: true, promptHint: 'Update on each active LTG/STG — met / partially met / unchanged / regressed, with brief rationale.' },
          { id: 'plan', label: 'Plan', required: true, promptHint: 'Next visit focus, HEP updates, frequency/duration changes, referrals.' },
        ],
      },
    },
  });

  // ---------------- Multi-discipline test corpus ----------------
  // Seeds the data shape needed to exercise the cross-division stratification
  // on /patients/[id] (PR #92):
  //   - 6 additional Demo Clinic clinicians of varied professions
  //   - 1 additional Demo Clinic site (Westside)
  //   - 1 second organization (Acme Specialty Care) with its own user + patient
  //   - 9 signed visits across the existing 3 patients, spanning multiple
  //     clinicians + divisions + episodes
  // All deterministic (stable IDs + dates relative to seed time) so re-runs
  // are idempotent.

  type SeedClinician = {
    email: string;
    name: string;
    division: Division;
    professionType: Profession;
    profession: string;
  };
  const extraClinicians: SeedClinician[] = [
    { email: 'pt.smith@demo.local', name: 'Dr. Sara Smith', division: Division.REHAB, professionType: Profession.PT, profession: 'Orthopedic PT' },
    { email: 'ot.lee@demo.local', name: 'Dr. Aaron Lee', division: Division.REHAB, professionType: Profession.OT, profession: 'Outpatient OT' },
    { email: 'slp.wong@demo.local', name: 'Dr. Jane Wong', division: Division.REHAB, professionType: Profession.SLP, profession: 'Adult SLP' },
    { email: 'lcsw.garcia@demo.local', name: 'Dr. Carlos Garcia', division: Division.BEHAVIORAL_HEALTH, professionType: Profession.LCSW, profession: 'Clinical Social Worker' },
    { email: 'psy.patel@demo.local', name: 'Dr. Anika Patel', division: Division.BEHAVIORAL_HEALTH, professionType: Profession.PSYCHOLOGIST, profession: 'Clinical Psychologist' },
    { email: 'np.brown@demo.local', name: 'Dr. Maya Brown', division: Division.MEDICAL, professionType: Profession.NP, profession: 'Family NP' },
  ];

  const clinicianRowByEmail: Record<string, { userId: string; orgUserId: string }> = {};
  for (const c of extraClinicians) {
    const u = await prisma.user.upsert({
      where: { email: c.email },
      update: { name: c.name },
      create: {
        email: c.email,
        name: c.name,
        passwordHash: await hashPassword(DEMO_PASSWORD),
        mfaEnabled: false,
        platformRole: PlatformRole.NONE,
      },
    });
    const seat = await prisma.seat.upsert({
      where: { id: `seed-seat-${c.email}` },
      update: {},
      create: {
        id: `seed-seat-${c.email}`,
        orgId: org.id,
        tier: SeatTier.TEAM,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });
    const ou = await prisma.orgUser.upsert({
      where: { userId_orgId: { userId: u.id, orgId: org.id } },
      update: {
        division: c.division,
        profession: c.profession,
        professionType: c.professionType,
        canManagePatients: true,
      },
      create: {
        userId: u.id,
        orgId: org.id,
        role: OrgRole.CLINICIAN,
        division: c.division,
        profession: c.profession,
        professionType: c.professionType,
        canManagePatients: true,
        preferredNoteStyle: NoteStyle.HYBRID,
        seatId: seat.id,
      },
    });
    clinicianRowByEmail[c.email] = { userId: u.id, orgUserId: ou.id };
  }

  // Track the existing demo clinician too (for cross-division MD visits below).
  const clinicianUserFull = await prisma.user.findUnique({
    where: { email: 'clinician@demo.local' },
    include: { orgUsers: { where: { orgId: org.id }, take: 1 } },
  });
  clinicianRowByEmail['clinician@demo.local'] = {
    userId: clinicianUserFull!.id,
    orgUserId: clinicianUserFull!.orgUsers[0]!.id,
  };

  // Second site under Demo Clinic — gives the admin/site picker something to chew on.
  await prisma.site.upsert({
    where: { id: 'seed-demo-site-westside' },
    update: {},
    create: {
      id: 'seed-demo-site-westside',
      orgId: org.id,
      name: 'Demo Westside Clinic',
      address: '47 Demo Way, West Wing, Springfield, USA',
      phone: '+1-555-0199',
      primaryDivision: Division.REHAB,
    },
  });

  // Second organization — Acme Specialty Care — proves cross-tenant isolation
  // in the admin / owner consoles. Smaller footprint: 1 clinician + 1 patient.
  const acmeOrg = await prisma.organization.upsert({
    where: { id: 'seed-acme-clinic' },
    update: {},
    create: {
      id: 'seed-acme-clinic',
      name: 'Acme Specialty Care',
      division: Division.MEDICAL,
      defaultDivision: Division.MEDICAL,
      billingEmail: 'billing@acme.local',
      forceMfa: false,
      baaExecutedAt: new Date('2026-05-17T00:00:00Z'),
      baaVersion: '2026.05.01',
      complianceProfile: ComplianceProfile.STANDARD,
    },
  });
  const acmeSite = await prisma.site.upsert({
    where: { id: 'seed-acme-site' },
    update: {},
    create: {
      id: 'seed-acme-site',
      orgId: acmeOrg.id,
      name: 'Acme Main Office',
      address: '99 Acme Blvd, Springfield, USA',
      phone: '+1-555-0250',
      primaryDivision: Division.MEDICAL,
    },
  });
  const acmeMdUser = await prisma.user.upsert({
    where: { email: 'md.acme@demo.local' },
    update: { name: 'Dr. Olivia Reed' },
    create: {
      email: 'md.acme@demo.local',
      name: 'Dr. Olivia Reed',
      passwordHash: await hashPassword(DEMO_PASSWORD),
      mfaEnabled: false,
      platformRole: PlatformRole.NONE,
    },
  });
  const acmeMdSeat = await prisma.seat.upsert({
    where: { id: 'seed-seat-acme-md' },
    update: {},
    create: {
      id: 'seed-seat-acme-md',
      orgId: acmeOrg.id,
      tier: SeatTier.TEAM,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });
  await prisma.orgUser.upsert({
    where: { userId_orgId: { userId: acmeMdUser.id, orgId: acmeOrg.id } },
    update: {},
    create: {
      userId: acmeMdUser.id,
      orgId: acmeOrg.id,
      role: OrgRole.CLINICIAN,
      division: Division.MEDICAL,
      profession: 'Internal Medicine MD',
      professionType: Profession.MD,
      canManagePatients: true,
      preferredNoteStyle: NoteStyle.HYBRID,
      seatId: acmeMdSeat.id,
    },
  });
  await prisma.patient.upsert({
    where: { id: 'seed-acme-patient' },
    update: {},
    create: {
      id: 'seed-acme-patient',
      orgId: acmeOrg.id,
      siteId: acmeSite.id,
      division: Division.MEDICAL,
      firstName: 'Rachel',
      lastName: 'Kim',
      mrn: 'ACME-001',
      dob: new Date('1980-03-14'),
      sex: PatientSex.FEMALE,
      preferredLanguage: 'en',
    },
  });

  // Additional episodes of care for James Park (cross-division coverage)
  // so his chart's "By episode" view shows three distinct episode buckets.
  const jpRehabEpisode = await prisma.episodeOfCare.upsert({
    where: { id: 'seed-episode-jp-rehab' },
    update: {},
    create: {
      id: 'seed-episode-jp-rehab',
      orgId: org.id,
      patientId: 'seed-patient-medical',
      clinicianOrgUserId: clinicianRowByEmail['pt.smith@demo.local']!.orgUserId,
      departmentId: deptRehab.id,
      division: Division.REHAB,
      diagnosis: 'Right rotator cuff strain',
      status: EpisodeStatus.ACTIVE,
    },
  });
  const jpBhEpisode = await prisma.episodeOfCare.upsert({
    where: { id: 'seed-episode-jp-bh' },
    update: {},
    create: {
      id: 'seed-episode-jp-bh',
      orgId: org.id,
      patientId: 'seed-patient-medical',
      clinicianOrgUserId: clinicianRowByEmail['lcsw.garcia@demo.local']!.orgUserId,
      departmentId: deptBh.id,
      division: Division.BEHAVIORAL_HEALTH,
      diagnosis: 'Adjustment disorder with anxious mood',
      status: EpisodeStatus.ACTIVE,
    },
  });

  // Helper: build a minimal-but-valid finalJson the assessment-snippet
  // deriver can read (the visit-history rows show the Assessment text).
  function buildFinalJson(args: {
    subjective?: string;
    assessment: string;
    plan?: string;
  }) {
    return {
      sections: [
        { id: 'subjective', label: 'Subjective', content: args.subjective ?? '' },
        { id: 'assessment', label: 'Assessment', content: args.assessment },
        { id: 'plan', label: 'Plan', content: args.plan ?? '' },
      ],
    };
  }

  type SeedVisit = {
    noteId: string;
    patientId: string;
    clinicianEmail: string;
    division: Division;
    templateId: string;
    signedDaysAgo: number;
    departmentId: string;
    episodeId?: string;
    subjective?: string;
    assessment: string;
    plan?: string;
  };

  const visits: SeedVisit[] = [
    // James Park (primary: MEDICAL) — visits from MD / PT / LCSW
    {
      noteId: 'seed-visit-jp-md-1',
      patientId: 'seed-patient-medical',
      clinicianEmail: 'np.brown@demo.local',
      division: Division.MEDICAL,
      templateId: 'seed-tmpl-medical-soap',
      signedDaysAgo: 21,
      departmentId: deptMedical.id,
      episodeId: 'seed-episode-seed-patient-medical',
      subjective: 'Patient reports headache 3-4× weekly, worse in mornings. Compliant with current lisinopril 10 mg.',
      assessment: '1. Essential hypertension — BP poorly controlled (avg 148/92 over last 5 readings). 2. Tension-type headache, likely related.',
      plan: 'Increase lisinopril to 20 mg daily. Recheck BP in 2 weeks. Consider adding HCTZ if not at goal.',
    },
    {
      noteId: 'seed-visit-jp-pt-1',
      patientId: 'seed-patient-medical',
      clinicianEmail: 'pt.smith@demo.local',
      division: Division.REHAB,
      templateId: 'seed-tmpl-rehab-daily',
      signedDaysAgo: 14,
      departmentId: deptRehab.id,
      episodeId: jpRehabEpisode.id,
      subjective: 'Right shoulder pain 6/10 with overhead reach; improving since last visit.',
      assessment: 'Right rotator cuff strain — week 3 of 8. Active flexion 140° (improved from 120°). Continued limited end-range external rotation.',
      plan: 'Continue PT 2×/week. Progress to resistive ER strengthening. HEP: scapular stabilization 2×/day.',
    },
    {
      noteId: 'seed-visit-jp-bh-1',
      patientId: 'seed-patient-medical',
      clinicianEmail: 'lcsw.garcia@demo.local',
      division: Division.BEHAVIORAL_HEALTH,
      templateId: 'seed-tmpl-bh-session',
      signedDaysAgo: 7,
      departmentId: deptBh.id,
      episodeId: jpBhEpisode.id,
      subjective: 'Patient reports continued work-related stress; sleep onset improved with CBT-I techniques.',
      assessment: 'Adjustment disorder with anxious mood — moderate improvement. PHQ-9: 7 (from 11). GAD-7: 8 (from 12). No SI/HI.',
      plan: 'Continue weekly CBT sessions. Reinforce cognitive restructuring + sleep hygiene. Re-screen GAD-7 in 4 weeks.',
    },
    // Maria Alvarez (primary: REHAB) — visits from PT / OT / MD
    {
      noteId: 'seed-visit-ma-pt-1',
      patientId: 'seed-patient-rehab',
      clinicianEmail: 'pt.smith@demo.local',
      division: Division.REHAB,
      templateId: 'seed-tmpl-rehab-daily',
      signedDaysAgo: 18,
      departmentId: deptRehab.id,
      episodeId: 'seed-episode-seed-patient-rehab',
      subjective: 'Patient ambulating with single-point cane; right knee pain 4/10 with stairs.',
      assessment: 'Right knee OA s/p arthroscopy — week 6 post-op. Active flexion 105° (improved from 90° last visit). Quad strength 4/5.',
      plan: 'Continue PT 2×/week. Progress to single-leg balance + closed-chain strengthening. HEP: TKE + step-ups.',
    },
    {
      noteId: 'seed-visit-ma-ot-1',
      patientId: 'seed-patient-rehab',
      clinicianEmail: 'ot.lee@demo.local',
      division: Division.REHAB,
      templateId: 'seed-tmpl-rehab-daily',
      signedDaysAgo: 11,
      departmentId: deptRehab.id,
      subjective: 'Difficulty with kitchen tasks requiring sustained standing; energy conservation a concern.',
      assessment: 'ADL impairment secondary to knee OA recovery + deconditioning. IADL score improved 12 points since intake.',
      plan: 'Issue perching stool for kitchen. Trial joint-protection strategies for grocery prep. Re-eval in 2 weeks.',
    },
    {
      noteId: 'seed-visit-ma-md-1',
      patientId: 'seed-patient-rehab',
      clinicianEmail: 'clinician@demo.local',
      division: Division.MEDICAL,
      templateId: 'seed-tmpl-medical-acute',
      signedDaysAgo: 4,
      departmentId: deptMedical.id,
      subjective: 'Routine post-op check; mild medial-knee warmth resolved. No new c/o.',
      assessment: 'S/p right knee arthroscopy — uncomplicated recovery. Wound well-healed. Cleared for full PT advancement.',
      plan: 'Continue ortho follow-up at 6 weeks. PCP follow-up in 3 months unless new concerns.',
    },
    // Devon Mitchell (primary: BH) — visits from LCSW / Psychologist / MD
    {
      noteId: 'seed-visit-dm-bh-1',
      patientId: 'seed-patient-bh',
      clinicianEmail: 'lcsw.garcia@demo.local',
      division: Division.BEHAVIORAL_HEALTH,
      templateId: 'seed-tmpl-bh-session',
      signedDaysAgo: 24,
      departmentId: deptBh.id,
      episodeId: 'seed-episode-seed-patient-bh',
      subjective: 'Patient reports anxiety worsens with deadlines; using deep breathing during work meetings.',
      assessment: 'Generalized anxiety disorder — moderate. GAD-7: 14. Sleep disturbed; appetite intact. No SI/HI.',
      plan: 'Initiate weekly CBT. Introduce worry-postponement + cognitive restructuring. Coordinate with PCP re: pharmacotherapy.',
    },
    {
      noteId: 'seed-visit-dm-psy-1',
      patientId: 'seed-patient-bh',
      clinicianEmail: 'psy.patel@demo.local',
      division: Division.BEHAVIORAL_HEALTH,
      templateId: 'seed-tmpl-bh-session',
      signedDaysAgo: 17,
      departmentId: deptBh.id,
      episodeId: 'seed-episode-seed-patient-bh',
      subjective: 'Psychodiagnostic intake follow-up. Reviewed MMPI-2 profile; congruent with anxious-distress presentation.',
      assessment: 'GAD primary; trait anxiety + perfectionistic schema. Rule out social anxiety — Liebowitz scheduled.',
      plan: 'Co-treat with LCSW (weekly CBT). Psychologist to provide quarterly progress re-evaluation. Liebowitz SAS in 1 week.',
    },
    {
      noteId: 'seed-visit-dm-md-1',
      patientId: 'seed-patient-bh',
      clinicianEmail: 'clinician@demo.local',
      division: Division.MEDICAL,
      templateId: 'seed-tmpl-medical-soap',
      signedDaysAgo: 9,
      departmentId: deptMedical.id,
      subjective: 'Patient requests medication evaluation per BH team recommendation. Current sleep impacted by anxiety.',
      assessment: 'GAD — co-managing with BH team. No medical contraindications to SSRI initiation. TSH wnl, CMP wnl.',
      plan: 'Start sertraline 25 mg daily × 1 week, then 50 mg. Follow up in 4 weeks for tolerability + GAD-7.',
    },
  ];

  for (const v of visits) {
    const c = clinicianRowByEmail[v.clinicianEmail];
    if (!c) throw new Error(`Seed: missing clinician ${v.clinicianEmail}`);
    const signedAt = new Date(Date.now() - v.signedDaysAgo * 86_400_000);
    const encounter = await prisma.encounter.upsert({
      where: { id: `seed-enc-${v.noteId}` },
      update: {},
      create: {
        id: `seed-enc-${v.noteId}`,
        orgId: org.id,
        patientId: v.patientId,
        clinicianOrgUserId: c.orgUserId,
        siteId: site.id,
        departmentId: v.departmentId,
        episodeOfCareId: v.episodeId ?? null,
        status: EncounterStatus.COMPLETED,
        startedAt: signedAt,
        endedAt: signedAt,
      },
    });
    await prisma.note.upsert({
      where: { id: v.noteId },
      update: {},
      create: {
        id: v.noteId,
        orgId: org.id,
        patientId: v.patientId,
        encounterId: encounter.id,
        clinicianOrgUserId: c.orgUserId,
        division: v.division,
        status: NoteStatus.SIGNED,
        captureMode: CaptureMode.LIVE,
        finalJson: buildFinalJson({
          subjective: v.subjective,
          assessment: v.assessment,
          plan: v.plan,
        }) as unknown as object,
        templateId: v.templateId,
        templateVersion: 1,
        noteStyle: NoteStyle.HYBRID,
        signedAt,
        signedByUserId: c.userId,
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
