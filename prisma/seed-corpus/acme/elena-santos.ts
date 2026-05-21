import { Division } from '@prisma/client';
import { handout, timedTranscript, type SeedVisitCorpus } from '../helpers';
import { ACME_ORG_ID, ACME_SITE_MAIN } from './rachel-kim';

const PID = 'seed-acme-patient-bh';
const EP = 'seed-acme-episode-bh';

/** Elena Santos — major depressive disorder, Acme BH program. */
export const ELENA_SANTOS_VISITS: SeedVisitCorpus[] = [
  {
    noteId: 'seed-acme-visit-es-bh-0',
    orgId: ACME_ORG_ID,
    siteId: ACME_SITE_MAIN,
    patientId: PID,
    patientFirstName: 'Elena',
    clinicianEmail: 'lcsw.taylor@acme.local',
    division: Division.BEHAVIORAL_HEALTH,
    templateId: 'seed-tmpl-bh-session',
    signedDaysAgo: 35,
    departmentKey: 'bh',
    episodeId: EP,
    sections: [
      {
        id: 'presenting_concern',
        label: 'Presenting Concern',
        content: `BH intake — 34F referred by PCP after PHQ-9 score 18 at wellness visit. Reports 3-month depressive episode following divorce — anhedonia, low motivation, crying spells 3–4×/week, hypersomnia weekends, poor concentration at work (software QA). Denies prior psychiatric hospitalization.`,
      },
      {
        id: 'mental_status',
        label: 'Mental Status Exam',
        content: `Appearance: Casually dressed, good hygiene. Behavior: Psychomotor slowing mild, cooperative. Speech: Soft volume, normal rate. Mood: "Empty." Affect: Constricted, congruent. Thought process: Linear. Thought content: Passive death wish ("wish I would not wake up") — denies plan/intent/means. No HI/AVH. Cognition: A&O ×4. Insight/Judgment: Fair.`,
      },
      {
        id: 'risk_assessment',
        label: 'Risk Assessment',
        content: `PHQ-9: 18 (moderately severe). C-SSRS: passive ideation without intent — moderate risk category. Safety plan completed with crisis line, removing means (firearms stored at brother's), identified supports (sister Maria). Contract for safety — patient agrees to call before acting.`,
      },
      {
        id: 'interventions',
        label: 'Interventions',
        content: `Psychoeducation on MDD. Behavioral activation scheduling — one social + one mastery activity daily minimum. Introduced activity monitoring log. Supportive counseling re: grief/divorce adjustment.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Weekly therapy ×12 weeks. Homework: activity log, PHQ-9 weekly. Coordinate with PCP re: SSRI — referral placed today. Re-assess risk each session.`,
      },
      {
        id: 'collateral',
        label: 'Collateral / Coordination',
        content: `ROI signed for PCP coordination. Sister aware of safety plan — with patient consent.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'Elena, tell me what the last few months have been like.' },
      { speaker: 'PATIENT', text: 'Since the divorce I barely want to get out of bed on weekends. Work is a fog.' },
      { speaker: 'CLINICIAN', text: 'Have you had thoughts of hurting yourself?' },
      { speaker: 'PATIENT', text: 'Sometimes I wish I would not wake up — but I would not do anything.' },
      { speaker: 'CLINICIAN', text: 'Thank you for being honest. We will build a safety plan today and start weekly therapy.' },
    ],
    handout: handout(
      'Depression is treatable. Complete your activity log daily. Use your safety plan if thoughts worsen.',
      ['Activity log — one social + one mastery task daily', 'Weekly therapy', 'Call 988 if safety plan needed', 'Follow up with doctor about medication'],
      ['Thoughts of suicide with a plan', 'Unable to care for self'],
      ['988 immediately if intent to harm self', 'Call therapist between sessions if worse'],
    ),
  },
  {
    noteId: 'seed-acme-visit-es-bh-1',
    orgId: ACME_ORG_ID,
    siteId: ACME_SITE_MAIN,
    patientId: PID,
    patientFirstName: 'Elena',
    clinicianEmail: 'lcsw.taylor@acme.local',
    division: Division.BEHAVIORAL_HEALTH,
    templateId: 'seed-tmpl-bh-session',
    signedDaysAgo: 21,
    departmentKey: 'bh',
    episodeId: EP,
    sections: [
      {
        id: 'presenting_concern',
        label: 'Presenting Concern',
        content: `Session 3. Started escitalopram 10 mg (PCP) 2 weeks ago — mild nausea resolving. Activity log shows 4/7 days compliance. Mood "slightly less heavy." Still struggles with morning motivation.`,
      },
      {
        id: 'mental_status',
        label: 'Mental Status Exam',
        content: `Mood: "Low but hopeful." Affect: Constricted, slightly brighter than intake. No SI/HI today. PHQ-9: 14 (moderate, down from 18).`,
      },
      {
        id: 'risk_assessment',
        label: 'Risk Assessment',
        content: `Denies SI/HI. Safety plan reviewed — still valid.`,
      },
      {
        id: 'interventions',
        label: 'Interventions',
        content: `CBT behavioral activation — graded task assignment (morning walk 10 min ×5 days). Cognitive work on divorce-related guilt cognitions.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Continue weekly CBT. PHQ-9 visit 6. PCP f/u 4 weeks for SSRI.`,
      },
      {
        id: 'collateral',
        label: 'Collateral / Coordination',
        content: `Update sent to PCP — PHQ-9 improving.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'PHQ-9 down four points — what activities helped this week?' },
      { speaker: 'PATIENT', text: 'Coffee with my sister twice. I skipped the walk most days though.' },
      { speaker: 'CLINICIAN', text: 'Let us shrink the walk goal — ten minutes, five days, non-negotiable minimum.' },
    ],
    handout: handout(
      'Keep taking escitalopram. Walk ten minutes five days this week. Log activities daily.',
      ['Morning walk 10 min ×5 days', 'Continue medication as prescribed', 'Activity log daily', 'Weekly therapy'],
      ['Worsening suicidal thoughts', 'New mania — decreased need for sleep + racing thoughts'],
      ['988 if crisis', 'Call if mood suddenly worsens on SSRI'],
    ),
  },
  {
    noteId: 'seed-acme-visit-es-md-1',
    orgId: ACME_ORG_ID,
    siteId: ACME_SITE_MAIN,
    patientId: PID,
    patientFirstName: 'Elena',
    clinicianEmail: 'clinician@acme.local',
    division: Division.MEDICAL,
    templateId: 'seed-tmpl-medical-soap',
    signedDaysAgo: 12,
    departmentKey: 'medical',
    episodeId: 'seed-acme-episode-es-medical',
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `PCP follow-up — MDD co-managed with Acme BH. On escitalopram 10 mg ×4 weeks. Nausea resolved. Sleep improved to 7 hrs. PHQ-9 today 11 (down from 18). Denies SI. Engaged in therapy.`,
      },
      {
        id: 'objective',
        label: 'Objective',
        content: `Vitals: BP 118/72, HR 68. General: NAD, brighter affect than prior visit.
PHQ-9: 11. GAD-7: 6.`,
      },
      {
        id: 'assessment',
        label: 'Assessment',
        content: `MDD — moderate, improving on escitalopram 10 mg + psychotherapy.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Continue escitalopram 10 mg. F/u 8 weeks. Continue BH weekly. Return sooner for worsening mood or SI.`,
      },
    ],
    transcript: timedTranscript(
      [
        { speaker: 'CLINICIAN', text: 'Therapy and medication together — how are you feeling compared to two months ago?' },
        { speaker: 'PATIENT', text: 'Not great but better. I am showing up to work and seeing my sister more.' },
        { speaker: 'CLINICIAN', text: 'PHQ-9 is eleven today — down from eighteen at intake. Sleep hours?' },
        { speaker: 'PATIENT', text: 'About seven on weeknights now. Weekends still long but not all day in bed.' },
        { speaker: 'CLINICIAN', text: 'Escitalopram ten milligrams — any side effects?' },
        { speaker: 'PATIENT', text: 'Nausea gone after week two. No sexual side effects I notice.' },
        { speaker: 'CLINICIAN', text: 'Stay the course on ten milligrams for now. Continue weekly then biweekly therapy.' },
        { speaker: 'PATIENT', text: 'Wine intake is down to twice a week.' },
        { speaker: 'CLINICIAN', text: 'That helps mood stability. Keep yoga if it is working.' },
        { speaker: 'CLINICIAN', text: 'Any suicidal thoughts since last visit?' },
        { speaker: 'PATIENT', text: 'No — bad days pass faster.' },
        { speaker: 'CLINICIAN', text: 'Follow up eight weeks. Call sooner if mood drops or SI returns.' },
      ],
      32,
    ),
    handout: handout(
      'Depression is improving. Continue escitalopram 10 mg and therapy.',
      ['Escitalopram 10 mg daily', 'Weekly therapy', 'Follow up in 8 weeks'],
      ['Suicidal thoughts', 'Serotonin syndrome symptoms'],
      ['988 if crisis'],
    ),
  },
  {
    noteId: 'seed-acme-visit-es-bh-2',
    orgId: ACME_ORG_ID,
    siteId: ACME_SITE_MAIN,
    patientId: PID,
    patientFirstName: 'Elena',
    clinicianEmail: 'lcsw.taylor@acme.local',
    division: Division.BEHAVIORAL_HEALTH,
    templateId: 'seed-tmpl-bh-session',
    signedDaysAgo: 5,
    departmentKey: 'bh',
    episodeId: EP,
    sections: [
      {
        id: 'presenting_concern',
        label: 'Presenting Concern',
        content: `Session 6. PHQ-9: 9 (mild). Returned to yoga class 1×/week. Work concentration improved — completed sprint on time. Passive death wishes absent ×3 weeks.`,
      },
      {
        id: 'mental_status',
        label: 'Mental Status Exam',
        content: `Mood: "More like myself." Affect: Full range, euthymic moments. No SI/HI.`,
      },
      {
        id: 'risk_assessment',
        label: 'Risk Assessment',
        content: `Low acute risk. Safety plan remains on file.`,
      },
      {
        id: 'interventions',
        label: 'Interventions',
        content: `Relapse prevention: identified early warnings (social withdrawal, skipping walks). Consolidated cognitive strategies for guilt.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Biweekly CBT ×4 then monthly. PHQ-9 monthly.`,
      },
      {
        id: 'collateral',
        label: 'Collateral / Coordination',
        content: `Shared progress summary with PCP.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'PHQ-9 is nine — mild range. You made it through a work sprint.' },
      { speaker: 'PATIENT', text: 'Yoga helped. I still have bad days but they pass faster.' },
      { speaker: 'CLINICIAN', text: 'We will space sessions to every other week and focus on staying well.' },
    ],
    handout: handout(
      'You are recovering from depression. Watch for early warning signs and keep up activities that help.',
      ['Yoga or walk weekly minimum', 'Biweekly therapy for now', 'Continue escitalopram', 'Use safety plan if thoughts return'],
      ['Return of suicidal thoughts', 'Social isolation for a week'],
      ['988 if crisis'],
    ),
  },
];
