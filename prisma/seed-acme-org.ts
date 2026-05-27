/**
 * Acme Specialty Care — second seeded organization with full clinical corpus.
 * Proves cross-tenant isolation in owner/admin consoles and gives devs a
 * second rich tenant to explore without touching Demo Clinic data.
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
import { ACME_PATIENT_DEMOGRAPHICS } from './seed-corpus/acme';
import { upsertCaseManagement, upsertRehabEpisode } from './seed-case-helpers';

const ACME_ORG_ID = 'seed-acme-clinic';

export type AcmeSeedContext = {
  orgId: string;
  defaultSiteId: string;
  deptByKey: { medical: string; rehab: string; bh: string };
  clinicianRowByEmail: Record<string, { userId: string; orgUserId: string }>;
};

type HashFn = (plain: string) => Promise<string>;

export async function seedAcmeOrganization(
  prisma: PrismaClient,
  hashPassword: HashFn,
): Promise<AcmeSeedContext> {
  console.log('Seeding Acme Specialty Care org …');
  const passwordHash = await hashPassword('Demo1234!');

  const acmeOrg = await prisma.organization.upsert({
    where: { id: ACME_ORG_ID },
    update: { name: 'Acme Specialty Care', division: Division.MULTI },
    create: {
      id: ACME_ORG_ID,
      name: 'Acme Specialty Care',
      division: Division.MULTI,
      defaultDivision: Division.MEDICAL,
      billingEmail: 'billing@acme.local',
      baaExecutedAt: new Date('2026-05-17T00:00:00Z'),
      baaVersion: '2026.05.01',
      complianceProfile: 'STANDARD',
    },
  });

  const acmeSiteMain = await prisma.site.upsert({
    where: { id: 'seed-acme-site' },
    update: {},
    create: {
      id: 'seed-acme-site',
      orgId: acmeOrg.id,
      name: 'Acme Downtown Medical',
      address: '99 Acme Blvd, Springfield, USA',
      phone: '+1-555-0250',
      primaryDivision: Division.MEDICAL,
    },
  });

  const acmeSiteNorth = await prisma.site.upsert({
    where: { id: 'seed-acme-site-north' },
    update: {},
    create: {
      id: 'seed-acme-site-north',
      orgId: acmeOrg.id,
      name: 'Acme North Rehab Center',
      address: '1200 Northfield Rd, North Springfield, USA',
      phone: '+1-555-0255',
      primaryDivision: Division.REHAB,
    },
  });

  await prisma.room.upsert({
    where: { id: 'seed-acme-room-1' },
    update: {},
    create: { id: 'seed-acme-room-1', siteId: acmeSiteMain.id, name: 'Suite 101' },
  });
  await prisma.room.upsert({
    where: { id: 'seed-acme-room-north-gym' },
    update: {},
    create: { id: 'seed-acme-room-north-gym', siteId: acmeSiteNorth.id, name: 'Rehab Gym A' },
  });

  const deptMedical = await prisma.department.upsert({
    where: { id: 'seed-acme-dept-medical' },
    update: {},
    create: {
      id: 'seed-acme-dept-medical',
      orgId: acmeOrg.id,
      siteId: acmeSiteMain.id,
      name: 'Internal Medicine',
      division: Division.MEDICAL,
    },
  });
  const deptRehab = await prisma.department.upsert({
    where: { id: 'seed-acme-dept-rehab' },
    update: {},
    create: {
      id: 'seed-acme-dept-rehab',
      orgId: acmeOrg.id,
      siteId: acmeSiteNorth.id,
      name: 'Outpatient Rehabilitation',
      division: Division.REHAB,
    },
  });
  const deptBh = await prisma.department.upsert({
    where: { id: 'seed-acme-dept-bh' },
    update: {},
    create: {
      id: 'seed-acme-dept-bh',
      orgId: acmeOrg.id,
      siteId: acmeSiteMain.id,
      name: 'Behavioral Health Services',
      division: Division.BEHAVIORAL_HEALTH,
    },
  });

  type AcmeUser = {
    email: string;
    name: string;
    role: OrgRole;
    division: Division;
    profession?: string;
    professionType?: Profession;
    canManagePatients?: boolean;
  };

  const acmeUsers: AcmeUser[] = [
    { email: 'admin@acme.local', name: 'Acme Admin', role: OrgRole.ORG_ADMIN, division: Division.MULTI },
    {
      email: 'clinician@acme.local',
      name: 'Dr. Olivia Reed',
      role: OrgRole.CLINICIAN,
      division: Division.MEDICAL,
      profession: 'Internal Medicine MD',
      professionType: Profession.MD,
      canManagePatients: true,
    },
    {
      email: 'np.acme@acme.local',
      name: 'Dr. Maya Chen',
      role: OrgRole.CLINICIAN,
      division: Division.MEDICAL,
      profession: 'Family NP',
      professionType: Profession.NP,
      canManagePatients: true,
    },
    {
      email: 'pt.nguyen@acme.local',
      name: 'Dr. Linh Nguyen',
      role: OrgRole.CLINICIAN,
      division: Division.REHAB,
      profession: 'Orthopedic PT',
      professionType: Profession.PT,
      canManagePatients: true,
    },
    {
      email: 'lcsw.taylor@acme.local',
      name: 'Jordan Taylor',
      role: OrgRole.CLINICIAN,
      division: Division.BEHAVIORAL_HEALTH,
      profession: 'Clinical Social Worker',
      professionType: Profession.LCSW,
      canManagePatients: true,
    },
    { email: 'viewer@acme.local', name: 'Acme Viewer', role: OrgRole.VIEWER, division: Division.MEDICAL },
  ];

  const clinicianRowByEmail: AcmeSeedContext['clinicianRowByEmail'] = {};

  for (const u of acmeUsers) {
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
        orgId: acmeOrg.id,
        tier: SeatTier.TEAM,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });

    const ou = await prisma.orgUser.upsert({
      where: { userId_orgId: { userId: user.id, orgId: acmeOrg.id } },
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
        orgId: acmeOrg.id,
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

    if (u.email === 'clinician@acme.local' || u.email === 'pt.nguyen@acme.local') {
      const enrollSiteId =
        u.email === 'pt.nguyen@acme.local' ? acmeSiteNorth.id : acmeSiteMain.id;
      await prisma.orgUserSite.upsert({
        where: { orgUserId_siteId: { orgUserId: ou.id, siteId: enrollSiteId } },
        update: { isPrimary: true },
        create: { orgUserId: ou.id, siteId: enrollSiteId, isPrimary: true },
      });
    }

    if (u.email === 'clinician@acme.local') {
      await prisma.practitionerProfile.upsert({
        where: { orgUserId: ou.id },
        update: {},
        create: {
          orgUserId: ou.id,
          npi: '9876543210',
          specialty: 'Internal Medicine',
          displayName: 'Dr. Olivia Reed',
        },
      });
    }
  }

  const patients = [
    {
      id: 'seed-acme-patient',
      mrn: 'ACME-1001',
      firstName: 'Rachel',
      lastName: 'Kim',
      sex: PatientSex.FEMALE,
      dob: new Date('1980-03-14'),
      siteId: acmeSiteMain.id,
      division: Division.MEDICAL,
      departmentId: deptMedical.id,
      diagnosis: 'Type 2 diabetes mellitus',
      primaryIcd: 'E11.9',
      goalText: 'Maintain A1c <7.5% with lifestyle + pharmacotherapy.',
      bodyPart: undefined as string | undefined,
    },
    {
      id: 'seed-acme-patient-rehab',
      mrn: 'ACME-2001',
      firstName: 'Robert',
      lastName: 'Hayes',
      sex: PatientSex.MALE,
      dob: new Date('1963-07-08'),
      siteId: acmeSiteNorth.id,
      division: Division.REHAB,
      departmentId: deptRehab.id,
      diagnosis: 'Mechanical low back pain',
      primaryIcd: 'M54.50',
      goalText: 'Reduce Oswestry disability score below 20%.',
      bodyPart: 'Lumbar spine',
    },
    {
      id: 'seed-acme-patient-bh',
      mrn: 'ACME-3001',
      firstName: 'Elena',
      lastName: 'Santos',
      sex: PatientSex.FEMALE,
      dob: new Date('1991-12-19'),
      siteId: acmeSiteMain.id,
      division: Division.BEHAVIORAL_HEALTH,
      departmentId: deptBh.id,
      diagnosis: 'Major depressive disorder, single episode',
      primaryIcd: 'F32.9',
      goalText: 'Reduce PHQ-9 below 10 and restore daily functioning.',
      bodyPart: undefined as string | undefined,
    },
  ];

  const primaryClinicianId = clinicianRowByEmail['clinician@acme.local']!.orgUserId;

  for (const p of patients) {
    const demo = ACME_PATIENT_DEMOGRAPHICS[p.id];
    const assignedClinician =
      p.id === 'seed-acme-patient-rehab'
        ? clinicianRowByEmail['pt.nguyen@acme.local']!.orgUserId
        : p.id === 'seed-acme-patient-bh'
          ? clinicianRowByEmail['lcsw.taylor@acme.local']!.orgUserId
          : primaryClinicianId;

    await prisma.patient.upsert({
      where: { id: p.id },
      update: { phone: demo?.phone, email: demo?.email },
      create: {
        id: p.id,
        orgId: acmeOrg.id,
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
        where: { id: `seed-acme-addr-${p.id}` },
        update: {},
        create: {
          id: `seed-acme-addr-${p.id}`,
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
        where: { id: `seed-acme-cov-${p.id}` },
        update: {},
        create: {
          id: `seed-acme-cov-${p.id}`,
          patientId: p.id,
          carrier: demo.coverage.carrier,
          planName: demo.coverage.planName,
          memberId: demo.coverage.memberId,
          groupId: demo.coverage.groupId,
        },
      });
      await prisma.patientEmergencyContact.upsert({
        where: { id: `seed-acme-ec-${p.id}` },
        update: {},
        create: {
          id: `seed-acme-ec-${p.id}`,
          patientId: p.id,
          name: demo.emergency.name,
          relationship: demo.emergency.relationship,
          phone: demo.emergency.phone,
        },
      });
    }

    const caseRow = await upsertCaseManagement(prisma, {
      id: `seed-acme-case-${p.id}`,
      orgId: acmeOrg.id,
      patientId: p.id,
      primaryIcd: p.primaryIcd,
      primaryIcdLabel: p.diagnosis,
      description: p.bodyPart ?? null,
      openedByOrgUserId: assignedClinician,
    });

    if (p.division !== Division.REHAB) continue;

    const episodeId =
      p.id === 'seed-acme-patient-rehab' ? 'seed-acme-episode-rehab' : `seed-acme-episode-rehab-${p.id}`;

    const episode = await upsertRehabEpisode(prisma, {
      id: episodeId,
      orgId: acmeOrg.id,
      patientId: p.id,
      caseManagementId: caseRow.id,
      clinicianOrgUserId: assignedClinician,
      departmentId: p.departmentId,
      diagnosis: p.diagnosis,
      bodyPart: p.bodyPart,
      primaryIcd: p.primaryIcd,
    });

    await prisma.episodeGoal.upsert({
      where: { id: `seed-acme-goal-${p.id}` },
      update: {},
      create: {
        id: `seed-acme-goal-${p.id}`,
        episodeId: episode.id,
        goalType: GoalType.LTG,
        goalText: p.goalText,
        status: GoalStatus.ACTIVE,
      },
    });
  }

  return {
    orgId: acmeOrg.id,
    defaultSiteId: acmeSiteMain.id,
    deptByKey: {
      medical: deptMedical.id,
      rehab: deptRehab.id,
      bh: deptBh.id,
    },
    clinicianRowByEmail,
  };
}

/** Additional concurrent episodes for Acme demo patients (multi-episode charts). */
export async function seedAcmeAdditionalEpisodes(
  prisma: PrismaClient,
  ctx: AcmeSeedContext,
) {
  const { orgId, deptByKey, clinicianRowByEmail } = ctx;

  const rkPlantarCase = await upsertCaseManagement(prisma, {
    id: 'seed-acme-case-rk-plantar',
    orgId,
    patientId: 'seed-acme-patient',
    primaryIcd: 'M72.2',
    primaryIcdLabel: 'Plantar fasciitis, right foot',
    description: 'Right foot',
    openedByOrgUserId: clinicianRowByEmail['pt.nguyen@acme.local']!.orgUserId,
  });
  const rkRehab = await upsertRehabEpisode(prisma, {
    id: 'seed-acme-episode-rk-rehab',
    orgId,
    patientId: 'seed-acme-patient',
    caseManagementId: rkPlantarCase.id,
    clinicianOrgUserId: clinicianRowByEmail['pt.nguyen@acme.local']!.orgUserId,
    departmentId: deptByKey.rehab,
    diagnosis: 'Plantar fasciitis, right foot',
    bodyPart: 'Right foot',
    primaryIcd: 'M72.2',
  });
  await prisma.episodeGoal.upsert({
    where: { id: 'seed-acme-goal-rk-rehab' },
    update: {},
    create: {
      id: 'seed-acme-goal-rk-rehab',
      episodeId: rkRehab.id,
      goalType: GoalType.LTG,
      goalText: 'Walk 35 min daily without heel pain within 6 weeks.',
      baselineMeasure: 'First-step pain 6/10',
      targetMeasure: 'First-step pain ≤2/10',
      currentMeasure: '3/10',
      status: GoalStatus.ACTIVE,
    },
  });

  await upsertCaseManagement(prisma, {
    id: 'seed-acme-case-rk-bh',
    orgId,
    patientId: 'seed-acme-patient',
    primaryIcd: 'F43.22',
    primaryIcdLabel: 'Adjustment disorder with anxious mood',
    openedByOrgUserId: clinicianRowByEmail['lcsw.taylor@acme.local']!.orgUserId,
  });

  await upsertCaseManagement(prisma, {
    id: 'seed-acme-case-rh-medical',
    orgId,
    patientId: 'seed-acme-patient-rehab',
    primaryIcd: 'I10',
    primaryIcdLabel: 'Essential hypertension; prediabetes',
    secondaryIcd: 'R73.03',
    secondaryIcdLabel: 'Prediabetes',
    openedByOrgUserId: clinicianRowByEmail['clinician@acme.local']!.orgUserId,
  });

  await upsertCaseManagement(prisma, {
    id: 'seed-acme-case-es-medical',
    orgId,
    patientId: 'seed-acme-patient-bh',
    primaryIcd: 'F33.9',
    primaryIcdLabel: 'Major depressive disorder — medical management',
    openedByOrgUserId: clinicianRowByEmail['clinician@acme.local']!.orgUserId,
  });
}
