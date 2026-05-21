import { Division } from '@prisma/client';
import { handout, timedTranscript, type SeedVisitCorpus } from './helpers';
import { DEVON_MITCHELL_EXTENDED } from './devon-mitchell-extended';

const PID = 'seed-patient-bh';
const EP = 'seed-episode-seed-patient-bh';
const EP_MED = 'seed-episode-dm-medical';

const DEVON_CORE: SeedVisitCorpus[] = [
  {
    noteId: 'seed-visit-dm-bh-0',
    patientId: PID,
    patientFirstName: 'Devon',
    clinicianEmail: 'lcsw.garcia@demo.local',
    division: Division.BEHAVIORAL_HEALTH,
    templateId: 'seed-tmpl-bh-session',
    signedDaysAgo: 42,
    departmentKey: 'bh',
    episodeId: EP,
    sections: [
      {
        id: 'presenting_concern',
        label: 'Presenting Concern',
        content: `BH intake — self-referred. Devon reports 6+ months of excessive worry about work performance, deadlines, and "letting the team down." Sleep 5–6 hrs, difficulty staying asleep ×2–3 awakenings. Muscle tension, occasional GI upset before presentations. No prior BH hospitalizations. No prior therapy >2 sessions college counseling.`,
      },
      {
        id: 'mental_status',
        label: 'Mental Status Exam',
        content: `Appearance: Business casual, groomed. Behavior: Cooperative, foot tapping. Speech: Normal rate, slightly pressured when discussing work. Mood: "Wound up." Affect: Anxious, congruent. Thought process: Linear with occasional rumination loops. Thought content: No SI/HI/AVH. Cognition: A&O ×4. Insight/Judgment: Good.`,
      },
      {
        id: 'risk_assessment',
        label: 'Risk Assessment',
        content: `C-SSRS negative. GAD-7: 16 (severe). PHQ-9: 9 (mild). Denies SI/HI. Crisis resources provided.`,
      },
      {
        id: 'interventions',
        label: 'Interventions',
        content: `Psychoeducation: GAD diagnostic framework, CBT triad. Introduced worry log + diaphragmatic breathing. Collaborative treatment plan — patient prefers therapy-first, open to med eval if no improvement ×8 weeks.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Weekly CBT. Homework: worry log daily ×1 week, breathing 2×/day. Re-GAD-7 visit 4. Consider PCP med eval if GAD-7 ≥10 at visit 8.`,
      },
      {
        id: 'collateral',
        label: 'Collateral / Coordination',
        content: `None today. Employer EAP info provided — patient declined contact.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'What prompted you to reach out now?' },
      { speaker: 'PATIENT', text: 'Anxiety has been building for months. Deadlines feel impossible even when I finish on time.' },
      { speaker: 'CLINICIAN', text: 'Your GAD-7 score today is sixteen — that is in the severe range. We can work on this with weekly therapy.' },
      { speaker: 'PATIENT', text: 'I would rather try therapy before medication if possible.' },
      { speaker: 'CLINICIAN', text: 'Reasonable plan. Start a worry log tonight — write the thought, do not solve it until scheduled worry time.' },
    ],
    handout: handout(
      'Anxiety is treatable with therapy and skills practice. Track worries and practice breathing daily.',
      ['Worry log daily this week', 'Diaphragmatic breathing 5 min twice daily', 'Weekly therapy', 'Call 988 if in crisis'],
      ['Thoughts of suicide', 'Panic that prevents leaving home'],
      ['988 for suicidal thoughts', 'Call our office if worsening'],
    ),
  },

  {
    noteId: 'seed-visit-dm-bh-1',
    patientId: PID,
    patientFirstName: 'Devon',
    clinicianEmail: 'lcsw.garcia@demo.local',
    division: Division.BEHAVIORAL_HEALTH,
    templateId: 'seed-tmpl-bh-session',
    signedDaysAgo: 24,
    departmentKey: 'bh',
    episodeId: EP,
    sections: [
      {
        id: 'presenting_concern',
        label: 'Presenting Concern',
        content: `Session 3. Anxiety peaks with project deadlines; using deep breathing in meetings with partial benefit. Sleep still 5–6 hrs — worry log shows rumination 11pm–1am most nights.`,
      },
      {
        id: 'mental_status',
        label: 'Mental Status Exam',
        content: `Appearance: Well-groomed. Behavior: Restless legs, cooperative. Mood: "Anxious." Affect: Anxious, congruent. Speech: Normal. Thought process: Linear. No SI/HI. Cognition: Alert.`,
      },
      {
        id: 'risk_assessment',
        label: 'Risk Assessment',
        content: `GAD-7: 14 (moderate, down from 16). PHQ-9: 8. No SI/HI. Crisis line reviewed.`,
      },
      {
        id: 'interventions',
        label: 'Interventions',
        content: `CBT: worry-postponement, cognitive restructuring of probability estimates. Discussed combined treatment — patient agreeable to PCP med eval referral.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Weekly CBT. Homework: worry log + breathing. Refer to PCP for SSRI evaluation. GAD-7 in 4 weeks.`,
      },
      {
        id: 'collateral',
        label: 'Collateral / Coordination',
        content: `Referral letter to PCP drafted with ROI.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'What has been most difficult about anxiety this week?' },
      { speaker: 'PATIENT', text: 'Deadlines — mind races and I cannot sleep.' },
      { speaker: 'CLINICIAN', text: 'GAD-7 improved slightly but still moderate. Would you talk with your doctor about medication alongside therapy?' },
      { speaker: 'PATIENT', text: 'Yes — I think I need both.' },
    ],
    handout: handout(
      'Therapy plus medication can work together. Keep practicing breathing and follow up with your doctor.',
      ['Continue worry log', 'Breathing twice daily', 'Schedule PCP visit', 'Weekly therapy'],
      ['Suicidal thoughts', 'Severe panic'],
      ['988 if crisis', 'Call if anxiety escalates'],
    ),
    referralLetter: {
      recipient: 'Dr. Clinician Demo, Demo Clinic Family Medicine',
      subject: 'Referral for medication evaluation — Generalized Anxiety Disorder',
      body: `Dear Dr. Demo,

I am writing to request pharmacotherapy evaluation for Devon Mitchell (DOB 11/02/1995), whom I am treating for Generalized Anxiety Disorder.

Devon presents with moderate anxiety (GAD-7: 14, down from 16 at intake) with prominent occupational worry and sleep disturbance (5–6 hours/night, middle insomnia). Mental status exam reassuring — no suicidal or homicidal ideation, thought process linear, insight good.

We have initiated weekly CBT including worry-postponement and cognitive restructuring. Devon is agreeable to combined pharmacotherapy and psychotherapy.

Please evaluate for SSRI or appropriate anxiolytic therapy. I am available to coordinate. Devon plans to schedule within two weeks.

Thank you,
Carlos Garcia, LCSW
Demo Clinic Behavioral Health`,
    },
  },

  {
    noteId: 'seed-visit-dm-psy-1',
    patientId: PID,
    patientFirstName: 'Devon',
    clinicianEmail: 'psy.patel@demo.local',
    division: Division.BEHAVIORAL_HEALTH,
    templateId: 'seed-tmpl-bh-session',
    signedDaysAgo: 17,
    departmentKey: 'bh',
    episodeId: EP,
    sections: [
      {
        id: 'presenting_concern',
        label: 'Presenting Concern',
        content: `Psychodiagnostic follow-up — MMPI-2-RF results review. Devon completed testing last week. Seeks understanding of profile and implications for treatment.`,
      },
      {
        id: 'mental_status',
        label: 'Mental Status Exam',
        content: `Appearance: Casual, appropriate. Behavior: Cooperative. Mood: "Curious, a little nervous." Affect: Mildly anxious, congruent. Thought process: Linear. No SI/HI.`,
      },
      {
        id: 'risk_assessment',
        label: 'Risk Assessment',
        content: `No acute risk. Testing valid — no inconsistent responding flagged.`,
      },
      {
        id: 'interventions',
        label: 'Interventions',
        content: `Feedback: elevated RC/ANX scales, perfectionism indicators, no psychosis spectrum elevation. Psychoeducation trait vs state anxiety. Scheduled Liebowitz Social Anxiety Scale to rule out comorbid social anxiety.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Co-treat with LCSW. Quarterly psych re-eval. Liebowitz in 1 week.`,
      },
      {
        id: 'collateral',
        label: 'Collateral / Coordination',
        content: `Summary shared with LCSW per ROI.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'Today we review your testing profile and answer questions.' },
      { speaker: 'PATIENT', text: 'I was afraid it would show something scary.' },
      { speaker: 'CLINICIAN', text: 'It shows elevated anxiety and high self-standards — consistent with what you report in therapy, not a surprise diagnosis.' },
      { speaker: 'PATIENT', text: 'What about social anxiety? Meetings are the worst.' },
      { speaker: 'CLINICIAN', text: 'We will run a social anxiety scale next week to clarify.' },
    ],
    handout: handout(
      'Testing shows anxiety and perfectionism — not unexpected. Continue therapy; complete social anxiety questionnaire next visit.',
      ['Continue weekly CBT', 'Liebowitz questionnaire next week', 'Quarterly psychology check-in'],
      ['Distress after reviewing results'],
      ['Call if overwhelmed between visits'],
    ),
  },

  {
    noteId: 'seed-visit-dm-md-1',
    patientId: PID,
    patientFirstName: 'Devon',
    clinicianEmail: 'clinician@demo.local',
    division: Division.MEDICAL,
    templateId: 'seed-tmpl-medical-soap',
    signedDaysAgo: 9,
    departmentKey: 'medical',
    episodeId: EP_MED,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `Med eval per BH referral. Persistent GAD with sleep disruption despite 5 CBT sessions. No prior SSRI/SNRI trials. Denies SI/HI, mania hx, bipolar sx. Caffeine 2 cups coffee/day — willing to reduce after noon.

PMH: None significant. PSH: None. Meds: None Rx. Allergies: NKDA.`,
      },
      {
        id: 'objective',
        label: 'Objective',
        content: `Vitals: BP 118/76, HR 82, BMI 24.1. General: NAD, mildly anxious.
Labs: TSH 2.1, CMP wnl, CBC wnl.
Screeners: PHQ-9 6 (mild), GAD-7 13 (moderate).`,
      },
      {
        id: 'assessment',
        label: 'Assessment',
        content: `GAD — co-managed with BH. Medically cleared for SSRI trial. No contraindications.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Start sertraline 25 mg ×7 days → 50 mg daily. Black box warning reviewed. F/u 4 weeks. Continue CBT. ER precautions for serotonin syndrome, suicidal ideation.`,
      },
    ],
    transcript: timedTranscript(
      [
        { speaker: 'CLINICIAN', text: 'Your therapist sent a referral — tell me how anxiety has been.' },
        { speaker: 'PATIENT', text: 'Therapy helps but nights are still rough. I am open to trying medication.' },
        { speaker: 'CLINICIAN', text: 'Walk me through sleep — hours, awakenings, racing thoughts.' },
        { speaker: 'PATIENT', text: 'Five to six hours. Wake at two AM and replay tomorrow\'s tasks.' },
        { speaker: 'CLINICIAN', text: 'Any prior antidepressants or benzodiazepines?' },
        { speaker: 'PATIENT', text: 'Never. My mom takes escitalopram for anxiety.' },
        { speaker: 'CLINICIAN', text: 'Family history noted. We will start sertraline — similar class, good evidence for GAD.' },
        { speaker: 'CLINICIAN', text: 'Labs today — thyroid, liver, blood count — all normal.' },
        { speaker: 'PATIENT', text: 'What side effects are common?' },
        { speaker: 'CLINICIAN', text: 'Nausea, sleep changes — often temporary. Call if mood worsens or suicidal thoughts emerge.' },
        { speaker: 'CLINICIAN', text: 'Black box warning — rare increase in suicidal thinking in young adults first weeks. Report immediately.' },
        { speaker: 'PATIENT', text: 'I have a therapist weekly — will they coordinate?' },
        { speaker: 'CLINICIAN', text: 'Yes — with your permission I will update Carlos Garcia.' },
        { speaker: 'PATIENT', text: 'How long until it works?' },
        { speaker: 'CLINICIAN', text: 'Two to four weeks for full effect. Low dose first week then fifty milligrams daily.' },
        { speaker: 'CLINICIAN', text: 'Avoid alcohol initially. Continue caffeine cutoff by noon if you can.' },
        { speaker: 'PATIENT', text: 'Headaches are better with PT starting too.' },
        { speaker: 'CLINICIAN', text: 'Good — combined approach. Follow up four weeks.' },
      ],
      33,
    ),
    handout: handout(
      'Starting sertraline for anxiety. Low dose first week, then increase. Takes 2–4 weeks for full effect.',
      ['Sertraline 25 mg daily ×7 days', 'Then 50 mg daily ongoing', 'Continue therapy', 'Follow up 4 weeks'],
      ['Rash', 'Suicidal thoughts', 'Severe agitation', 'Serotonin syndrome symptoms'],
      ['Any suicidal thoughts — call immediately', 'Severe side effects'],
    ),
  },

  {
    noteId: 'seed-visit-dm-bh-2',
    patientId: PID,
    patientFirstName: 'Devon',
    clinicianEmail: 'lcsw.garcia@demo.local',
    division: Division.BEHAVIORAL_HEALTH,
    templateId: 'seed-tmpl-bh-session',
    signedDaysAgo: 10,
    departmentKey: 'bh',
    episodeId: EP,
    sections: [
      {
        id: 'presenting_concern',
        label: 'Presenting Concern',
        content: `Session 6. Started sertraline 4 days ago — mild nausea, tolerable. Sleep still fragmented but using stimulus control. Work presentation completed without panic — used breathing + prepared cognitive reframe.`,
      },
      {
        id: 'mental_status',
        label: 'Mental Status Exam',
        content: `Appearance: Groomed. Behavior: Less psychomotor agitation. Mood: "Hopeful but tired." Affect: Anxious-mild, congruent. No SI/HI.`,
      },
      {
        id: 'risk_assessment',
        label: 'Risk Assessment',
        content: `GAD-7: 11 (moderate, trending down). No SI/HI.`,
      },
      {
        id: 'interventions',
        label: 'Interventions',
        content: `Reviewed presentation success — behavioral experiment validating catastrophic predictions false. Exposure hierarchy for meetings — next step: speak once in stand-up.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Continue CBT weekly. Homework: exposure goal + sleep log. GAD-7 visit 8.`,
      },
      {
        id: 'collateral',
        label: 'Collateral / Coordination',
        content: `Aware of sertraline start — supportive. Will share GAD-7 with PCP at med f/u.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'You gave the presentation — what happened with anxiety?' },
      { speaker: 'PATIENT', text: 'I was nervous but did not panic. Breathing helped.' },
      { speaker: 'CLINICIAN', text: 'That is evidence against the "I will fall apart" prediction. Next step — one comment in stand-up.' },
    ],
    handout: handout(
      'You handled the presentation — anxiety can come down with practice. Try one small speaking goal this week.',
      ['One comment in team stand-up', 'Breathing before meetings', 'Sleep log nightly', 'Continue sertraline as prescribed'],
      ['Worsening mood on new medication'],
      ['Suicidal thoughts — call 988'],
    ),
  },

  {
    noteId: 'seed-visit-dm-md-2',
    patientId: PID,
    patientFirstName: 'Devon',
    clinicianEmail: 'clinician@demo.local',
    division: Division.MEDICAL,
    templateId: 'seed-tmpl-medical-soap',
    signedDaysAgo: 2,
    departmentKey: 'medical',
    episodeId: EP_MED,
    sections: [
      {
        id: 'subjective',
        label: 'Subjective',
        content: `4-week sertraline follow-up. On 50 mg ×3 weeks. Initial nausea resolved. Sleep improved to 6–7 hrs. Anxiety "more manageable" — GAD-7 self-report ~10. No sexual side effects reported. Continues weekly CBT.`,
      },
      {
        id: 'objective',
        label: 'Objective',
        content: `Vitals: BP 116/74, HR 76. General: NAD, less anxious appearance.
GAD-7 today: 9 (mild). PHQ-9: 5.`,
      },
      {
        id: 'assessment',
        label: 'Assessment',
        content: `GAD — improving on sertraline 50 mg + CBT. Good tolerability.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Continue sertraline 50 mg. F/u 3 months or sooner if regression. Maintain CBT. Repeat GAD-7 at next visit.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'Three weeks on fifty milligrams — how are you doing?' },
      { speaker: 'PATIENT', text: 'Much better. Nausea gone. I am sleeping more and panic is rare.' },
      { speaker: 'CLINICIAN', text: 'GAD-7 is nine today — mild range. Stay the course on dose and therapy.' },
    ],
    handout: handout(
      'Sertraline is working well. Stay on 50 mg daily and continue therapy.',
      ['Sertraline 50 mg daily — continue', 'Keep therapy appointments', 'Follow up in 3 months'],
      ['Worsening anxiety or mood', 'Suicidal thoughts'],
      ['988 if crisis', 'Call for concerning side effects'],
    ),
  },

  {
    noteId: 'seed-visit-dm-bh-3',
    patientId: PID,
    patientFirstName: 'Devon',
    clinicianEmail: 'lcsw.garcia@demo.local',
    division: Division.BEHAVIORAL_HEALTH,
    templateId: 'seed-tmpl-bh-session',
    signedDaysAgo: 3,
    departmentKey: 'bh',
    episodeId: EP,
    sections: [
      {
        id: 'presenting_concern',
        label: 'Presenting Concern',
        content: `Session 8. Combined treatment effect noted — sertraline + CBT. Spoke in stand-up twice this week with manageable anxiety (4/10 peak). Sleep 7 hrs most nights. Liebowitz score mild social anxiety — does not meet SAD threshold; GAD remains primary focus.`,
      },
      {
        id: 'mental_status',
        label: 'Mental Status Exam',
        content: `Appearance: Well-groomed. Behavior: Calm, cooperative. Mood: "Better than I have felt in a year." Affect: Euthymic-anxious mild, congruent. Thought process: Linear. No SI/HI.`,
      },
      {
        id: 'risk_assessment',
        label: 'Risk Assessment',
        content: `GAD-7: 8 (mild, down from 16 intake). PHQ-9: 4. No SI/HI.`,
      },
      {
        id: 'interventions',
        label: 'Interventions',
        content: `Consolidated gains — relapse prevention planning introduced. Identified early warning signs: sleep <6 hrs ×3 nights, avoidance of meetings. Coping card created.`,
      },
      {
        id: 'plan',
        label: 'Plan',
        content: `Transition to biweekly CBT ×4 sessions then monthly maintenance. Homework: coping card review weekly. GAD-7 monthly.`,
      },
      {
        id: 'collateral',
        label: 'Collateral / Coordination',
        content: `Update sent to PCP — GAD-7 improvement with combined treatment.`,
      },
    ],
    transcript: [
      { speaker: 'CLINICIAN', text: 'Your GAD-7 is eight today — down from sixteen at intake.' },
      { speaker: 'PATIENT', text: 'Medication plus therapy finally feels like it is clicking.' },
      { speaker: 'CLINICIAN', text: 'Let us build a relapse prevention plan — what are your early warning signs?' },
      { speaker: 'PATIENT', text: 'Less sleep and avoiding speaking in meetings.' },
      { speaker: 'CLINICIAN', text: 'Good awareness. We will move to every-other-week sessions and review the coping card.' },
    ],
    handout: handout(
      'You have made strong progress. Watch sleep and avoidance as early signs. Use your coping card when stress rises.',
      ['Review coping card weekly', 'Biweekly therapy for now', 'Continue sertraline as prescribed', 'Speak up in meetings — keep practicing'],
      ['Return of severe insomnia', 'Avoiding work entirely', 'Suicidal thoughts'],
      ['988 if crisis', 'Call if early warning signs persist >1 week'],
    ),
  },
];

export const DEVON_MITCHELL_VISITS: SeedVisitCorpus[] = [
  ...DEVON_CORE,
  ...DEVON_MITCHELL_EXTENDED,
];
