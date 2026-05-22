/**
 * Cascadia Health Network — third seeded organization.
 * Pacific-Northwest themed multi-specialty network with two rich
 * multi-division patients (Marcus Thompson, Priya Desai) so the demo
 * corpus exercises 4-org cross-tenant isolation and 4+ richly-built
 * patients with concurrent rehab episodes of care.
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
import { CASCADIA_PATIENT_DEMOGRAPHICS } from './seed-corpus/cascadia';

const CASCADIA_ORG_ID = 'seed-cascadia-clinic';

export type CascadiaSeedContext = {
  orgId: string;
  defaultSiteId: string;
  deptByKey: { medical: string; rehab: string; bh: string };
  clinicianRowByEmail: Record<string, { userId: string; orgUserId: string }>;
};

type HashFn = (plain: string) => Promise<string>;

export async function seedCascadiaOrganization(
  prisma: PrismaClient,
  hashPassword: HashFn,
): Promise<CascadiaSeedContext> {
  console.log('Seeding Cascadia Health Network org …');
  const passwordHash = await hashPassword('Demo1234!');

  const org = await prisma.organization.upsert({
    where: { id: CASCADIA_ORG_ID },
    update: { name: 'Cascadia Health Network', division: Division.MULTI },
    create: {
      id: CASCADIA_ORG_ID,
      name: 'Cascadia Health Network',
      division: Division.MULTI,
      defaultDivision: Division.MEDICAL,
      billingEmail: 'billing@cascadia.local',
      forceMfa: false,
      baaExecutedAt: new Date('2026-05-12T00:00:00Z'),
      baaVersion: '2026.05.01',
      complianceProfile: 'STANDARD',
    },
  });

  const siteMain = await prisma.site.upsert({
    where: { id: 'seed-cascadia-site-main' },
    update: {},
    create: {
      id: 'seed-cascadia-site-main',
      orgId: org.id,
      name: 'Cascadia Downtown Medical',
      address: '500 Pine Street, Seattle, WA',
      phone: '+1-555-0410',
      primaryDivision: Division.MEDICAL,
    },
  });

  const siteRehab = await prisma.site.upsert({
    where: { id: 'seed-cascadia-site-rehab' },
    update: {},
    create: {
      id: 'seed-cascadia-site-rehab',
      orgId: org.id,
      name: 'Cascadia Riverside Therapy',
      address: '88 Riverside Lane, Seattle, WA',
      phone: '+1-555-0415',
      primaryDivision: Division.REHAB,
    },
  });

  await prisma.room.upsert({
    where: { id: 'seed-cascadia-room-1' },
    update: {},
    create: { id: 'seed-cascadia-room-1', siteId: siteMain.id, name: 'Exam Suite A' },
  });
  await prisma.room.upsert({
    where: { id: 'seed-cascadia-room-rehab-gym' },
    update: {},
    create: { id: 'seed-cascadia-room-rehab-gym', siteId: siteRehab.id, name: 'Therapy Gym' },
  });

  const deptMedical = await prisma.department.upsert({
    where: { id: 'seed-cascadia-dept-medical' },
    update: {},
    create: {
      id: 'seed-cascadia-dept-medical',
      orgId: org.id,
      siteId: siteMain.id,
      name: 'Internal Medicine',
      division: Division.MEDICAL,
    },
  });
  const deptRehab = await prisma.department.upsert({
    where: { id: 'seed-cascadia-dept-rehab' },
    update: {},
    create: {
      id: 'seed-cascadia-dept-rehab',
      orgId: org.id,
      siteId: siteRehab.id,
      name: 'Outpatient Rehabilitation',
      division: Division.REHAB,
    },
  });
  const deptBh = await prisma.department.upsert({
    where: { id: 'seed-cascadia-dept-bh' },
    update: {},
    create: {
      id: 'seed-cascadia-dept-bh',
      orgId: org.id,
      siteId: siteMain.id,
      name: 'Integrated Behavioral Health',
      division: Division.BEHAVIORAL_HEALTH,
    },
  });

  type CascadiaUser = {
    email: string;
    name: string;
    role: OrgRole;
    division: Division;
    profession?: string;
    professionType?: Profession;
    canManagePatients?: boolean;
    primarySiteId?: string;
  };

  const users: CascadiaUser[] = [
    { email: 'admin@cascadia.local', name: 'Cascadia Admin', role: OrgRole.ORG_ADMIN, division: Division.MULTI },
    {
      email: 'md.harper@cascadia.local',
      name: 'Dr. Evelyn Harper',
      role: OrgRole.CLINICIAN,
      division: Division.MEDICAL,
      profession: 'Internal Medicine MD',
      professionType: Profession.MD,
      canManagePatients: true,
      primarySiteId: siteMain.id,
    },
    {
      email: 'np.kapoor@cascadia.local',
      name: 'Dr. Anjali Kapoor',
      role: OrgRole.CLINICIAN,
      division: Division.MEDICAL,
      profession: 'Family NP',
      professionType: Profession.NP,
      canManagePatients: true,
      primarySiteId: siteMain.id,
    },
    {
      email: 'pt.morales@cascadia.local',
      name: 'Dr. Ricardo Morales',
      role: OrgRole.CLINICIAN,
      division: Division.REHAB,
      profession: 'Orthopedic PT',
      professionType: Profession.PT,
      canManagePatients: true,
      primarySiteId: siteRehab.id,
    },
    {
      email: 'ot.fischer@cascadia.local',
      name: 'Dr. Hannah Fischer',
      role: OrgRole.CLINICIAN,
      division: Division.REHAB,
      profession: 'Outpatient OT',
      professionType: Profession.OT,
      canManagePatients: true,
      primarySiteId: siteRehab.id,
    },
    {
      email: 'lcsw.bennett@cascadia.local',
      name: 'Tasha Bennett',
      role: OrgRole.CLINICIAN,
      division: Division.BEHAVIORAL_HEALTH,
      profession: 'Clinical Social Worker',
      professionType: Profession.LCSW,
      canManagePatients: true,
      primarySiteId: siteMain.id,
    },
  ];

  const clinicianRowByEmail: CascadiaSeedContext['clinicianRowByEmail'] = {};

  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, passwordHash },
      create: {
        email: u.email,
        name: u.name,
        passwordHash,
        mfaEnabled: false,
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

    if (u.email === 'md.harper@cascadia.local') {
      await prisma.practitionerProfile.upsert({
        where: { orgUserId: ou.id },
        update: {},
        create: {
          orgUserId: ou.id,
          npi: '1100022003',
          specialty: 'Internal Medicine',
          displayName: 'Dr. Evelyn Harper',
        },
      });
    }
  }

  const patients = [
    {
      id: 'seed-cascadia-patient-marcus',
      mrn: 'CAS-1001',
      firstName: 'Marcus',
      lastName: 'Thompson',
      sex: PatientSex.MALE,
      dob: new Date('1968-02-19'),
      siteId: siteMain.id,
    },
    {
      id: 'seed-cascadia-patient-priya',
      mrn: 'CAS-1002',
      firstName: 'Priya',
      lastName: 'Desai',
      sex: PatientSex.FEMALE,
      dob: new Date('1984-06-07'),
      siteId: siteMain.id,
    },
  ];

  for (const p of patients) {
    const demo = CASCADIA_PATIENT_DEMOGRAPHICS[p.id];
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
        where: { id: `seed-cascadia-addr-${p.id}` },
        update: {},
        create: {
          id: `seed-cascadia-addr-${p.id}`,
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
        where: { id: `seed-cascadia-cov-${p.id}` },
        update: {},
        create: {
          id: `seed-cascadia-cov-${p.id}`,
          patientId: p.id,
          carrier: demo.coverage.carrier,
          planName: demo.coverage.planName,
          memberId: demo.coverage.memberId,
          groupId: demo.coverage.groupId,
        },
      });
      await prisma.patientEmergencyContact.upsert({
        where: { id: `seed-cascadia-ec-${p.id}` },
        update: {},
        create: {
          id: `seed-cascadia-ec-${p.id}`,
          patientId: p.id,
          name: demo.emergency.name,
          relationship: demo.emergency.relationship,
          phone: demo.emergency.phone,
        },
      });
    }
  }

  const mdHarper = clinicianRowByEmail['md.harper@cascadia.local']!.orgUserId;
  const ptMorales = clinicianRowByEmail['pt.morales@cascadia.local']!.orgUserId;
  const otFischer = clinicianRowByEmail['ot.fischer@cascadia.local']!.orgUserId;
  const lcswBennett = clinicianRowByEmail['lcsw.bennett@cascadia.local']!.orgUserId;

  // ── Marcus Thompson — 3 episodes (medical + 2 rehab + BH) ──────────────
  const marcusMed = await prisma.episodeOfCare.upsert({
    where: { id: 'seed-cascadia-episode-marcus-medical' },
    update: {},
    create: {
      id: 'seed-cascadia-episode-marcus-medical',
      orgId: org.id,
      patientId: 'seed-cascadia-patient-marcus',
      clinicianOrgUserId: mdHarper,
      departmentId: deptMedical.id,
      division: Division.MEDICAL,
      diagnosis: 'Type 2 diabetes mellitus with stage 3 chronic kidney disease',
      status: EpisodeStatus.ACTIVE,
    },
  });
  await prisma.episodeGoal.upsert({
    where: { id: 'seed-cascadia-goal-marcus-medical' },
    update: {},
    create: {
      id: 'seed-cascadia-goal-marcus-medical',
      episodeId: marcusMed.id,
      goalType: GoalType.LTG,
      goalText: 'Maintain A1c <7.5% and slow CKD progression — preserve eGFR ≥45.',
      baselineMeasure: 'A1c 8.4%, eGFR 52',
      targetMeasure: 'A1c <7.5%, eGFR stable',
      currentMeasure: 'A1c 7.6%, eGFR 51',
      status: GoalStatus.ACTIVE,
    },
  });

  const marcusKnee = await prisma.episodeOfCare.upsert({
    where: { id: 'seed-cascadia-episode-marcus-knee' },
    update: { bodyPart: 'Right knee' },
    create: {
      id: 'seed-cascadia-episode-marcus-knee',
      orgId: org.id,
      patientId: 'seed-cascadia-patient-marcus',
      clinicianOrgUserId: ptMorales,
      departmentId: deptRehab.id,
      division: Division.REHAB,
      diagnosis: 'Right total knee arthroplasty — post-op rehabilitation',
      bodyPart: 'Right knee',
      status: EpisodeStatus.ACTIVE,
    },
  });
  await prisma.episodeGoal.upsert({
    where: { id: 'seed-cascadia-goal-marcus-knee' },
    update: {},
    create: {
      id: 'seed-cascadia-goal-marcus-knee',
      episodeId: marcusKnee.id,
      goalType: GoalType.LTG,
      goalText: 'Restore right knee flexion to 120°, full extension, return to community ambulation without device.',
      baselineMeasure: 'Flexion 78°, ext lag 8°, TUG 18.4 sec',
      targetMeasure: 'Flexion ≥120°, ext 0°, TUG <12 sec',
      currentMeasure: 'Flexion 108°, ext lag 2°, TUG 13.6 sec',
      status: GoalStatus.ACTIVE,
    },
  });

  const marcusShoulder = await prisma.episodeOfCare.upsert({
    where: { id: 'seed-cascadia-episode-marcus-shoulder' },
    update: { bodyPart: 'Right shoulder' },
    create: {
      id: 'seed-cascadia-episode-marcus-shoulder',
      orgId: org.id,
      patientId: 'seed-cascadia-patient-marcus',
      clinicianOrgUserId: ptMorales,
      departmentId: deptRehab.id,
      division: Division.REHAB,
      diagnosis: 'Right subacromial impingement syndrome',
      bodyPart: 'Right shoulder',
      status: EpisodeStatus.ACTIVE,
    },
  });
  await prisma.episodeGoal.upsert({
    where: { id: 'seed-cascadia-goal-marcus-shoulder' },
    update: {},
    create: {
      id: 'seed-cascadia-goal-marcus-shoulder',
      episodeId: marcusShoulder.id,
      goalType: GoalType.LTG,
      goalText: 'Pain-free overhead reach, return to driving and lawn care without shoulder pain.',
      baselineMeasure: 'Flexion 110°, painful arc 70–110°',
      targetMeasure: 'Flexion ≥160°, no painful arc',
      currentMeasure: 'Flexion 145°, mild end-range only',
      status: GoalStatus.ACTIVE,
    },
  });

  await prisma.episodeOfCare.upsert({
    where: { id: 'seed-cascadia-episode-marcus-bh' },
    update: {},
    create: {
      id: 'seed-cascadia-episode-marcus-bh',
      orgId: org.id,
      patientId: 'seed-cascadia-patient-marcus',
      clinicianOrgUserId: lcswBennett,
      departmentId: deptBh.id,
      division: Division.BEHAVIORAL_HEALTH,
      diagnosis: 'Adjustment disorder with depressed mood — coping with chronic illness',
      status: EpisodeStatus.ACTIVE,
    },
  });
  await prisma.episodeGoal.upsert({
    where: { id: 'seed-cascadia-goal-marcus-bh' },
    update: {},
    create: {
      id: 'seed-cascadia-goal-marcus-bh',
      episodeId: 'seed-cascadia-episode-marcus-bh',
      goalType: GoalType.LTG,
      goalText: 'Reduce PHQ-9 below 8, restore engagement in social and rehab activities.',
      baselineMeasure: 'PHQ-9: 13',
      targetMeasure: 'PHQ-9 <8',
      currentMeasure: 'PHQ-9: 9',
      status: GoalStatus.ACTIVE,
    },
  });

  // ── Priya Desai — 3 episodes (medical + 2 rehab + BH) ──────────────────
  const priyaMed = await prisma.episodeOfCare.upsert({
    where: { id: 'seed-cascadia-episode-priya-medical' },
    update: {},
    create: {
      id: 'seed-cascadia-episode-priya-medical',
      orgId: org.id,
      patientId: 'seed-cascadia-patient-priya',
      clinicianOrgUserId: mdHarper,
      departmentId: deptMedical.id,
      division: Division.MEDICAL,
      diagnosis: 'Chronic migraine with aura; perimenopausal symptoms',
      status: EpisodeStatus.ACTIVE,
    },
  });
  await prisma.episodeGoal.upsert({
    where: { id: 'seed-cascadia-goal-priya-medical' },
    update: {},
    create: {
      id: 'seed-cascadia-goal-priya-medical',
      episodeId: priyaMed.id,
      goalType: GoalType.LTG,
      goalText: 'Reduce migraine frequency to ≤4 days/month and MIDAS below 11.',
      baselineMeasure: 'Migraine 12 days/month, MIDAS 26',
      targetMeasure: 'Migraine ≤4 days/month, MIDAS <11',
      currentMeasure: 'Migraine 6 days/month, MIDAS 14',
      status: GoalStatus.ACTIVE,
    },
  });

  const priyaCervical = await prisma.episodeOfCare.upsert({
    where: { id: 'seed-cascadia-episode-priya-cervical' },
    update: { bodyPart: 'Cervical spine' },
    create: {
      id: 'seed-cascadia-episode-priya-cervical',
      orgId: org.id,
      patientId: 'seed-cascadia-patient-priya',
      clinicianOrgUserId: ptMorales,
      departmentId: deptRehab.id,
      division: Division.REHAB,
      diagnosis: 'Cervicogenic headache with upper-cervical hypomobility',
      bodyPart: 'Cervical spine',
      status: EpisodeStatus.ACTIVE,
    },
  });
  await prisma.episodeGoal.upsert({
    where: { id: 'seed-cascadia-goal-priya-cervical' },
    update: {},
    create: {
      id: 'seed-cascadia-goal-priya-cervical',
      episodeId: priyaCervical.id,
      goalType: GoalType.LTG,
      goalText: 'Reduce headache disability index below 20% and restore pain-free desk tolerance ≥2 hours.',
      baselineMeasure: 'HDI 48%, desk tolerance 30 min',
      targetMeasure: 'HDI <20%, desk tolerance ≥2 hours',
      currentMeasure: 'HDI 26%, desk tolerance 90 min',
      status: GoalStatus.ACTIVE,
    },
  });

  const priyaWrist = await prisma.episodeOfCare.upsert({
    where: { id: 'seed-cascadia-episode-priya-wrist' },
    update: { bodyPart: 'Right wrist' },
    create: {
      id: 'seed-cascadia-episode-priya-wrist',
      orgId: org.id,
      patientId: 'seed-cascadia-patient-priya',
      clinicianOrgUserId: otFischer,
      departmentId: deptRehab.id,
      division: Division.REHAB,
      diagnosis: 'Right wrist extensor tendinopathy — repetitive strain',
      bodyPart: 'Right wrist',
      status: EpisodeStatus.ACTIVE,
    },
  });
  await prisma.episodeGoal.upsert({
    where: { id: 'seed-cascadia-goal-priya-wrist' },
    update: {},
    create: {
      id: 'seed-cascadia-goal-priya-wrist',
      episodeId: priyaWrist.id,
      goalType: GoalType.LTG,
      goalText: 'Pain-free typing ≥2 hours and grip strength ≥80% of left side.',
      baselineMeasure: 'Pain 6/10 typing, grip R 22 kg / L 32 kg',
      targetMeasure: 'Pain ≤2/10, grip ≥26 kg',
      currentMeasure: 'Pain 3/10, grip R 26 kg',
      status: GoalStatus.ACTIVE,
    },
  });

  await prisma.episodeOfCare.upsert({
    where: { id: 'seed-cascadia-episode-priya-bh' },
    update: {},
    create: {
      id: 'seed-cascadia-episode-priya-bh',
      orgId: org.id,
      patientId: 'seed-cascadia-patient-priya',
      clinicianOrgUserId: lcswBennett,
      departmentId: deptBh.id,
      division: Division.BEHAVIORAL_HEALTH,
      diagnosis: 'Generalized anxiety disorder with chronic insomnia',
      status: EpisodeStatus.ACTIVE,
    },
  });
  await prisma.episodeGoal.upsert({
    where: { id: 'seed-cascadia-goal-priya-bh' },
    update: {},
    create: {
      id: 'seed-cascadia-goal-priya-bh',
      episodeId: 'seed-cascadia-episode-priya-bh',
      goalType: GoalType.LTG,
      goalText: 'Reduce GAD-7 below 8 and restore sleep onset latency under 30 minutes.',
      baselineMeasure: 'GAD-7: 14, SOL 75 min',
      targetMeasure: 'GAD-7 <8, SOL <30 min',
      currentMeasure: 'GAD-7: 9, SOL 40 min',
      status: GoalStatus.ACTIVE,
    },
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
