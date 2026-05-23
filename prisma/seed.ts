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
  NoteArtifactKind,
  PatientAddressKind,
  ExternalContextSource,
  ExternalContextStatus,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import { generate as generateTotp } from 'otplib';
import {
  SEED_VISIT_CORPUS,
  SEED_PATIENT_DEMOGRAPHICS,
  DEMO_CLINIC_ORG_ID,
  ACME_VISIT_CORPUS,
  CASCADIA_VISIT_CORPUS,
  RIVERBEND_VISIT_CORPUS,
  buildFinalJson,
  buildTranscriptClean,
  buildPatientBrief,
  JAMES_PARK_BRIEF,
  MARIA_ALVAREZ_BRIEF,
  DEVON_MITCHELL_BRIEF,
  RACHEL_KIM_ACME_BRIEF,
  ROBERT_HAYES_ACME_BRIEF,
  ELENA_SANTOS_ACME_BRIEF,
  MARCUS_THOMPSON_BRIEF,
  PRIYA_DESAI_BRIEF,
  JAMAL_CARTER_BRIEF,
  LINDA_FOSTER_BRIEF,
  type SeedVisitCorpus,
} from './seed-corpus';
import { upsertCaseManagement, upsertRehabEpisode } from './seed-case-helpers';
import { seedAcmeOrganization, seedAcmeAdditionalEpisodes } from './seed-acme-org';
import { seedCascadiaOrganization } from './seed-cascadia-org';
import { seedRiverbendOrganization } from './seed-riverbend-org';
import type { PriorContextBriefContent } from '../src/types/brief';

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

type VisitSeedContext = {
  orgId: string;
  defaultSiteId: string;
  deptByKey: { medical: string; rehab: string; bh: string };
  clinicianRowByEmail: Record<string, { userId: string; orgUserId: string }>;
};

async function seedVisitCorpus(
  corpus: SeedVisitCorpus[],
  ctx: VisitSeedContext,
  label: string,
) {
  console.log(`Seeding signed-visit corpus (${label}) …`);
  for (const v of corpus) {
    const orgId = v.orgId ?? DEMO_CLINIC_ORG_ID;
    const siteId = v.siteId ?? ctx.defaultSiteId;
    const c = ctx.clinicianRowByEmail[v.clinicianEmail];
    if (!c) throw new Error(`Seed [${label}]: missing clinician ${v.clinicianEmail}`);
    const signedAt = new Date(Date.now() - v.signedDaysAgo * 86_400_000);
    const dateOfService =
      v.isLateEntry && v.lateEntryDaysGap
        ? new Date(signedAt.getTime() - v.lateEntryDaysGap * 86_400_000)
        : signedAt;
    const finalJson = buildFinalJson(v.sections, signedAt);
    const transcriptClean = buildTranscriptClean(v.transcript);
    const departmentId = ctx.deptByKey[v.departmentKey];

    const legacyCaseByEpisodeId: Record<string, string> = {
      'seed-episode-seed-patient-medical': 'seed-case-seed-patient-medical',
      'seed-episode-jp-bh': 'seed-case-jp-bh',
      'seed-episode-ma-medical': 'seed-case-ma-medical',
      'seed-episode-ma-bh': 'seed-case-ma-bh',
      'seed-episode-dm-medical': 'seed-case-dm-medical',
      'seed-acme-episode-medical': 'seed-acme-case-seed-acme-patient',
      'seed-acme-episode-bh': 'seed-acme-case-seed-acme-patient-bh',
      'seed-acme-episode-rh-medical': 'seed-acme-case-rh-medical',
      'seed-acme-episode-es-medical': 'seed-acme-case-es-medical',
      'seed-cascadia-episode-marcus-medical': 'seed-cascadia-case-marcus-medical',
      'seed-cascadia-episode-marcus-bh': 'seed-cascadia-case-marcus-bh',
      'seed-cascadia-episode-priya-medical': 'seed-cascadia-case-priya-medical',
      'seed-cascadia-episode-priya-bh': 'seed-cascadia-case-priya-bh',
      'seed-riverbend-episode-jamal-medical': 'seed-riverbend-case-jamal-medical',
      'seed-riverbend-episode-jamal-bh': 'seed-riverbend-case-jamal-bh',
      'seed-riverbend-episode-linda-medical': 'seed-riverbend-case-linda-medical',
      'seed-riverbend-episode-linda-bh': 'seed-riverbend-case-linda-bh',
    };
    let caseManagementId = `seed-case-${v.patientId}`;
    let episodeOfCareId: string | null = v.episodeId ?? null;
    if (v.episodeId) {
      const ep = await prisma.episodeOfCare.findUnique({
        where: { id: v.episodeId },
        select: { id: true, caseManagementId: true },
      });
      if (ep) {
        caseManagementId = ep.caseManagementId;
        episodeOfCareId = ep.id;
      } else {
        caseManagementId =
          legacyCaseByEpisodeId[v.episodeId] ?? `cm-from-ep-${v.episodeId}`;
        const caseRow = await prisma.caseManagement.findUnique({
          where: { id: caseManagementId },
          select: { id: true },
        });
        if (!caseRow) caseManagementId = `seed-case-${v.patientId}`;
        episodeOfCareId = null;
      }
    }

    const encounter = await prisma.encounter.upsert({
      where: { id: `seed-enc-${v.noteId}` },
      update: { startedAt: dateOfService, endedAt: dateOfService, caseManagementId },
      create: {
        id: `seed-enc-${v.noteId}`,
        orgId,
        patientId: v.patientId,
        clinicianOrgUserId: c.orgUserId,
        siteId,
        departmentId,
        caseManagementId,
        episodeOfCareId,
        status: EncounterStatus.COMPLETED,
        startedAt: dateOfService,
        endedAt: dateOfService,
      },
    });

    await prisma.note.upsert({
      where: { id: v.noteId },
      update: {
        finalJson: finalJson as unknown as object,
        transcriptClean: transcriptClean as unknown as object,
        dateOfService,
        isLateEntry: v.isLateEntry ?? false,
        lateEntryDaysGap: v.lateEntryDaysGap ?? null,
        signedAt,
        templateId: v.templateId,
      },
      create: {
        id: v.noteId,
        orgId,
        patientId: v.patientId,
        encounterId: encounter.id,
        clinicianOrgUserId: c.orgUserId,
        division: v.division,
        status: NoteStatus.SIGNED,
        captureMode: CaptureMode.LIVE,
        finalJson: finalJson as unknown as object,
        transcriptClean: transcriptClean as unknown as object,
        templateId: v.templateId,
        templateVersion: 1,
        noteStyle: NoteStyle.HYBRID,
        signedAt,
        signedByUserId: c.userId,
        dateOfService,
        isLateEntry: v.isLateEntry ?? false,
        lateEntryDaysGap: v.lateEntryDaysGap ?? null,
      },
    });

    await prisma.noteArtifact.upsert({
      where: { id: `seed-artifact-handout-${v.noteId}` },
      update: { content: v.handout as unknown as object },
      create: {
        id: `seed-artifact-handout-${v.noteId}`,
        noteId: v.noteId,
        kind: NoteArtifactKind.PATIENT_INSTRUCTIONS,
        content: v.handout as unknown as object,
        generatedAt: signedAt,
      },
    });

    if (v.referralLetter) {
      await prisma.noteArtifact.upsert({
        where: { id: `seed-artifact-referral-${v.noteId}` },
        update: { content: v.referralLetter as unknown as object },
        create: {
          id: `seed-artifact-referral-${v.noteId}`,
          noteId: v.noteId,
          kind: NoteArtifactKind.REFERRAL_LETTER,
          content: v.referralLetter as unknown as object,
          generatedAt: signedAt,
        },
      });
    }
  }
}

type BriefBuilder = (noteId: string, orgId: string) => {
  patientId: string;
  orgId: string;
  noteId: string;
  episodeId?: string;
  content: Omit<PriorContextBriefContent, 'generatedAt' | 'generatorVersion'>;
};

async function seedBriefsAndFollowUps(
  specs: ReadonlyArray<{ builder: BriefBuilder; noteId: string; orgId: string }>,
) {
  console.log('Seeding NoteBrief + FollowUp rows …');
  for (const spec of specs) {
    const input = spec.builder(spec.noteId, spec.orgId);
    const content = buildPatientBrief(input);
    await prisma.noteBrief.upsert({
      where: { noteId: spec.noteId },
      update: { content: content as unknown as object },
      create: {
        id: `seed-brief-${spec.noteId}`,
        noteId: spec.noteId,
        patientId: input.patientId,
        orgId: spec.orgId,
        episodeId: input.episodeId ?? null,
        sourceNoteIds: content.sourceNoteIds,
        generatedAt: new Date(),
        generatorVersion: 'seed-v1',
        model: 'seed',
        content: content as unknown as object,
      },
    });

    for (const fu of content.openFollowUps) {
      await prisma.followUp.upsert({
        where: { id: fu.followUpId },
        update: { text: fu.text, status: 'OPEN' },
        create: {
          id: fu.followUpId,
          orgId: spec.orgId,
          patientId: input.patientId,
          episodeId: input.episodeId ?? null,
          originNoteId: fu.source.noteId,
          text: fu.text,
          status: 'OPEN',
        },
      });
    }
  }
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
        // Only re-stamp the canonical test secret for users pre-enrolled in the
        // seed definition (admin@demo.local). For all other seed users, leave
        // mfaEnabled / mfaSecret / mfaRecoveryCodes untouched so that any real
        // enrollment completed during a dev session survives a re-seed.
        // Without this guard, every `npx prisma db seed` call resets
        // mfaEnabled=false, forcing the MFA setup screen on every sign-in.
        ...(u.mfaEnabled
          ? {
              mfaSecret: DEMO_ADMIN_MFA_SECRET,
              mfaEnabled: true,
              mfaRecoveryCodes: adminRecoveryCodes.hashed as unknown as object,
            }
          : {}),
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
      primaryIcd: 'I10',
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
      primaryIcd: 'M17.11',
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
      primaryIcd: 'F41.1',
      goalText: 'Reduce GAD-7 score from 14 to <8 within 12 weeks.',
    },
  ];

  for (const p of patients) {
    const demo = SEED_PATIENT_DEMOGRAPHICS[p.id];
    const patient = await prisma.patient.upsert({
      where: { id: p.id },
      update: {
        phone: demo?.phone,
        email: demo?.email,
      },
      create: {
        id: p.id,
        orgId: org.id,
        siteId: site.id,
        firstName: p.firstName,
        lastName: p.lastName,
        mrn: p.mrn,
        dob: p.dob,
        sex: p.sex,
        preferredLanguage: 'en',
        phone: demo?.phone,
        email: demo?.email,
      },
    });

    if (demo) {
      await prisma.patientAddress.upsert({
        where: { id: `seed-addr-${p.id}` },
        update: {},
        create: {
          id: `seed-addr-${p.id}`,
          patientId: patient.id,
          kind: PatientAddressKind.HOME,
          line1: demo.address.line1,
          line2: demo.address.line2,
          city: demo.address.city,
          state: demo.address.state,
          postalCode: demo.address.postalCode,
        },
      });
      await prisma.patientCoverage.upsert({
        where: { id: `seed-cov-${p.id}` },
        update: {},
        create: {
          id: `seed-cov-${p.id}`,
          patientId: patient.id,
          carrier: demo.coverage.carrier,
          planName: demo.coverage.planName,
          memberId: demo.coverage.memberId,
          groupId: demo.coverage.groupId,
        },
      });
      await prisma.patientEmergencyContact.upsert({
        where: { id: `seed-ec-${p.id}` },
        update: {},
        create: {
          id: `seed-ec-${p.id}`,
          patientId: patient.id,
          name: demo.emergency.name,
          relationship: demo.emergency.relationship,
          phone: demo.emergency.phone,
        },
      });
    }

    const bodyPart =
      p.id === 'seed-patient-rehab' ? 'Right knee' : undefined;
    const caseRow = await prisma.caseManagement.upsert({
      where: { id: `seed-case-${p.id}` },
      update: { primaryIcdLabel: p.diagnosis, primaryIcd: p.primaryIcd, description: bodyPart ?? null },
      create: {
        id: `seed-case-${p.id}`,
        orgId: org.id,
        patientId: patient.id,
        primaryIcd: p.primaryIcd,
        primaryIcdLabel: p.diagnosis,
        description: bodyPart ?? null,
        status: 'ACTIVE',
        openedByOrgUserId: clinicianOrgUserId,
      },
    });

    if (p.division !== Division.REHAB) {
      continue;
    }

    const episode = await prisma.episodeOfCare.upsert({
      where: { id: `seed-episode-${p.id}` },
      update: { bodyPart, caseManagementId: caseRow.id, primaryIcd: p.primaryIcd },
      create: {
        id: `seed-episode-${p.id}`,
        orgId: org.id,
        patientId: patient.id,
        caseManagementId: caseRow.id,
        clinicianOrgUserId,
        departmentId: p.department.id,
        division: Division.REHAB,
        diagnosis: p.diagnosis,
        bodyPart,
        primaryIcd: p.primaryIcd,
        primaryIcdLabel: p.diagnosis,
        status: EpisodeStatus.ACTIVE,
      },
    });
    await prisma.episodeGoal.upsert({
      where: { id: `seed-goal-${p.id}` },
      update: {
        baselineMeasure:
          p.id === 'seed-patient-rehab' ? 'Flexion 85° at PT eval' : undefined,
        targetMeasure:
          p.id === 'seed-patient-rehab'
            ? 'Flexion 120°'
            : p.id === 'seed-patient-bh'
              ? 'GAD-7 <8'
              : 'BP <130/80',
        currentMeasure:
          p.id === 'seed-patient-rehab'
            ? '118°'
            : p.id === 'seed-patient-bh'
              ? 'GAD-7: 8'
              : '128/82',
      },
      create: {
        id: `seed-goal-${p.id}`,
        episodeId: episode.id,
        goalType: GoalType.LTG,
        goalText: p.goalText,
        baselineMeasure:
          p.id === 'seed-patient-rehab' ? 'Flexion 85° at PT eval' : undefined,
        targetMeasure:
          p.id === 'seed-patient-rehab'
            ? 'Flexion 120°'
            : p.id === 'seed-patient-bh'
              ? 'GAD-7 <8'
              : 'BP <130/80',
        currentMeasure:
          p.id === 'seed-patient-rehab'
            ? '118°'
            : p.id === 'seed-patient-bh'
              ? 'GAD-7: 8'
              : '128/82',
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

  // Acme Specialty Care — full second org (sites, clinicians, patients, corpus).
  const acmeCtx = await seedAcmeOrganization(prisma, hashPassword);

  // Additional episodes of care for James Park (cross-division coverage).
  // Medical: Essential hypertension (primary episode, seeded above).
  // Rehab x2: Right rotator cuff (shoulder) + Left knee OA — both active,
  //   demonstrates multi-episode same-division chart view.
  // BH: Adjustment disorder.
  const jpShoulderCase = await upsertCaseManagement(prisma, {
    id: 'seed-case-jp-shoulder',
    orgId: org.id,
    patientId: 'seed-patient-medical',
    primaryIcd: 'M75.101',
    primaryIcdLabel: 'Right rotator cuff strain',
    description: 'Right shoulder',
    openedByOrgUserId: clinicianRowByEmail['pt.smith@demo.local']!.orgUserId,
  });
  const jpKneeCase = await upsertCaseManagement(prisma, {
    id: 'seed-case-jp-knee',
    orgId: org.id,
    patientId: 'seed-patient-medical',
    primaryIcd: 'M17.12',
    primaryIcdLabel: 'Left knee osteoarthritis',
    description: 'Left knee',
    openedByOrgUserId: clinicianRowByEmail['pt.smith@demo.local']!.orgUserId,
  });
  await upsertCaseManagement(prisma, {
    id: 'seed-case-jp-bh',
    orgId: org.id,
    patientId: 'seed-patient-medical',
    primaryIcd: 'F43.22',
    primaryIcdLabel: 'Adjustment disorder with anxious mood',
    openedByOrgUserId: clinicianRowByEmail['lcsw.garcia@demo.local']!.orgUserId,
  });

  const jpRehabEpisode = await upsertRehabEpisode(prisma, {
    id: 'seed-episode-jp-rehab',
    orgId: org.id,
    patientId: 'seed-patient-medical',
    caseManagementId: jpShoulderCase.id,
    clinicianOrgUserId: clinicianRowByEmail['pt.smith@demo.local']!.orgUserId,
    departmentId: deptRehab.id,
    diagnosis: 'Right rotator cuff strain',
    bodyPart: 'Right shoulder',
    primaryIcd: 'M75.101',
  });
  await prisma.episodeOfCare.update({
    where: { id: jpRehabEpisode.id },
    data: {
      visitsAuthorized: 16,
      visitsCompleted: 5,
      recertDueAt: new Date(Date.now() + 32 * 86_400_000),
    },
  });
  const jpKneeEpisode = await upsertRehabEpisode(prisma, {
    id: 'seed-episode-jp-knee',
    orgId: org.id,
    patientId: 'seed-patient-medical',
    caseManagementId: jpKneeCase.id,
    clinicianOrgUserId: clinicianRowByEmail['pt.smith@demo.local']!.orgUserId,
    departmentId: deptRehab.id,
    diagnosis: 'Left knee osteoarthritis',
    bodyPart: 'Left knee',
    primaryIcd: 'M17.12',
  });
  await prisma.episodeOfCare.update({
    where: { id: jpKneeEpisode.id },
    data: {
      visitsAuthorized: 12,
      visitsCompleted: 7,
      recertDueAt: new Date(Date.now() + 18 * 86_400_000),
    },
  });
  await prisma.episodeGoal.upsert({
    where: { id: 'seed-goal-jp-knee' },
    update: {},
    create: {
      id: 'seed-goal-jp-knee',
      episodeId: jpKneeEpisode.id,
      goalType: GoalType.LTG,
      goalText: 'Reduce left knee pain to ≤2/10 with stairs and restore functional ambulation without compensation within 8 weeks.',
      baselineMeasure: 'Pain 6/10 stairs, TUG 13.8 sec at eval',
      targetMeasure: 'Pain ≤2/10, TUG <12 sec',
      currentMeasure: '4/10 stairs, TUG 12.4 sec',
      status: GoalStatus.ACTIVE,
    },
  });

  // ── STG goal for knee episode ──────────────────────────────────────────────
  await prisma.episodeGoal.upsert({
    where: { id: 'seed-goal-jp-knee-stg' },
    update: {},
    create: {
      id: 'seed-goal-jp-knee-stg',
      episodeId: jpKneeEpisode.id,
      goalType: GoalType.STG,
      goalText: 'Achieve ≤3/10 knee pain on stairs and TUG <12.5 sec within 4 weeks.',
      baselineMeasure: 'Pain 6/10, TUG 13.8s',
      targetMeasure: 'Pain ≤3/10, TUG <12.5s',
      currentMeasure: 'Pain 4/10, TUG 12.4s',
      status: GoalStatus.PARTIALLY_MET,
    },
  });

  // ── Shoulder episode goals ─────────────────────────────────────────────────
  await prisma.episodeGoal.upsert({
    where: { id: 'seed-goal-jp-rehab-stg' },
    update: {},
    create: {
      id: 'seed-goal-jp-rehab-stg',
      episodeId: jpRehabEpisode.id,
      goalType: GoalType.STG,
      goalText: 'Achieve 160° shoulder flexion and full overhead reach without pain by week 6.',
      baselineMeasure: 'Flexion 110° at eval, pain 6/10 overhead',
      targetMeasure: 'Flexion 160°, pain ≤2/10',
      currentMeasure: '140°, pain 3/10',
      status: GoalStatus.ACTIVE,
    },
  });
  await prisma.episodeGoal.upsert({
    where: { id: 'seed-goal-jp-rehab-ltg' },
    update: {},
    create: {
      id: 'seed-goal-jp-rehab-ltg',
      episodeId: jpRehabEpisode.id,
      goalType: GoalType.LTG,
      goalText: 'Full return to overhead work activities without pain or compensation within 12 weeks.',
      baselineMeasure: 'Unable to reach above shoulder height; pain 6/10',
      targetMeasure: 'Full overhead reach, pain ≤1/10',
      currentMeasure: 'Reaches to forehead level, pain 3/10',
      status: GoalStatus.ACTIVE,
    },
  });

  // ── GoalProgressEntry trail for knee LTG ──────────────────────────────────
  const kneeTrailEntries = [
    { id: 'seed-gpe-jp-knee-1', daysAgo: 42, measure: '6/10 pain, TUG 13.8s', status: GoalStatus.ACTIVE, note: 'Initial evaluation — baseline values documented.' },
    { id: 'seed-gpe-jp-knee-2', daysAgo: 28, measure: '5/10 pain, TUG 13.1s', status: GoalStatus.ACTIVE, note: 'Progressing with quad sets + SLR. Tolerating 3×12 reps.' },
    { id: 'seed-gpe-jp-knee-3', daysAgo: 14, measure: '4.5/10 pain, TUG 12.6s', status: GoalStatus.ACTIVE, note: 'Added terminal knee extension. Stairs improving.' },
    { id: 'seed-gpe-jp-knee-4', daysAgo: 3, measure: '4/10 pain, TUG 12.4s', status: GoalStatus.ACTIVE, note: 'Progressing toward goal. Cane-free on level surfaces.' },
  ];
  for (const e of kneeTrailEntries) {
    await prisma.goalProgressEntry.upsert({
      where: { id: e.id },
      update: { measureValue: e.measure, deltaNote: e.note },
      create: {
        id: e.id,
        goalId: 'seed-goal-jp-knee',
        measureValue: e.measure,
        statusAtEntry: e.status,
        deltaNote: e.note,
        recordedAt: new Date(Date.now() - e.daysAgo * 86_400_000),
        recordedByOrgUserId: clinicianRowByEmail['pt.smith@demo.local']!.orgUserId,
      },
    });
  }

  // ── GoalProgressEntry trail for shoulder STG ──────────────────────────────
  const shoulderTrailEntries = [
    { id: 'seed-gpe-jp-rehab-stg-1', daysAgo: 35, measure: '110°, pain 6/10', status: GoalStatus.ACTIVE, note: 'Initial eval — AROM limited by pain at 110°.' },
    { id: 'seed-gpe-jp-rehab-stg-2', daysAgo: 21, measure: '120°, pain 5/10', status: GoalStatus.ACTIVE, note: 'Progressing with posterior capsule stretching + ER band.' },
    { id: 'seed-gpe-jp-rehab-stg-3', daysAgo: 7, measure: '140°, pain 3/10', status: GoalStatus.ACTIVE, note: 'Significant gain — now reaching to top of head level.' },
  ];
  for (const e of shoulderTrailEntries) {
    await prisma.goalProgressEntry.upsert({
      where: { id: e.id },
      update: { measureValue: e.measure, deltaNote: e.note },
      create: {
        id: e.id,
        goalId: 'seed-goal-jp-rehab-stg',
        measureValue: e.measure,
        statusAtEntry: e.status,
        deltaNote: e.note,
        recordedAt: new Date(Date.now() - e.daysAgo * 86_400_000),
        recordedByOrgUserId: clinicianRowByEmail['pt.smith@demo.local']!.orgUserId,
      },
    });
  }

  // ── SnapshotOverride entries — knee episode (populates the inline strip) ───
  const jpKneeSnaps = [
    { id: 'seed-snap-jp-pain',     measureKey: 'pain-nrs',           value: '4',    unit: '/10',    daysAgo: 3 },
    { id: 'seed-snap-jp-rom',      measureKey: 'rom-primary',        value: '110',  unit: '°',      daysAgo: 3 },
    { id: 'seed-snap-jp-strength', measureKey: 'strength-primary',   value: '4',    unit: '/5',     daysAgo: 3 },
    { id: 'seed-snap-jp-gait',     measureKey: 'gait-speed',         value: '0.96', unit: 'm/s',    daysAgo: 3 },
    { id: 'seed-snap-jp-koos',     measureKey: 'outcome-tool-score', value: '58',   unit: 'KOOS',   daysAgo: 3 },
  ];
  for (const s of jpKneeSnaps) {
    const recordedAt = new Date(Date.now() - s.daysAgo * 86_400_000);
    await prisma.snapshotOverride.upsert({
      where: { id: s.id },
      update: { valueJson: s.value, unit: s.unit },
      create: {
        id: s.id,
        orgId: org.id,
        patientId: 'seed-patient-medical',
        episodeId: jpKneeEpisode.id,
        measureKey: s.measureKey,
        valueJson: s.value as unknown as object,
        unit: s.unit,
        recordedAt,
        enteredByOrgUserId: clinicianRowByEmail['pt.smith@demo.local']!.orgUserId,
      },
    });
  }

  // ── ExternalContext (Prior Records) for James Park ─────────────────────────
  const jpPtOrgUserId = clinicianRowByEmail['clinician@demo.local']!.orgUserId;
  const jpExternalContexts = [
    {
      id: 'seed-ec-jp-ortho-referral',
      dateOfRecord: new Date(Date.now() - 65 * 86_400_000),
      source: ExternalContextSource.OUTSIDE_PROVIDER,
      sourceLabel: 'Orthopedic Associates — pre-surgical evaluation (Dr. R. Williams)',
      transcriptClean:
        `Referring clinician note — Orthopedic Associates (Dr. R. Williams)\n` +
        `Patient: James Park, DOB 04/12/1971\n` +
        `Reason for referral: Pre-surgical evaluation for left knee osteoarthritis\n\n` +
        `Summary: Patient presents with left knee OA (Kellgren-Lawrence grade 3 on standing AP). ` +
        `Conservative management with PT and NSAIDs ongoing ×6 months with partial response. ` +
        `Candidate for TKA if structured PT does not achieve functional goals.\n\n` +
        `Recommend 8-week outpatient PT prior to surgical decision. ` +
        `If ROM and pain NRS do not reach targets, proceed with TKA consult.\n\n` +
        `Key findings at eval: ROM 95° flexion, 0° extension. Pain NRS 7/10 stairs. TUG 16.2s.`,
    },
    {
      id: 'seed-ec-jp-patient-diary',
      dateOfRecord: new Date(Date.now() - 28 * 86_400_000),
      source: ExternalContextSource.PATIENT_SUPPLIED,
      sourceLabel: 'Patient-recorded weekly symptoms log',
      transcriptClean:
        `[Patient voice memo transcript — 28 days ago]\n\n` +
        `"Hi, this is James. Weekly update as requested. Did home exercises Mon/Tue/Thu/Sat — missed Wed for work. ` +
        `Knee feels a bit better. Stairs still tough in the morning, maybe 5/10. ` +
        `By afternoon drops to 3–4 after I warm up. Quad sets and TKE three times a day like you said. ` +
        `Ice pack really helps after. Question: can I use the recumbent bike at the gym? Will ask next session."`,
    },
    {
      id: 'seed-ec-jp-prior-pcp',
      dateOfRecord: new Date(Date.now() - 90 * 86_400_000),
      source: ExternalContextSource.OUTSIDE_PROVIDER,
      sourceLabel: 'Prior PCP records — Capitol Medical Group (Dr. A. Chen)',
      transcriptClean:
        `Transferred records summary — Capitol Medical Group\n` +
        `Patient: James Park (DOB 04/12/1971)\n\n` +
        `HTN: Diagnosed 2022, started lisinopril 10 mg, titrated to 20 mg 2023. ` +
        `Last BP at Capitol: 142/88 (2023-11-15).\n` +
        `MUSCULOSKELETAL: Left knee pain first documented 2021; X-ray early OA. Referred orthopedics 2023.\n` +
        `MEDICATIONS (last Capitol visit): Lisinopril 20 mg, Ibuprofen 400 mg PRN, Rosuvastatin 10 mg.\n` +
        `ALLERGIES: NKDA (confirmed multiple visits).\n` +
        `SOCIAL: Non-smoker, ~2–3 drinks/week, logistics management.`,
    },
    {
      id: 'seed-ec-jp-clinician-notes',
      dateOfRecord: new Date(Date.now() - 14 * 86_400_000),
      source: ExternalContextSource.CLINICIAN_NOTES,
      sourceLabel: 'Dr. Brown: phone triage note — BP spike concern',
      transcriptClean:
        `Clinician triage note — Dr. Maya Brown, 2 weeks ago\n\n` +
        `Patient called re: BP reading 148/94 at home (evening, after stressful day at work). ` +
        `Denies chest pain, headache, vision changes, dyspnea. No new medications. ` +
        `Lisinopril compliance confirmed. Advised to re-check BP next morning after adequate sleep. ` +
        `Follow-up reading reported as 131/84. Plan: continue current regimen, check repeat BMP in 6 weeks. ` +
        `Patient reassured. No ER visit needed.`,
    },
  ];
  for (const ec of jpExternalContexts) {
    await prisma.externalContext.upsert({
      where: { id: ec.id },
      update: { transcriptClean: ec.transcriptClean },
      create: {
        id: ec.id,
        orgId: org.id,
        patientId: 'seed-patient-medical',
        dateOfRecord: ec.dateOfRecord,
        source: ec.source,
        sourceLabel: ec.sourceLabel,
        transcriptClean: ec.transcriptClean,
        status: ExternalContextStatus.READY,
        addedByOrgUserId: jpPtOrgUserId,
      },
    });
  }
  await upsertCaseManagement(prisma, {
    id: 'seed-case-ma-medical',
    orgId: org.id,
    patientId: 'seed-patient-rehab',
    primaryIcd: 'I10',
    primaryIcdLabel: 'Essential hypertension; hypothyroidism',
    secondaryIcd: 'E03.9',
    secondaryIcdLabel: 'Hypothyroidism, unspecified',
    openedByOrgUserId: clinicianRowByEmail['np.brown@demo.local']!.orgUserId,
  });
  await upsertCaseManagement(prisma, {
    id: 'seed-case-ma-bh',
    orgId: org.id,
    patientId: 'seed-patient-rehab',
    primaryIcd: 'F43.21',
    primaryIcdLabel: 'Adjustment disorder with depressed mood — post-op social isolation',
    openedByOrgUserId: clinicianRowByEmail['lcsw.garcia@demo.local']!.orgUserId,
  });

  await upsertCaseManagement(prisma, {
    id: 'seed-case-dm-medical',
    orgId: org.id,
    patientId: 'seed-patient-bh',
    primaryIcd: 'F41.1',
    primaryIcdLabel: 'Generalized anxiety disorder — medical co-management',
    openedByOrgUserId: clinicianOrgUserId,
  });
  const dmCervicalCase = await upsertCaseManagement(prisma, {
    id: 'seed-case-dm-cervical',
    orgId: org.id,
    patientId: 'seed-patient-bh',
    primaryIcd: 'G44.86',
    primaryIcdLabel: 'Cervicogenic tension headaches / upper trap strain',
    description: 'Cervical spine',
    openedByOrgUserId: clinicianRowByEmail['pt.smith@demo.local']!.orgUserId,
  });
  const dmRehabEpisode = await upsertRehabEpisode(prisma, {
    id: 'seed-episode-dm-rehab',
    orgId: org.id,
    patientId: 'seed-patient-bh',
    caseManagementId: dmCervicalCase.id,
    clinicianOrgUserId: clinicianRowByEmail['pt.smith@demo.local']!.orgUserId,
    departmentId: deptRehab.id,
    diagnosis: 'Cervicogenic tension headaches / upper trap strain',
    bodyPart: 'Cervical spine',
    primaryIcd: 'G44.86',
  });
  await prisma.episodeGoal.upsert({
    where: { id: 'seed-goal-dm-rehab' },
    update: {},
    create: {
      id: 'seed-goal-dm-rehab',
      episodeId: dmRehabEpisode.id,
      goalType: GoalType.LTG,
      goalText: 'Reduce headache frequency to ≤1/week and HDI below 20%.',
      baselineMeasure: 'HDI 42%, headaches 2–3×/week',
      targetMeasure: 'HDI <20%, headaches ≤1/week',
      currentMeasure: 'HDI 28%, headaches 1×/week',
      status: GoalStatus.ACTIVE,
    },
  });

  // Acme Specialty Care — additional multi-episode rows for Rachel, Robert, Elena.
  await seedAcmeAdditionalEpisodes(prisma, acmeCtx);

  // Cascadia Health Network — third org with Marcus + Priya.
  const cascadiaCtx = await seedCascadiaOrganization(prisma, hashPassword);

  // Riverbend Integrated Care — fourth org with Jamal + Linda.
  const riverbendCtx = await seedRiverbendOrganization(prisma, hashPassword);

  const deptByKey = {
    medical: deptMedical.id,
    rehab: deptRehab.id,
    bh: deptBh.id,
  } as const;

  const demoCtx: VisitSeedContext = {
    orgId: org.id,
    defaultSiteId: site.id,
    deptByKey,
    clinicianRowByEmail,
  };

  await seedVisitCorpus(SEED_VISIT_CORPUS, demoCtx, 'Demo Clinic');
  await seedVisitCorpus(ACME_VISIT_CORPUS, acmeCtx, 'Acme Specialty Care');
  await seedVisitCorpus(CASCADIA_VISIT_CORPUS, cascadiaCtx, 'Cascadia Health Network');
  await seedVisitCorpus(RIVERBEND_VISIT_CORPUS, riverbendCtx, 'Riverbend Integrated Care');

  await seedBriefsAndFollowUps([
    { builder: JAMES_PARK_BRIEF, noteId: 'seed-visit-jp-md-2', orgId: org.id },
    { builder: MARIA_ALVAREZ_BRIEF, noteId: 'seed-visit-ma-pt-2', orgId: org.id },
    { builder: DEVON_MITCHELL_BRIEF, noteId: 'seed-visit-dm-bh-3', orgId: org.id },
    { builder: RACHEL_KIM_ACME_BRIEF, noteId: 'seed-acme-visit-rk-md-2', orgId: acmeCtx.orgId },
    { builder: ROBERT_HAYES_ACME_BRIEF, noteId: 'seed-acme-visit-rh-pt-2', orgId: acmeCtx.orgId },
    { builder: ELENA_SANTOS_ACME_BRIEF, noteId: 'seed-acme-visit-es-bh-2', orgId: acmeCtx.orgId },
    { builder: MARCUS_THOMPSON_BRIEF, noteId: 'seed-cascadia-visit-mt-md-headline', orgId: cascadiaCtx.orgId },
    { builder: PRIYA_DESAI_BRIEF, noteId: 'seed-cascadia-visit-pd-md-headline', orgId: cascadiaCtx.orgId },
    { builder: JAMAL_CARTER_BRIEF, noteId: 'seed-riverbend-visit-jc-md-headline', orgId: riverbendCtx.orgId },
    { builder: LINDA_FOSTER_BRIEF, noteId: 'seed-riverbend-visit-lf-md-headline', orgId: riverbendCtx.orgId },
  ]);

  // Backfill ICD-10-CM codes onto migration-generated CaseManagement rows
  // (`cm-from-ep-*` and `cm-uncat-*`). These predate the seed helper and are
  // not created via `upsertCaseManagement`, so they don't pick up the codes
  // assigned in the helper-driven calls above. Map by exact `primaryIcdLabel`
  // so the backfill stays idempotent across re-seeds.
  const labelToIcd: Record<string, string> = {
    'Essential hypertension': 'I10',
    'Right knee OA s/p arthroscopy': 'M17.11',
    'Generalized anxiety disorder': 'F41.1',
    'Right rotator cuff strain': 'M75.101',
    'Left knee osteoarthritis': 'M17.12',
    'Adjustment disorder with anxious mood': 'F43.22',
    'Essential hypertension; hypothyroidism': 'I10',
    'Adjustment disorder with depressed mood — post-op social isolation': 'F43.21',
    'Generalized anxiety disorder — medical co-management': 'F41.1',
    'Cervicogenic tension headaches / upper trap strain': 'G44.86',
    'Type 2 diabetes mellitus': 'E11.9',
    'Mechanical low back pain': 'M54.50',
    'Major depressive disorder, single episode': 'F32.9',
    'Plantar fasciitis, right foot': 'M72.2',
    'Essential hypertension; prediabetes': 'I10',
    'Major depressive disorder — medical management': 'F33.9',
    'Type 2 diabetes mellitus with stage 3 chronic kidney disease': 'E11.22',
    'Right total knee arthroplasty — post-op rehabilitation': 'Z47.1',
    'Right subacromial impingement syndrome': 'M75.41',
    'Adjustment disorder with depressed mood — coping with chronic illness': 'F43.21',
    'Chronic migraine with aura; perimenopausal symptoms': 'G43.109',
    'Cervicogenic headache with upper-cervical hypomobility': 'G44.86',
    'Right wrist extensor tendinopathy — repetitive strain': 'M65.831',
    'HIV-1 infection — well controlled on antiretroviral therapy': 'B20',
    'Left lateral malleolus fracture s/p ORIF — post-op rehabilitation': 'Z47.89',
    'Bilateral plantar fasciitis — overuse pattern': 'M72.2',
    'Major depressive disorder, recurrent — currently in partial remission': 'F33.41',
    'Heart failure with reduced ejection fraction (HFrEF, EF 35%) — stable': 'I50.22',
    'Right femoral neck fracture s/p ORIF — post-op rehabilitation': 'Z47.89',
    'Generalized deconditioning and high fall risk — balance/gait training': 'R26.81',
    'Mild cognitive impairment — supportive therapy + cognitive training': 'G31.84',
    'Uncategorized care': 'Z76.89',
  };
  // Intentionally NOT in the map (kept un-coded for "Needs coding" badge demo):
  //   'Generalized anxiety disorder with chronic insomnia'
  for (const [label, icd] of Object.entries(labelToIcd)) {
    await prisma.caseManagement.updateMany({
      where: { primaryIcdLabel: label, primaryIcd: null },
      data: { primaryIcd: icd },
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
