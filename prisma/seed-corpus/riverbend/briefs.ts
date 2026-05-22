import type { PriorContextBriefContent } from '../../../src/types/brief';

type BriefInput = {
  patientId: string;
  orgId: string;
  noteId: string;
  episodeId?: string;
  content: Omit<PriorContextBriefContent, 'generatedAt' | 'generatorVersion'>;
};

export const JAMAL_CARTER_BRIEF = (noteId: string, orgId: string): BriefInput => ({
  patientId: 'seed-riverbend-patient-jamal',
  orgId,
  noteId,
  episodeId: 'seed-riverbend-episode-jamal-medical',
  content: {
    patientOneLine: '35M, HIV undetectable 4y, post-ankle ORIF wk8, plantar fasciitis, MDD partial remission',
    episodeContext: {
      episodeId: 'seed-riverbend-episode-jamal-medical',
      label: 'HIV-1 maintenance — undetectable on Biktarvy',
      visitNumber: 4,
      plannedVisits: null,
    },
    lastVisit: {
      noteId,
      date: new Date().toISOString().slice(0, 10),
      daysAgo: 7,
      clinicianName: 'Dr. Camille Boucher',
      noteType: 'Quarterly maintenance',
      templateName: 'General SOAP Note',
    },
    chiefConcern: 'Quarterly HIV maintenance with integrated rehab + BH + sexual-health review.',
    priorAssessment:
      'HIV undetectable × 4 years, CD4 658, mood stable on sertraline + maintenance therapy. Ankle and plantar PT progressing. BP creeping up — monitoring.',
    trajectory: { summary: 'All chronic conditions stable or improving.', direction: 'improving' },
    objectiveMeasures: [
      {
        measure: 'CD4',
        unit: 'cells/uL',
        lastValue: '658',
        priorValues: ['612'],
        trend: 'improving',
        sourceNoteId: noteId,
        measureKey: null,
      },
      {
        measure: 'Ankle DF (L)',
        unit: '°',
        lastValue: '14',
        priorValues: ['5'],
        trend: 'improving',
        sourceNoteId: 'seed-riverbend-visit-jc-pt-ankle-1',
        measureKey: 'rom-primary',
      },
      {
        measure: 'PHQ-9',
        unit: 'score',
        lastValue: '4',
        priorValues: ['16'],
        trend: 'improving',
        sourceNoteId: 'seed-riverbend-visit-jc-bh-0',
        measureKey: 'phq9-total',
      },
      {
        measure: 'BP avg',
        unit: 'mmHg',
        lastValue: '134/86',
        priorValues: ['128/80'],
        trend: 'worsening',
        sourceNoteId: noteId,
        measureKey: 'bp',
      },
    ],
    interventionsPerformed: [
      'ART maintenance + adherence reinforcement',
      'Post-op ankle rehab',
      'Plantar fasciitis eccentric loading',
      'Maintenance psychotherapy + sobriety support',
    ],
    homeProgram:
      'Biktarvy daily, sertraline 100 mg, BP log 2×/day for 3 weeks, PT HEP, plantar eccentrics, recovery community weekly.',
    educationGiven: [
      'U=U education for partner',
      'DASH diet for new BP elevation',
      'STI screening intervals on serodiscordant relationship',
      'Sobriety relapse prevention',
    ],
    carryForwardPlan: [
      'BP recheck 4 weeks',
      'HIV labs in 6 months',
      'STI screen in 3 months',
      'Continue PT + maintenance therapy',
    ],
    topActiveGoals: [
      {
        text: 'Maintain HIV undetectable + CD4 >500',
        status: 'met',
        delta: 'CD4 658 undetectable',
        originNoteId: 'seed-riverbend-episode-jamal-medical',
      },
      {
        text: 'Return to soccer post-ORIF',
        status: 'active',
        delta: 'Ankle DF 14°, single-leg balance 22 sec',
        originNoteId: 'seed-riverbend-episode-jamal-ankle',
      },
    ],
    watch: {
      recentMedChanges: [],
      recentResults: ['CD4 658', 'HIV RNA undetectable', 'STI panel negative'],
      precautions: ['BP trending up — monitor', 'Avoid heavy NSAIDs', 'Sobriety vigilance'],
      redFlagsFromPriorNote: ['New oral lesions or thrush', 'Mood drop with SI', 'Substance cravings'],
    },
    sourceNoteIds: [
      noteId,
      'seed-riverbend-visit-jc-pt-ankle-1',
      'seed-riverbend-visit-jc-pt-plantar-0',
      'seed-riverbend-visit-jc-bh-0',
    ],
    openFollowUps: [
      {
        followUpId: 'seed-riverbend-fu-jc-bp',
        text: 'BP recheck with PA Rivera in 4 weeks; start lisinopril if avg ≥130/80',
        status: 'OPEN',
        source: { noteId, date: new Date().toISOString().slice(0, 10) },
      },
      {
        followUpId: 'seed-riverbend-fu-jc-sti',
        text: 'STI screen in 3 months',
        status: 'OPEN',
        source: { noteId, date: new Date().toISOString().slice(0, 10) },
      },
    ],
  },
});

export const LINDA_FOSTER_BRIEF = (noteId: string, orgId: string): BriefInput => ({
  patientId: 'seed-riverbend-patient-linda',
  orgId,
  noteId,
  episodeId: 'seed-riverbend-episode-linda-medical',
  content: {
    patientOneLine: '70F, HFrEF EF35% (improved), 10wk post-hip ORIF, MCI on donepezil, AFib on apixaban',
    episodeContext: {
      episodeId: 'seed-riverbend-episode-linda-medical',
      label: 'HFrEF on quadruple therapy',
      visitNumber: 5,
      plannedVisits: null,
    },
    lastVisit: {
      noteId,
      date: new Date().toISOString().slice(0, 10),
      daysAgo: 5,
      clinicianName: 'Dr. Camille Boucher',
      noteType: 'Comprehensive review',
      templateName: 'General SOAP Note',
    },
    chiefConcern: 'HFrEF + post-hip + cognition integrated review — adding DEXA, planning ASA discontinuation, donepezil up-titration coordination.',
    priorAssessment:
      'HFrEF improved EF 30→35% on GDMT, NT-proBNP 1840→720. Post-hip rehab progressing. MoCA 24→25 on donepezil.',
    trajectory: { summary: 'Cardiac, mobility, and cognitive measures all trending favorably.', direction: 'improving' },
    objectiveMeasures: [
      {
        measure: 'LVEF',
        unit: '%',
        lastValue: '35',
        priorValues: ['30'],
        trend: 'improving',
        sourceNoteId: noteId,
        measureKey: null,
      },
      {
        measure: 'NT-proBNP',
        unit: 'pg/mL',
        lastValue: '720',
        priorValues: ['1840'],
        trend: 'improving',
        sourceNoteId: noteId,
        measureKey: null,
      },
      {
        measure: 'BBS',
        unit: 'score',
        lastValue: '42',
        priorValues: ['28'],
        trend: 'improving',
        sourceNoteId: 'seed-riverbend-visit-lf-pt-balance-0',
        measureKey: 'outcome-tool-score',
      },
      {
        measure: 'TUG',
        unit: 'sec',
        lastValue: '18.6',
        priorValues: ['30.2'],
        trend: 'improving',
        sourceNoteId: 'seed-riverbend-visit-lf-pt-balance-0',
        measureKey: 'gait-speed',
      },
      {
        measure: 'MoCA',
        unit: 'score',
        lastValue: '25',
        priorValues: ['24'],
        trend: 'improving',
        sourceNoteId: 'seed-riverbend-visit-lf-bh-cognitive-0',
        measureKey: null,
      },
    ],
    interventionsPerformed: [
      'GDMT titration',
      'Post-hip ORIF rehab',
      'Balance + gait training',
      'Donepezil + cognitive therapy',
    ],
    homeProgram:
      'Quadruple HF therapy + apixaban + ASA + atorvastatin + donepezil + Ca/D. Daily weights, low Na diet, PT HEP, name-recall practice.',
    educationGiven: [
      'Daily weights, sodium label reading',
      'Furosemide PRN use',
      'Bleeding red flags',
      'Donepezil GI side effects',
      'Fall prevention checklist',
    ],
    carryForwardPlan: [
      'NT-proBNP + BMP in 8 weeks',
      'Discontinue ASA at 8-week visit if stable',
      'Donepezil titrate to 10 mg in 4 weeks if tolerated',
      'DEXA scan ordered — review next visit',
      'Continue PT both rehab episodes',
    ],
    topActiveGoals: [
      {
        text: 'Maintain GDMT, EF ≥35%, no HF hospitalization',
        status: 'active',
        delta: 'EF 35%, BNP 720, NYHA II',
        originNoteId: 'seed-riverbend-episode-linda-medical',
      },
      {
        text: 'Independent rolling-walker community ambulation',
        status: 'active',
        delta: 'BBS 42, gait speed 0.55 m/s',
        originNoteId: 'seed-riverbend-episode-linda-hip',
      },
    ],
    watch: {
      recentMedChanges: ['Donepezil 5 mg started 6 wks ago', 'Plan to drop ASA in 8 weeks'],
      recentResults: ['NT-proBNP 720', 'EF 35%', 'MoCA 25', 'BBS 42'],
      precautions: ['High fall risk', 'Bleeding risk on apixaban + ASA combo (mitigation pending)', 'Capacity preserved but track'],
      redFlagsFromPriorNote: ['Weight gain >2 lb/day', 'Syncope', 'Bleeding', 'New confusion'],
    },
    sourceNoteIds: [
      noteId,
      'seed-riverbend-visit-lf-pt-hip-0',
      'seed-riverbend-visit-lf-pt-balance-0',
      'seed-riverbend-visit-lf-bh-cognitive-0',
    ],
    openFollowUps: [
      {
        followUpId: 'seed-riverbend-fu-lf-asa',
        text: 'Reassess ASA discontinuation at 8-week follow-up',
        status: 'OPEN',
        source: { noteId, date: new Date().toISOString().slice(0, 10) },
      },
      {
        followUpId: 'seed-riverbend-fu-lf-dexa',
        text: 'DEXA scan ordered — review at next medical visit',
        status: 'OPEN',
        source: { noteId, date: new Date().toISOString().slice(0, 10) },
      },
    ],
  },
});
