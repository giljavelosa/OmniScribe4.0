import type { PriorContextBriefContent } from '../../src/types/brief';

type BriefInput = {
  patientId: string;
  orgId: string;
  noteId: string;
  episodeId?: string;
  content: Omit<PriorContextBriefContent, 'generatedAt' | 'generatorVersion'>;
};

export const RACHEL_KIM_ACME_BRIEF = (noteId: string, orgId: string): BriefInput => ({
  patientId: 'seed-acme-patient',
  orgId,
  noteId,
  episodeId: 'seed-acme-episode-medical',
  content: {
    patientOneLine: '46F, T2DM — A1c 7.1% on metformin + semaglutide, 18 lb weight loss',
    episodeContext: {
      episodeId: 'seed-acme-episode-medical',
      label: 'Type 2 diabetes mellitus',
      visitNumber: 3,
      plannedVisits: null,
    },
    lastVisit: {
      noteId,
      date: new Date().toISOString().slice(0, 10),
      daysAgo: 14,
      clinicianName: 'Dr. Maya Chen',
      noteType: 'Follow-up',
      templateName: 'General SOAP Note',
    },
    chiefConcern: 'Diabetes follow-up — A1c at goal on dual therapy.',
    priorAssessment: 'T2DM controlled A1c 7.1%. Weight loss 18 lb. Tolerating semaglutide.',
    trajectory: { summary: 'Steady glycemic improvement since diagnosis.', direction: 'improving' },
    objectiveMeasures: [
      {
        measure: 'A1c',
        unit: '%',
        lastValue: '7.1',
        priorValues: ['8.2'],
        trend: 'improving',
        sourceNoteId: noteId,
        measureKey: null,
      },
      {
        measure: 'Fasting glucose',
        unit: 'mg/dL',
        lastValue: '118',
        priorValues: ['128', '186'],
        trend: 'improving',
        sourceNoteId: noteId,
        measureKey: null,
      },
      {
        measure: 'Weight',
        unit: 'lb',
        lastValue: '160',
        priorValues: ['178'],
        trend: 'improving',
        sourceNoteId: noteId,
        measureKey: 'weight',
      },
    ],
    interventionsPerformed: ['Metformin titration', 'Semaglutide initiation', 'Diabetes education'],
    homeProgram: 'Metformin 1000 mg BID, semaglutide 0.5 mg weekly, fasting glucose log, walking.',
    educationGiven: ['Hypoglycemia precautions', 'GLP-1 injection technique'],
    carryForwardPlan: ['Increase semaglutide per schedule', 'A1c + lipids in 3 months', 'Annual eye exam'],
    topActiveGoals: [
      {
        text: 'A1c <7.5%',
        status: 'met',
        delta: '7.1%',
        originNoteId: 'seed-acme-episode-medical',
      },
    ],
    watch: {
      recentMedChanges: ['Added semaglutide', 'Metformin 1000 mg BID'],
      recentResults: ['A1c 7.1%'],
      precautions: ['Pancreatitis symptoms on GLP-1'],
      redFlagsFromPriorNote: ['Persistent vomiting', 'BG >400'],
    },
    sourceNoteIds: [noteId, 'seed-acme-visit-rk-md-1', 'seed-acme-visit-rk-md-0'],
    openFollowUps: [
      {
        followUpId: 'seed-acme-fu-rk-a1c',
        text: 'Repeat A1c and lipids in 3 months',
        status: 'OPEN',
        source: { noteId, date: new Date().toISOString().slice(0, 10) },
      },
    ],
  },
});

export const ROBERT_HAYES_ACME_BRIEF = (noteId: string, orgId: string): BriefInput => ({
  patientId: 'seed-acme-patient-rehab',
  orgId,
  noteId,
  episodeId: 'seed-acme-episode-rehab',
  content: {
    patientOneLine: '62M, chronic LBP — Oswestry 18%, returning to gardening',
    episodeContext: {
      episodeId: 'seed-acme-episode-rehab',
      label: 'Mechanical low back pain',
      visitNumber: 8,
      plannedVisits: 10,
    },
    lastVisit: {
      noteId,
      date: new Date().toISOString().slice(0, 10),
      daysAgo: 10,
      clinicianName: 'Dr. Linh Nguyen',
      noteType: 'PT Daily',
      templateName: 'PT/OT Daily Note',
    },
    chiefConcern: 'Low back pain — functional gardening trial successful, near discharge.',
    priorAssessment: 'Mechanical LBP extension-responsive. Oswestry met goal.',
    trajectory: { summary: 'Disability scores and pain trending down.', direction: 'improving' },
    objectiveMeasures: [
      {
        measure: 'Oswestry',
        unit: '%',
        lastValue: '18',
        priorValues: ['28', '38'],
        trend: 'improving',
        sourceNoteId: noteId,
        measureKey: 'outcome-tool-score',
      },
      {
        measure: 'Pain NRS',
        unit: '/10',
        lastValue: '3',
        priorValues: ['4', '6'],
        trend: 'improving',
        sourceNoteId: noteId,
        measureKey: 'pain-nrs',
      },
    ],
    interventionsPerformed: ['McKenzie extension protocol', 'Core stabilization', 'Functional lift training'],
    homeProgram: 'Press-ups, bird-dog, walking, gardening pacing with breaks.',
    educationGiven: ['Lumbar roll for sitting', 'Flare management plan'],
    carryForwardPlan: ['2 final PT visits', 'Discharge to maintenance HEP'],
    topActiveGoals: [
      {
        text: 'Oswestry <20%',
        status: 'met',
        delta: '18%',
        originNoteId: 'seed-acme-episode-rehab',
      },
    ],
    watch: {
      recentMedChanges: [],
      recentResults: [],
      precautions: ['Avoid prolonged flexion loading'],
      redFlagsFromPriorNote: ['Cauda equina symptoms'],
    },
    sourceNoteIds: [noteId, 'seed-acme-visit-rh-pt-1'],
    openFollowUps: [
      {
        followUpId: 'seed-acme-fu-rh-dc',
        text: 'PT discharge after 2 remaining visits',
        status: 'OPEN',
        source: { noteId, date: new Date().toISOString().slice(0, 10) },
      },
    ],
  },
});

export const ELENA_SANTOS_ACME_BRIEF = (noteId: string, orgId: string): BriefInput => ({
  patientId: 'seed-acme-patient-bh',
  orgId,
  noteId,
  episodeId: 'seed-acme-episode-bh',
  content: {
    patientOneLine: '34F, MDD post-divorce — PHQ-9 9, escitalopram + CBT improving',
    episodeContext: {
      episodeId: 'seed-acme-episode-bh',
      label: 'Major depressive disorder',
      visitNumber: 6,
      plannedVisits: 12,
    },
    lastVisit: {
      noteId,
      date: new Date().toISOString().slice(0, 10),
      daysAgo: 5,
      clinicianName: 'Jordan Taylor',
      noteType: 'BH Session',
      templateName: 'Behavioral Health Session Note',
    },
    chiefConcern: 'Depression recovery — transitioning to biweekly therapy, relapse prevention.',
    priorAssessment: 'MDD improving PHQ-9 18→9. No current SI.',
    trajectory: { summary: 'Steady mood improvement with combined treatment.', direction: 'improving' },
    objectiveMeasures: [
      {
        measure: 'PHQ-9',
        unit: 'score',
        lastValue: '9',
        priorValues: ['11', '14', '18'],
        trend: 'improving',
        sourceNoteId: noteId,
        measureKey: 'phq9-total',
      },
    ],
    interventionsPerformed: ['Behavioral activation', 'Safety planning', 'Relapse prevention'],
    homeProgram: 'Activity log, yoga weekly, escitalopram 10 mg daily.',
    educationGiven: ['SSRI adherence', 'Early warning signs', '988 crisis resources'],
    carryForwardPlan: ['Biweekly CBT ×4', 'Continue escitalopram', 'PHQ-9 monthly'],
    topActiveGoals: [
      {
        text: 'PHQ-9 <10',
        status: 'met',
        delta: 'PHQ-9 = 9',
        originNoteId: 'seed-acme-episode-bh',
      },
    ],
    watch: {
      recentMedChanges: ['Escitalopram 10 mg started 6 weeks ago'],
      recentResults: ['PHQ-9 9'],
      precautions: ['Monitor for SI if mood worsens'],
      redFlagsFromPriorNote: ['Passive SI at intake — resolved'],
    },
    sourceNoteIds: [noteId, 'seed-acme-visit-es-bh-1', 'seed-acme-visit-es-bh-0'],
    openFollowUps: [
      {
        followUpId: 'seed-acme-fu-es-pcp',
        text: 'PCP medication follow-up in 8 weeks',
        status: 'OPEN',
        source: { noteId: 'seed-acme-visit-es-md-1', date: new Date().toISOString().slice(0, 10) },
      },
    ],
  },
});
