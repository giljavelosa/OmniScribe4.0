import type { PriorContextBriefContent } from '../src/types/brief';

type BriefInput = {
  patientId: string;
  orgId: string;
  noteId: string;
  episodeId?: string;
  content: Omit<PriorContextBriefContent, 'generatedAt' | 'generatorVersion'>;
};

export function buildPatientBrief(input: BriefInput): PriorContextBriefContent {
  return {
    ...input.content,
    generatedAt: new Date().toISOString(),
    generatorVersion: 'seed-v1',
  };
}

export const JAMES_PARK_BRIEF = (noteId: string, orgId: string): BriefInput => ({
  patientId: 'seed-patient-medical',
  orgId,
  noteId,
  episodeId: 'seed-episode-seed-patient-medical',
  content: {
    patientOneLine: '54M, essential HTN + rotator cuff strain + work stress, multimodal care active',
    episodeContext: {
      episodeId: 'seed-episode-seed-patient-medical',
      label: 'Essential hypertension',
      visitNumber: 3,
      plannedVisits: null,
    },
    lastVisit: {
      noteId,
      date: new Date().toISOString().slice(0, 10),
      daysAgo: 5,
      clinicianName: 'Dr. Maya Brown',
      noteType: 'Follow-up',
      templateName: 'General SOAP Note',
    },
    chiefConcern: 'Blood pressure follow-up — now at goal on lisinopril 20 mg; headaches improved.',
    priorAssessment:
      'HTN at goal (avg home 128/82). Rotator cuff strain improving with PT (flexion 140°). BH GAD-7 down 12→8.',
    trajectory: { summary: 'BP controlled, shoulder ROM improving, anxiety moderating.', direction: 'improving' },
    objectiveMeasures: [
      {
        measure: 'Blood pressure',
        unit: 'mmHg',
        lastValue: '128/80',
        priorValues: ['148/92', '156/94'],
        trend: 'improving',
        sourceNoteId: noteId,
        measureKey: 'bp',
      },
      {
        measure: 'Shoulder flexion',
        unit: '°',
        lastValue: '140',
        priorValues: ['120', '115'],
        trend: 'improving',
        sourceNoteId: 'seed-visit-jp-pt-1',
        measureKey: 'rom-primary',
      },
      {
        measure: 'GAD-7',
        unit: 'score',
        lastValue: '8',
        priorValues: ['12'],
        trend: 'improving',
        sourceNoteId: 'seed-visit-jp-bh-1',
        measureKey: 'gad7-total',
      },
    ],
    interventionsPerformed: ['Lisinopril titration', 'PT shoulder strengthening', 'CBT cognitive restructuring'],
    homeProgram: 'Lisinopril 20 mg AM, rosuvastatin 10 mg PM, BP log 2×/week, PT HEP daily, thought record 3×/week.',
    educationGiven: ['DASH diet', 'Headache red flags', 'Statin muscle pain precautions'],
    carryForwardPlan: [
      'Continue lisinopril 20 mg + rosuvastatin 10 mg',
      'PT 2×/week shoulder — progress ER band',
      'BH weekly CBT',
      'BMP + lipids in 3 months',
    ],
    topActiveGoals: [
      {
        text: 'Reduce average BP to <130/80',
        status: 'met',
        delta: 'at goal',
        originNoteId: 'seed-episode-seed-patient-medical',
      },
      {
        text: 'Pain-free overhead reach',
        status: 'active',
        delta: '140° flexion',
        originNoteId: 'seed-visit-jp-pt-0',
      },
    ],
    watch: {
      recentMedChanges: ['Lisinopril 10→20 mg', 'Started rosuvastatin 10 mg'],
      recentResults: ['LDL 142 — statin started', 'Cr 0.9 on ACE-I'],
      precautions: ['Avoid heavy overhead lifting — shoulder'],
      redFlagsFromPriorNote: ['Sudden severe headache', 'Vision changes'],
    },
    sourceNoteIds: [noteId, 'seed-visit-jp-md-1', 'seed-visit-jp-pt-1', 'seed-visit-jp-bh-1'],
    openFollowUps: [
      {
        followUpId: 'seed-fu-jp-lipids',
        text: 'Repeat BMP + lipids in 3 months',
        status: 'OPEN',
        source: { noteId, date: new Date().toISOString().slice(0, 10) },
      },
    ],
  },
});

export const MARIA_ALVAREZ_BRIEF = (noteId: string, orgId: string): BriefInput => ({
  patientId: 'seed-patient-rehab',
  orgId,
  noteId,
  episodeId: 'seed-episode-seed-patient-rehab',
  content: {
    patientOneLine: '67F, R knee s/p arthroscopy week 6, PT+OT — nearing cane discharge',
    episodeContext: {
      episodeId: 'seed-episode-seed-patient-rehab',
      label: 'Right knee OA s/p arthroscopy',
      visitNumber: 11,
      plannedVisits: 16,
    },
    lastVisit: {
      noteId,
      date: new Date().toISOString().slice(0, 10),
      daysAgo: 6,
      clinicianName: 'Dr. Sara Smith',
      noteType: 'PT Daily',
      templateName: 'PT/OT Daily Note',
    },
    chiefConcern: 'Right knee post-op rehab — flexion 118°, TUG 12.1 sec, trialing cane-free indoors.',
    priorAssessment: 'Uncomplicated surgical recovery. ROM + strength progressing. IADL improving with OT.',
    trajectory: { summary: 'Steady functional gains — gait, ROM, kitchen tolerance.', direction: 'improving' },
    objectiveMeasures: [
      {
        measure: 'Knee flexion',
        unit: '°',
        lastValue: '118',
        priorValues: ['105', '85'],
        trend: 'improving',
        sourceNoteId: noteId,
        measureKey: 'rom-primary',
      },
      {
        measure: 'TUG',
        unit: 'sec',
        lastValue: '12.1',
        priorValues: ['14.2', '22'],
        trend: 'improving',
        sourceNoteId: noteId,
        measureKey: 'gait-speed',
      },
      {
        measure: 'Pain NRS',
        unit: '/10',
        lastValue: '3',
        priorValues: ['4', '7'],
        trend: 'improving',
        sourceNoteId: noteId,
        measureKey: 'pain-nrs',
      },
    ],
    interventionsPerformed: ['Closed-chain strengthening', 'Gait training', 'OT kitchen adaptation'],
    homeProgram: 'TKE, step-ups, heel slides, perching stool for meal prep.',
    educationGiven: ['Infection red flags post-op', 'Joint protection', 'Energy conservation'],
    carryForwardPlan: ['PT 2×/week × 3 visits', 'Trial outdoor ambulation without cane', 'OT discharge at IADL ≥21/24'],
    topActiveGoals: [
      {
        text: 'Restore right-knee flexion to 120°',
        status: 'active',
        delta: '118°',
        originNoteId: 'seed-episode-seed-patient-rehab',
      },
    ],
    watch: {
      recentMedChanges: [],
      recentResults: ['6-week post-op exam — wound healed'],
      precautions: ['Use cane on stairs until PT clears'],
      redFlagsFromPriorNote: ['Fever', 'Calf swelling', 'Wound drainage'],
    },
    sourceNoteIds: [noteId, 'seed-visit-ma-pt-1', 'seed-visit-ma-md-1'],
    openFollowUps: [
      {
        followUpId: 'seed-fu-ma-ortho',
        text: 'Ortho follow-up week 8 post-op',
        status: 'OPEN',
        source: { noteId: 'seed-visit-ma-md-1', date: new Date().toISOString().slice(0, 10) },
      },
    ],
  },
});

export const DEVON_MITCHELL_BRIEF = (noteId: string, orgId: string): BriefInput => ({
  patientId: 'seed-patient-bh',
  orgId,
  noteId,
  episodeId: 'seed-episode-seed-patient-bh',
  content: {
    patientOneLine: '30yo, GAD — sertraline 50 mg + CBT, GAD-7 improved 16→8',
    episodeContext: {
      episodeId: 'seed-episode-seed-patient-bh',
      label: 'Generalized anxiety disorder',
      visitNumber: 8,
      plannedVisits: 12,
    },
    lastVisit: {
      noteId,
      date: new Date().toISOString().slice(0, 10),
      daysAgo: 3,
      clinicianName: 'Carlos Garcia',
      noteType: 'BH Session',
      templateName: 'Behavioral Health Session Note',
    },
    chiefConcern: 'GAD — combined treatment working; transitioning to biweekly CBT + relapse prevention.',
    priorAssessment: 'GAD-7 8 (mild). Sertraline tolerated. Exposure goals met (stand-up participation).',
    trajectory: { summary: 'Marked anxiety reduction with combined pharmacotherapy + CBT.', direction: 'improving' },
    objectiveMeasures: [
      {
        measure: 'GAD-7',
        unit: 'score',
        lastValue: '8',
        priorValues: ['11', '14', '16'],
        trend: 'improving',
        sourceNoteId: noteId,
        measureKey: 'gad7-total',
      },
      {
        measure: 'PHQ-9',
        unit: 'score',
        lastValue: '4',
        priorValues: ['6', '9'],
        trend: 'improving',
        sourceNoteId: noteId,
        measureKey: 'phq9-total',
      },
    ],
    interventionsPerformed: ['CBT cognitive restructuring', 'Exposure hierarchy', 'Relapse prevention planning'],
    homeProgram: 'Coping card review weekly, sleep hygiene, sertraline 50 mg daily.',
    educationGiven: ['SSRI onset timeline', 'Relapse early warning signs', '988 crisis resources'],
    carryForwardPlan: ['Biweekly CBT ×4 then monthly', 'Continue sertraline 50 mg', 'PCP f/u 3 months'],
    topActiveGoals: [
      {
        text: 'Reduce GAD-7 from 14 to <8',
        status: 'met',
        delta: 'GAD-7 = 8',
        originNoteId: 'seed-episode-seed-patient-bh',
      },
    ],
    watch: {
      recentMedChanges: ['Sertraline 25→50 mg'],
      recentResults: ['TSH/CMP wnl at med start'],
      precautions: ['Monitor for mood worsening on SSRI'],
      redFlagsFromPriorNote: ['Suicidal ideation', 'Serotonin syndrome symptoms'],
    },
    sourceNoteIds: [noteId, 'seed-visit-dm-md-2', 'seed-visit-dm-bh-1'],
    openFollowUps: [
      {
        followUpId: 'seed-fu-dm-pcp',
        text: 'PCP medication follow-up in 3 months',
        status: 'OPEN',
        source: { noteId: 'seed-visit-dm-md-2', date: new Date().toISOString().slice(0, 10) },
      },
    ],
  },
});
