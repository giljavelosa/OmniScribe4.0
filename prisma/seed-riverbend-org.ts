/**
 * Riverbend Integrated Care — fourth seeded organization.
 * Community-health-center themed integrated practice with two rich
 * multi-division patients (Jamal Carter, Linda Foster). Brings the demo
 * data to 4 organizations × 10 patients with concurrent rehab episodes.
 */

import {
  PrismaClient,
  Division,
  OrgRole,
  Profession,
  SeatTier,
  NoteStyle,
  PatientSex,
  EpisodeStatus,
  GoalType,
  GoalStatus,
  PatientAddressKind,
} from '@prisma/client';
import { RIVERBEND_PATIENT_DEMOGRAPHICS } from './seed-corpus/riverbend';
import { upsertCaseManagement, upsertRehabEpisode } from './seed-case-helpers';

const RIVERBEND_ORG_ID = 'seed-riverbend-clinic';

export type RiverbendSeedContext = {
  orgId: string;
  defaultSiteId: string;
  deptByKey: { medical: string; rehab: string; bh: string };
  clinicianRowByEmail: Record<string, { userId: string; orgUserId: string }>;
};

type HashFn = (plain: string) => Promise<string>;

export async function seedRiverbendOrganization(
  prisma: PrismaClient,
  hashPassword: HashFn,
): Promise<RiverbendSeedContext> {
  console.log('Seeding Riverbend Integrated Care org …');
  const passwordHash = await hashPassword('Demo1234!');

  const org = await prisma.organization.upsert({
    where: { id: RIVERBEND_ORG_ID },
    update: {
      name: 'Riverbend Integrated Care',
      division: Division.MULTI,
      isDeleted: false,
      deletedAt: null,
      deletedByUserId: null,
    },
    create: {
      id: RIVERBEND_ORG_ID,
      name: 'Riverbend Integrated Care',
      division: Division.MULTI,
      defaultDivision: Division.MEDICAL,
      billingEmail: 'billing@riverbend.local',
      baaExecutedAt: new Date('2026-05-09T00:00:00Z'),
      baaVersion: '2026.05.01',
      complianceProfile: 'STANDARD',
    },
  });

  const siteMain = await prisma.site.upsert({
    where: { id: 'seed-riverbend-site-main' },
    update: {},
    create: {
      id: 'seed-riverbend-site-main',
      orgId: org.id,
      name: 'Riverbend Community Clinic',
      address: '301 Mill Street, Burlington, VT',
      phone: '+1-555-0610',
      primaryDivision: Division.MEDICAL,
    },
  });

  const siteWellness = await prisma.site.upsert({
    where: { id: 'seed-riverbend-site-wellness' },
    update: {},
    create: {
      id: 'seed-riverbend-site-wellness',
      orgId: org.id,
      name: 'Riverbend Wellness Center',
      address: '775 Lakeshore Drive, Burlington, VT',
      phone: '+1-555-0615',
      primaryDivision: Division.REHAB,
    },
  });

  await prisma.room.upsert({
    where: { id: 'seed-riverbend-room-1' },
    update: {},
    create: { id: 'seed-riverbend-room-1', siteId: siteMain.id, name: 'Exam Room 1' },
  });
  await prisma.room.upsert({
    where: { id: 'seed-riverbend-room-wellness-gym' },
    update: {},
    create: { id: 'seed-riverbend-room-wellness-gym', siteId: siteWellness.id, name: 'Rehab Gym' },
  });

  const deptMedical = await prisma.department.upsert({
    where: { id: 'seed-riverbend-dept-medical' },
    update: {},
    create: {
      id: 'seed-riverbend-dept-medical',
      orgId: org.id,
      siteId: siteMain.id,
      name: 'Family Medicine',
      division: Division.MEDICAL,
    },
  });
  const deptRehab = await prisma.department.upsert({
    where: { id: 'seed-riverbend-dept-rehab' },
    update: {},
    create: {
      id: 'seed-riverbend-dept-rehab',
      orgId: org.id,
      siteId: siteWellness.id,
      name: 'Rehabilitation Services',
      division: Division.REHAB,
    },
  });
  const deptBh = await prisma.department.upsert({
    where: { id: 'seed-riverbend-dept-bh' },
    update: {},
    create: {
      id: 'seed-riverbend-dept-bh',
      orgId: org.id,
      siteId: siteMain.id,
      name: 'Mental Health Services',
      division: Division.BEHAVIORAL_HEALTH,
    },
  });

  type RiverbendUser = {
    email: string;
    name: string;
    role: OrgRole;
    division: Division;
    profession?: string;
    professionType?: Profession;
    canManagePatients?: boolean;
    primarySiteId?: string;
  };

  const users: RiverbendUser[] = [
    // ORG_ADMIN is recording-capable → concrete division + profession (the org
    // itself stays MULTI; that's the legitimate multi-discipline aggregate).
    {
      email: 'admin@riverbend.local',
      name: 'Riverbend Admin',
      role: OrgRole.ORG_ADMIN,
      division: Division.MEDICAL,
      professionType: Profession.MD,
    },
    {
      email: 'do.boucher@riverbend.local',
      name: 'Dr. Camille Boucher',
      role: OrgRole.CLINICIAN,
      division: Division.MEDICAL,
      profession: 'Family Medicine DO',
      professionType: Profession.DO,
      canManagePatients: true,
      primarySiteId: siteMain.id,
    },
    {
      email: 'pa.rivera@riverbend.local',
      name: 'Diego Rivera, PA-C',
      role: OrgRole.CLINICIAN,
      division: Division.MEDICAL,
      profession: 'Family Medicine PA',
      professionType: Profession.PA,
      canManagePatients: true,
      primarySiteId: siteMain.id,
    },
    {
      email: 'pt.okonkwo@riverbend.local',
      name: 'Dr. Adaeze Okonkwo',
      role: OrgRole.CLINICIAN,
      division: Division.REHAB,
      profession: 'Geriatric PT',
      professionType: Profession.PT,
      canManagePatients: true,
      primarySiteId: siteWellness.id,
    },
    {
      email: 'slp.lindgren@riverbend.local',
      name: 'Britta Lindgren, MS CCC-SLP',
      role: OrgRole.CLINICIAN,
      division: Division.REHAB,
      profession: 'Adult SLP / Cognitive',
      professionType: Profession.SLP,
      canManagePatients: true,
      primarySiteId: siteWellness.id,
    },
    {
      email: 'psy.donovan@riverbend.local',
      name: 'Dr. Renee Donovan',
      role: OrgRole.CLINICIAN,
      division: Division.BEHAVIORAL_HEALTH,
      profession: 'Clinical Psychologist',
      professionType: Profession.PSYCHOLOGIST,
      canManagePatients: true,
      primarySiteId: siteMain.id,
    },
  ];

  const clinicianRowByEmail: RiverbendSeedContext['clinicianRowByEmail'] = {};

  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, passwordHash },
      create: {
        email: u.email,
        name: u.name,
        passwordHash,
        platformRole: 'NONE',
      },
    });

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

    const ou = await prisma.orgUser.upsert({
      where: { userId_orgId: { userId: user.id, orgId: org.id } },
      update: {
        role: u.role,
        division: u.division,
        profession: u.profession,
        professionType: u.professionType,
        canManagePatients: u.canManagePatients ?? false,
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

    if (u.role === OrgRole.CLINICIAN) {
      clinicianRowByEmail[u.email] = { userId: user.id, orgUserId: ou.id };
    }

    if (u.primarySiteId) {
      await prisma.orgUserSite.upsert({
        where: { orgUserId_siteId: { orgUserId: ou.id, siteId: u.primarySiteId } },
        update: { isPrimary: true },
        create: { orgUserId: ou.id, siteId: u.primarySiteId, isPrimary: true },
      });
    }

    if (u.email === 'do.boucher@riverbend.local') {
      await prisma.practitionerProfile.upsert({
        where: { orgUserId: ou.id },
        update: {},
        create: {
          orgUserId: ou.id,
          npi: '5544332211',
          specialty: 'Family Medicine',
          displayName: 'Dr. Camille Boucher',
        },
      });
    }
  }

  const patients = [
    {
      id: 'seed-riverbend-patient-jamal',
      mrn: 'RIV-1001',
      firstName: 'Jamal',
      lastName: 'Carter',
      sex: PatientSex.MALE,
      dob: new Date('1991-04-23'),
      siteId: siteMain.id,
    },
    {
      id: 'seed-riverbend-patient-linda',
      mrn: 'RIV-1002',
      firstName: 'Linda',
      lastName: 'Foster',
      sex: PatientSex.FEMALE,
      dob: new Date('1955-09-15'),
      siteId: siteMain.id,
    },
  ];

  for (const p of patients) {
    const demo = RIVERBEND_PATIENT_DEMOGRAPHICS[p.id];
    await prisma.patient.upsert({
      where: { id: p.id },
      update: { phone: demo?.phone, email: demo?.email },
      create: {
        id: p.id,
        orgId: org.id,
        siteId: p.siteId,
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
        where: { id: `seed-riverbend-addr-${p.id}` },
        update: {},
        create: {
          id: `seed-riverbend-addr-${p.id}`,
          patientId: p.id,
          kind: PatientAddressKind.HOME,
          line1: demo.address.line1,
          line2: demo.address.line2,
          city: demo.address.city,
          state: demo.address.state,
          postalCode: demo.address.postalCode,
        },
      });
      await prisma.patientCoverage.upsert({
        where: { id: `seed-riverbend-cov-${p.id}` },
        update: {},
        create: {
          id: `seed-riverbend-cov-${p.id}`,
          patientId: p.id,
          carrier: demo.coverage.carrier,
          planName: demo.coverage.planName,
          memberId: demo.coverage.memberId,
          groupId: demo.coverage.groupId,
        },
      });
      await prisma.patientEmergencyContact.upsert({
        where: { id: `seed-riverbend-ec-${p.id}` },
        update: {},
        create: {
          id: `seed-riverbend-ec-${p.id}`,
          patientId: p.id,
          name: demo.emergency.name,
          relationship: demo.emergency.relationship,
          phone: demo.emergency.phone,
        },
      });
    }
  }

  const doBoucher = clinicianRowByEmail['do.boucher@riverbend.local']!.orgUserId;
  const ptOkonkwo = clinicianRowByEmail['pt.okonkwo@riverbend.local']!.orgUserId;
  const slpLindgren = clinicianRowByEmail['slp.lindgren@riverbend.local']!.orgUserId;
  const psyDonovan = clinicianRowByEmail['psy.donovan@riverbend.local']!.orgUserId;

  // ── Jamal Carter — cases + REHAB episodes ─────────────────────────────
  await upsertCaseManagement(prisma, {
    id: 'seed-riverbend-case-jamal-medical',
    orgId: org.id,
    patientId: 'seed-riverbend-patient-jamal',
    primaryIcd: 'B20',
    primaryIcdLabel: 'HIV-1 infection — well controlled on antiretroviral therapy',
    openedByOrgUserId: doBoucher,
  });

  const jamalAnkleCase = await upsertCaseManagement(prisma, {
    id: 'seed-riverbend-case-jamal-ankle',
    orgId: org.id,
    patientId: 'seed-riverbend-patient-jamal',
    primaryIcd: 'Z47.89',
    primaryIcdLabel: 'Left lateral malleolus fracture s/p ORIF — post-op rehabilitation',
    description: 'Left ankle',
    openedByOrgUserId: ptOkonkwo,
  });
  const jamalAnkle = await upsertRehabEpisode(prisma, {
    id: 'seed-riverbend-episode-jamal-ankle',
    orgId: org.id,
    patientId: 'seed-riverbend-patient-jamal',
    caseManagementId: jamalAnkleCase.id,
    clinicianOrgUserId: ptOkonkwo,
    departmentId: deptRehab.id,
    diagnosis: 'Left lateral malleolus fracture s/p ORIF — post-op rehabilitation',
    bodyPart: 'Left ankle',
    primaryIcd: 'Z47.89',
  });
  await prisma.episodeGoal.upsert({
    where: { id: 'seed-riverbend-goal-jamal-ankle' },
    update: {},
    create: {
      id: 'seed-riverbend-goal-jamal-ankle',
      episodeId: jamalAnkle.id,
      goalType: GoalType.LTG,
      goalText: 'Return to recreational soccer with full ankle ROM and dynamic stability.',
      baselineMeasure: 'DF 5°, single-leg balance 6 sec',
      targetMeasure: 'DF ≥20°, single-leg balance ≥30 sec',
      currentMeasure: 'DF 14°, single-leg balance 22 sec',
      status: GoalStatus.ACTIVE,
    },
  });

  const jamalPlantarCase = await upsertCaseManagement(prisma, {
    id: 'seed-riverbend-case-jamal-plantar',
    orgId: org.id,
    patientId: 'seed-riverbend-patient-jamal',
    primaryIcd: 'M72.2',
    primaryIcdLabel: 'Bilateral plantar fasciitis — overuse pattern',
    description: 'Bilateral feet',
    openedByOrgUserId: ptOkonkwo,
  });
  const jamalPlantar = await upsertRehabEpisode(prisma, {
    id: 'seed-riverbend-episode-jamal-plantar',
    orgId: org.id,
    patientId: 'seed-riverbend-patient-jamal',
    caseManagementId: jamalPlantarCase.id,
    clinicianOrgUserId: ptOkonkwo,
    departmentId: deptRehab.id,
    diagnosis: 'Bilateral plantar fasciitis — overuse pattern',
    bodyPart: 'Bilateral feet',
    primaryIcd: 'M72.2',
  });
  await prisma.episodeGoal.upsert({
    where: { id: 'seed-riverbend-goal-jamal-plantar' },
    update: {},
    create: {
      id: 'seed-riverbend-goal-jamal-plantar',
      episodeId: jamalPlantar.id,
      goalType: GoalType.LTG,
      goalText: 'Pain-free first-step morning ambulation and 5K running.',
      baselineMeasure: 'First-step pain 7/10 bilaterally',
      targetMeasure: 'First-step pain ≤2/10, return to running',
      currentMeasure: 'First-step pain 4/10',
      status: GoalStatus.ACTIVE,
    },
  });

  await upsertCaseManagement(prisma, {
    id: 'seed-riverbend-case-jamal-bh',
    orgId: org.id,
    patientId: 'seed-riverbend-patient-jamal',
    primaryIcd: 'F33.41',
    primaryIcdLabel: 'Major depressive disorder, recurrent — currently in partial remission',
    openedByOrgUserId: psyDonovan,
  });

  // ── Linda Foster — cases + REHAB episodes ───────────────────────────────
  await upsertCaseManagement(prisma, {
    id: 'seed-riverbend-case-linda-medical',
    orgId: org.id,
    patientId: 'seed-riverbend-patient-linda',
    primaryIcd: 'I50.22',
    primaryIcdLabel: 'Heart failure with reduced ejection fraction (HFrEF, EF 35%) — stable',
    openedByOrgUserId: doBoucher,
  });

  const lindaHipCase = await upsertCaseManagement(prisma, {
    id: 'seed-riverbend-case-linda-hip',
    orgId: org.id,
    patientId: 'seed-riverbend-patient-linda',
    primaryIcd: 'Z47.89',
    primaryIcdLabel: 'Right femoral neck fracture s/p ORIF — post-op rehabilitation',
    description: 'Right hip',
    openedByOrgUserId: ptOkonkwo,
  });
  const lindaHip = await upsertRehabEpisode(prisma, {
    id: 'seed-riverbend-episode-linda-hip',
    orgId: org.id,
    patientId: 'seed-riverbend-patient-linda',
    caseManagementId: lindaHipCase.id,
    clinicianOrgUserId: ptOkonkwo,
    departmentId: deptRehab.id,
    diagnosis: 'Right femoral neck fracture s/p ORIF — post-op rehabilitation',
    bodyPart: 'Right hip',
    primaryIcd: 'Z47.89',
  });
  await prisma.episodeGoal.upsert({
    where: { id: 'seed-riverbend-goal-linda-hip' },
    update: {},
    create: {
      id: 'seed-riverbend-goal-linda-hip',
      episodeId: lindaHip.id,
      goalType: GoalType.LTG,
      goalText: 'Independent community ambulation with rolling walker and stairs with rail.',
      baselineMeasure: 'BBS 28/56, gait speed 0.32 m/s',
      targetMeasure: 'BBS ≥45, gait speed ≥0.6 m/s',
      currentMeasure: 'BBS 42, gait speed 0.55 m/s',
      status: GoalStatus.ACTIVE,
    },
  });

  const lindaBalanceCase = await upsertCaseManagement(prisma, {
    id: 'seed-riverbend-case-linda-balance',
    orgId: org.id,
    patientId: 'seed-riverbend-patient-linda',
    primaryIcd: 'R26.81',
    primaryIcdLabel: 'Generalized deconditioning and high fall risk — balance/gait training',
    openedByOrgUserId: ptOkonkwo,
  });
  const lindaBalance = await upsertRehabEpisode(prisma, {
    id: 'seed-riverbend-episode-linda-balance',
    orgId: org.id,
    patientId: 'seed-riverbend-patient-linda',
    caseManagementId: lindaBalanceCase.id,
    clinicianOrgUserId: ptOkonkwo,
    departmentId: deptRehab.id,
    diagnosis: 'Generalized deconditioning and high fall risk — balance/gait training',
    primaryIcd: 'R26.81',
  });
  await prisma.episodeGoal.upsert({
    where: { id: 'seed-riverbend-goal-linda-balance' },
    update: {},
    create: {
      id: 'seed-riverbend-goal-linda-balance',
      episodeId: lindaBalance.id,
      goalType: GoalType.LTG,
      goalText: 'Reduce fall risk to low category and improve 30-second sit-to-stand.',
      baselineMeasure: '30-sec STS 5 reps',
      targetMeasure: '30-sec STS ≥10 reps',
      currentMeasure: '30-sec STS 8 reps',
      status: GoalStatus.ACTIVE,
    },
  });

  await upsertCaseManagement(prisma, {
    id: 'seed-riverbend-case-linda-bh',
    orgId: org.id,
    patientId: 'seed-riverbend-patient-linda',
    primaryIcd: 'G31.84',
    primaryIcdLabel: 'Mild cognitive impairment — supportive therapy + cognitive training',
    openedByOrgUserId: psyDonovan,
  });

  return {
    orgId: org.id,
    defaultSiteId: siteMain.id,
    deptByKey: {
      medical: deptMedical.id,
      rehab: deptRehab.id,
      bh: deptBh.id,
    },
    clinicianRowByEmail,
  };
}
