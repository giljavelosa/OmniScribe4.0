import type { PriorContextBriefContent } from '../../../src/types/brief';

type BriefInput = {
  patientId: string;
  orgId: string;
  noteId: string;
  episodeId?: string;
  content: Omit<PriorContextBriefContent, 'generatedAt' | 'generatorVersion'>;
};

export const MARCUS_THOMPSON_BRIEF = (noteId: string, orgId: string): BriefInput => ({
  patientId: 'seed-cascadia-patient-marcus',
  orgId,
  noteId,
  episodeId: 'seed-cascadia-episode-marcus-medical',
  content: {
    patientOneLine: '58M, T2DM 12y + CKD 3a + post-TKA 8wk + R shoulder impingement, adjustment d/o',
    episodeContext: {
      episodeId: 'seed-cascadia-episode-marcus-medical',
      label: 'Type 2 diabetes with stage 3 CKD',
      visitNumber: 4,
      plannedVisits: null,
    },
    lastVisit: {
      noteId,
      date: new Date().toISOString().slice(0, 10),
      daysAgo: 9,
      clinicianName: 'Dr. Evelyn Harper',
      noteType: 'Comprehensive review',
      templateName: 'General SOAP Note',
    },
    chiefConcern: 'Comprehensive DM/CKD review post-TKA — adding HCTZ for renal-goal BP, hypoglycemia mitigation on PT days, vitamin D started.',
    priorAssessment:
      'A1c 7.6% (improving), eGFR 51 stable, ACR improving 180→110. PHQ-9 9 (mild). TKA + shoulder PT progressing.',
    trajectory: { summary: 'Glycemic, renal, and rehab measures all trending favorably; mood mild and treated.', direction: 'improving' },
    objectiveMeasures: [
      {
        measure: 'A1c',
        unit: '%',
        lastValue: '7.6',
        priorValues: ['7.8', '8.4'],
        trend: 'improving',
        sourceNoteId: noteId,
        measureKey: null,
      },
      {
        measure: 'eGFR',
        unit: 'mL/min/1.73m2',
        lastValue: '51',
        priorValues: ['48', '50'],
        trend: 'stable',
        sourceNoteId: noteId,
        measureKey: null,
      },
      {
        measure: 'Urine ACR',
        unit: 'mg/g',
        lastValue: '110',
        priorValues: ['180'],
        trend: 'improving',
        sourceNoteId: noteId,
        measureKey: null,
      },
      {
        measure: 'Knee flexion (R)',
        unit: '°',
        lastValue: '108',
        priorValues: ['78'],
        trend: 'improving',
        sourceNoteId: 'seed-cascadia-visit-mt-pt-knee-1',
        measureKey: 'rom-primary',
      },
      {
        measure: 'PHQ-9',
        unit: 'score',
        lastValue: '9',
        priorValues: ['13'],
        trend: 'improving',
        sourceNoteId: 'seed-cascadia-visit-mt-bh-1',
        measureKey: 'phq9-total',
      },
    ],
    interventionsPerformed: [
      'Empagliflozin titration',
      'Renal-protective BP regimen',
      'Post-op rehab coordination',
      'CBT for adjustment disorder',
    ],
    homeProgram:
      'Metformin/empagliflozin/lisinopril/atorvastatin/ASA continued; HCTZ + vitamin D added. PT HEP 4×/day. Activity log + sleep diary.',
    educationGiven: [
      'Hypoglycemia recognition + pre-PT carb plan',
      'Sick-day rules',
      'TKA infection red flags',
      'Renal-protective diet',
    ],
    carryForwardPlan: [
      'BMP + UACR in 6 weeks',
      'Full DM review in 3 months — consider GLP-1 if A1c ≥7.5%',
      'Continue PT both rehab episodes',
      'Continue weekly BH; reassess SSRI need at session 6',
    ],
    topActiveGoals: [
      {
        text: 'A1c <7.5% and slow CKD progression',
        status: 'active',
        delta: 'A1c 7.6%, eGFR 51 stable',
        originNoteId: 'seed-cascadia-episode-marcus-medical',
      },
      {
        text: 'Restore right knee flexion to 120°',
        status: 'active',
        delta: '108°',
        originNoteId: 'seed-cascadia-episode-marcus-knee',
      },
    ],
    watch: {
      recentMedChanges: ['Added HCTZ 12.5 mg', 'Added vitamin D 2000 IU'],
      recentResults: ['A1c 7.6%', 'eGFR 51', 'ACR 110', 'PHQ-9 9'],
      precautions: ['Hypoglycemia on PT days', 'Dehydration on HCTZ + empagliflozin', 'No NSAIDs (CKD)'],
      redFlagsFromPriorNote: ['Glucose <60', 'BP >160/100', 'Knee infection signs', 'Suicidal thoughts'],
    },
    sourceNoteIds: [
      noteId,
      'seed-cascadia-visit-mt-pt-knee-1',
      'seed-cascadia-visit-mt-pt-shoulder-0',
      'seed-cascadia-visit-mt-bh-1',
    ],
    openFollowUps: [
      {
        followUpId: 'seed-cascadia-fu-mt-bmp',
        text: 'Repeat BMP + UACR + BP recheck in 6 weeks (after HCTZ start)',
        status: 'OPEN',
        source: { noteId, date: new Date().toISOString().slice(0, 10) },
      },
      {
        followUpId: 'seed-cascadia-fu-mt-vitd',
        text: 'Repeat 25-OH vitamin D in 3 months',
        status: 'OPEN',
        source: { noteId, date: new Date().toISOString().slice(0, 10) },
      },
    ],
  },
});

export const PRIYA_DESAI_BRIEF = (noteId: string, orgId: string): BriefInput => ({
  patientId: 'seed-cascadia-patient-priya',
  orgId,
  noteId,
  episodeId: 'seed-cascadia-episode-priya-medical',
  content: {
    patientOneLine: '41F, chronic migraine w/ aura escalating + cervicogenic + R wrist tendinopathy + GAD/insomnia',
    episodeContext: {
      episodeId: 'seed-cascadia-episode-priya-medical',
      label: 'Chronic migraine with aura; perimenopausal',
      visitNumber: 1,
      plannedVisits: null,
    },
    lastVisit: {
      noteId,
      date: new Date().toISOString().slice(0, 10),
      daysAgo: 12,
      clinicianName: 'Dr. Evelyn Harper',
      noteType: 'Comprehensive consult',
      templateName: 'General SOAP Note',
    },
    chiefConcern: 'Migraine escalation — preventive (propranolol) + triptan limit + cervical PT + OT + BH coordination.',
    priorAssessment:
      'Chronic-spectrum migraine with MOH component, cervicogenic contribution, perimenopausal trigger, GAD with insomnia.',
    trajectory: { summary: 'Multi-discipline plan in place; cervical and BH measures already improving.', direction: 'improving' },
    objectiveMeasures: [
      {
        measure: 'MIDAS',
        unit: 'score',
        lastValue: '26',
        priorValues: ['18'],
        trend: 'worsening',
        sourceNoteId: noteId,
        measureKey: 'outcome-tool-score',
      },
      {
        measure: 'HDI',
        unit: '%',
        lastValue: '26',
        priorValues: ['48'],
        trend: 'improving',
        sourceNoteId: 'seed-cascadia-visit-pd-pt-cervical-1',
        measureKey: 'outcome-tool-score',
      },
      {
        measure: 'GAD-7',
        unit: 'score',
        lastValue: '9',
        priorValues: ['14'],
        trend: 'improving',
        sourceNoteId: 'seed-cascadia-visit-pd-bh-0',
        measureKey: 'gad7-total',
      },
      {
        measure: 'Grip (R)',
        unit: 'kg',
        lastValue: '26',
        priorValues: ['22'],
        trend: 'improving',
        sourceNoteId: 'seed-cascadia-visit-pd-ot-wrist-0',
        measureKey: null,
      },
    ],
    interventionsPerformed: [
      'Propranolol preventive initiation',
      'Triptan limit + rescue plan',
      'Cervical PT manual + DNF',
      'Wrist OT eccentrics + ergonomics',
      'CBT-I + worry window',
    ],
    homeProgram:
      'Propranolol 60 mg AM, triptan ≤6 days/month, magnesium + riboflavin daily; PT HEP, OT eccentrics + splint, CBT-I sleep diary.',
    educationGiven: [
      'SNOOP4 red flags',
      'Why aura migraine excludes estrogen contraception',
      'Medication overuse headache concept',
      'Ergonomic workstation principles',
    ],
    carryForwardPlan: [
      'PCP follow-up 4 weeks for propranolol titration',
      'Cervical PT 3 more visits then maintenance',
      'OT weekly × 6 weeks',
      'BH weekly × 4 then biweekly',
      'Repeat MIDAS at 12 weeks',
    ],
    topActiveGoals: [
      {
        text: 'Migraine ≤4 days/month + MIDAS <11',
        status: 'active',
        delta: '6 days/month, MIDAS 14',
        originNoteId: 'seed-cascadia-episode-priya-medical',
      },
      {
        text: 'HDI <20% and full work day at desk',
        status: 'active',
        delta: 'HDI 26%, desk 90 min',
        originNoteId: 'seed-cascadia-episode-priya-cervical',
      },
    ],
    watch: {
      recentMedChanges: ['Started propranolol 60 mg', 'Triptan limit 6 days/month'],
      recentResults: ['MIDAS 26 → 14', 'HDI 48% → 26%', 'GAD-7 14 → 9'],
      precautions: ['No estrogen contraception (aura)', 'Watch propranolol exercise tolerance'],
      redFlagsFromPriorNote: ['Thunderclap headache', 'Persistent aura >60 min', 'New neuro deficit'],
    },
    sourceNoteIds: [
      noteId,
      'seed-cascadia-visit-pd-pt-cervical-1',
      'seed-cascadia-visit-pd-ot-wrist-0',
      'seed-cascadia-visit-pd-bh-0',
    ],
    openFollowUps: [
      {
        followUpId: 'seed-cascadia-fu-pd-titrate',
        text: 'Propranolol titration check in 4 weeks',
        status: 'OPEN',
        source: { noteId, date: new Date().toISOString().slice(0, 10) },
      },
      {
        followUpId: 'seed-cascadia-fu-pd-midas',
        text: 'Repeat MIDAS at 12 weeks',
        status: 'OPEN',
        source: { noteId, date: new Date().toISOString().slice(0, 10) },
      },
    ],
  },
});
