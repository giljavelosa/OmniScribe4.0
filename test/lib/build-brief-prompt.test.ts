import { describe, it, expect } from 'vitest';
import { PatientSex } from '@prisma/client';

import {
  BRIEF_SYSTEM_PROMPT,
  FOLLOWUP_EXTRACTOR_SYSTEM_PROMPT,
  buildBriefUserMessage,
  buildFollowupExtractorUserMessage,
  projectPatientForBrief,
  projectEpisodeForBrief,
  projectSignedNoteForBrief,
  type BuildBriefPromptInput,
} from '@/lib/notes/build-brief-prompt';
import {
  BriefLLMOutputSchema,
  FollowupExtractionSchema,
  PriorContextBriefContentSchema,
} from '@/types/brief';

const patient = projectPatientForBrief({
  id: 'pat_test',
  orgId: 'org_test',
  siteId: null,
  division: 'MEDICAL',
  firstName: 'Maria',
  lastName: 'Alvarez',
  mrn: 'MRN-001',
  dob: new Date('1958-04-12'),
  sex: PatientSex.FEMALE,
  phone: null,
  email: null,
  preferredLanguage: 'English',
  isDeleted: false,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const episode = projectEpisodeForBrief({
  id: 'epi_test',
  orgId: 'org_test',
  patientId: 'pat_test',
  clinicianOrgUserId: 'ou_test',
  departmentId: 'dept_test',
  division: 'REHAB',
  diagnosis: 'R shoulder pain',
  bodyPart: 'shoulder',
  status: 'ACTIVE',
  startedAt: new Date(),
  endedAt: null,
  recertDueAt: null,
  visitsAuthorized: 6,
  visitsCompleted: 4,
});

const buildPriorNote = (id: string, dateIso: string, content: string) =>
  projectSignedNoteForBrief(
    {
      id,
      orgId: 'org_test',
      patientId: 'pat_test',
      encounterId: null,
      clinicianOrgUserId: 'ou_test',
      division: 'REHAB',
      status: 'SIGNED',
      captureMode: 'LIVE',
      audioFileKey: null,
      transcriptRaw: null,
      transcriptClean: null,
      inferenceLog: null,
      interruptedAt: null,
      lastWorkerError: null,
      draftJson: null,
      finalJson: {
        sections: [
          { id: 'subjective', label: 'Subjective', required: true, content: 'Pain 4/10, less than last visit.' },
          { id: 'plan', label: 'Plan', required: true, content },
        ],
        signedAt: dateIso,
        schemaVersion: 1,
      },
      templateId: null,
      templateVersion: null,
      noteStyle: 'HYBRID',
      sensitivityLevel: 'STANDARD_CLINICAL',
      signedAt: new Date(dateIso),
      signedByUserId: 'usr_test',
      backfilledAt: null,
      backfillReason: null,
      createdAt: new Date(dateIso),
      updatedAt: new Date(dateIso),
      template: { name: 'PT Progress Note' },
    },
    'Dr. Smith',
  );

describe('BRIEF_SYSTEM_PROMPT', () => {
  it('bakes in the three absolute rules in order', () => {
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/SOURCE-GROUNDED ONLY/);
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/VERBATIM WHERE PRECISION MATTERS/);
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/NO CLINICAL CONCLUSIONS BEYOND THE NOTES/);
  });

  it('forbids inferring or extrapolating beyond source notes', () => {
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/Never infer, extrapolate/);
  });

  it('requires verbatim carryForwardPlan items', () => {
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/carryForwardPlan.*MUST be quoted directly/s);
  });

  it('includes the measure-key registry block (Phase 13b)', () => {
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/MEASURE-KEY REGISTRY/);
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/pain-nrs/);
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/rom-primary/);
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/phq9-total/);
  });

  it('requires JSON-only output without markdown fences', () => {
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/OUTPUT IS JSON ONLY/);
  });
});

describe('buildBriefUserMessage', () => {
  it('renders the patient identity block with display-name (first + last initial only)', () => {
    const input: BuildBriefPromptInput = {
      division: 'REHAB',
      todayIso: '2026-05-17',
      patient,
      episode,
      priorNotes: [buildPriorNote('note_a', '2026-05-10T14:00:00.000Z', 'Recheck pain VAS next visit.')],
      topActiveGoals: [],
    };
    const user = buildBriefUserMessage(input);
    expect(user).toContain('displayName: Maria A.');
    expect(user).not.toContain('Alvarez');
    expect(user).not.toContain('1958-04-12');
    expect(user).not.toContain('phone');
  });

  it('renders 1, 2, or 3 prior notes oldest-first via the same template', () => {
    const input: BuildBriefPromptInput = {
      division: 'REHAB',
      todayIso: '2026-05-17',
      patient,
      episode,
      priorNotes: [
        buildPriorNote('note_old', '2026-04-15T14:00:00.000Z', 'Continue HEP. Recheck ROM in 2 weeks.'),
        buildPriorNote('note_new', '2026-05-10T14:00:00.000Z', 'Progress band rows to red.'),
      ],
      topActiveGoals: [],
    };
    const user = buildBriefUserMessage(input);
    expect(user).toMatch(/<prior_notes count="2">/);
    const idxOld = user.indexOf('id="note_old"');
    const idxNew = user.indexOf('id="note_new"');
    expect(idxOld).toBeGreaterThan(0);
    expect(idxNew).toBeGreaterThan(idxOld);
  });

  it('emits null when no episode is provided', () => {
    const user = buildBriefUserMessage({
      division: 'MEDICAL',
      todayIso: '2026-05-17',
      patient,
      episode: null,
      priorNotes: [buildPriorNote('note_only', '2026-05-10T14:00:00.000Z', '')],
      topActiveGoals: [],
    });
    expect(user).toMatch(/<episode_context>\n\s+null\n<\/episode_context>/);
  });

  it('handles zero prior notes (first visit) gracefully without faking content', () => {
    const user = buildBriefUserMessage({
      division: 'MEDICAL',
      todayIso: '2026-05-17',
      patient,
      episode: null,
      priorNotes: [],
      topActiveGoals: [],
    });
    expect(user).toMatch(/<prior_notes count="0">/);
    expect(user).toMatch(/first visit on record/i);
  });
});

describe('FOLLOWUP_EXTRACTOR_SYSTEM_PROMPT', () => {
  it('forbids inventing follow-ups + skips done-this-visit items', () => {
    expect(FOLLOWUP_EXTRACTOR_SYSTEM_PROMPT).toMatch(/SOURCE-GROUNDED ONLY/);
    expect(FOLLOWUP_EXTRACTOR_SYSTEM_PROMPT).toMatch(/SKIP items that describe THIS visit/);
    expect(FOLLOWUP_EXTRACTOR_SYSTEM_PROMPT).toMatch(/SKIP HEP/);
  });

  it('asks for strict JSON object with items array', () => {
    expect(FOLLOWUP_EXTRACTOR_SYSTEM_PROMPT).toMatch(/"items":/);
    expect(FOLLOWUP_EXTRACTOR_SYSTEM_PROMPT).toMatch(/JSON only/);
  });
});

describe('buildFollowupExtractorUserMessage', () => {
  it('renders the note id + signed-at + plan section verbatim', () => {
    const user = buildFollowupExtractorUserMessage({
      noteId: 'note_xyz',
      signedAtIso: '2026-05-17T15:00:00Z',
      planSectionContent: 'Trial NSAID — ask if started. Recheck pain VAS next visit.',
    });
    expect(user).toContain('Note id: note_xyz');
    expect(user).toContain('2026-05-17T15:00:00Z');
    expect(user).toContain('Trial NSAID — ask if started.');
  });

  it('notes empty plan sections explicitly rather than dropping them', () => {
    const user = buildFollowupExtractorUserMessage({
      noteId: 'note_a',
      signedAtIso: '2026-05-17T15:00:00Z',
      planSectionContent: '',
    });
    expect(user).toContain('plan section was empty');
  });
});

describe('BriefLLMOutputSchema + PriorContextBriefContentSchema', () => {
  const sample = {
    patientOneLine: '67F, R shoulder pain post fall, week 4 of 6',
    episodeContext: { episodeId: 'epi_test', label: 'R shoulder pain', visitNumber: 4, plannedVisits: 6 },
    lastVisit: {
      noteId: 'note_new',
      date: '2026-05-10',
      daysAgo: 7,
      clinicianName: 'Dr. Smith',
      noteType: 'Progress Note',
      templateName: 'PT Progress Note',
    },
    chiefConcern: 'R shoulder pain post fall on outstretched hand.',
    priorAssessment: 'Improving — pain trending down, AROM gains in flexion.',
    trajectory: { summary: 'Pain down, AROM up.', direction: 'improving' as const },
    objectiveMeasures: [
      {
        measure: 'Pain VAS',
        unit: '/10',
        lastValue: '4',
        priorValues: ['5', '7'],
        trend: 'improving' as const,
        sourceNoteId: 'note_new',
        measureKey: 'pain-nrs',
      },
    ],
    interventionsPerformed: ['Manual GH mob grade III'],
    homeProgram: 'Band rows 3×10, prone Y/T/W.',
    educationGiven: ['Sleep posture'],
    carryForwardPlan: ['Progress band rows to red', 'Recheck scap dyskinesis'],
    topActiveGoals: [
      { text: 'AROM flex to 150°', status: 'active' as const, delta: 'on track', originNoteId: 'note_old' },
    ],
    watch: {
      recentMedChanges: [],
      recentResults: [],
      precautions: [],
      redFlagsFromPriorNote: [],
    },
    sourceNoteIds: ['note_old', 'note_new'],
  };

  it('accepts a well-formed LLM output', () => {
    expect(() => BriefLLMOutputSchema.parse(sample)).not.toThrow();
  });

  it('rejects an output missing required lastVisit fields', () => {
    expect(() =>
      BriefLLMOutputSchema.parse({ ...sample, lastVisit: { ...sample.lastVisit, noteId: '' } }),
    ).toThrow();
  });

  it('caps topActiveGoals at 3 entries', () => {
    expect(() =>
      BriefLLMOutputSchema.parse({
        ...sample,
        topActiveGoals: [1, 2, 3, 4].map((i) => ({
          text: `goal ${i}`,
          status: 'active',
          delta: null,
          originNoteId: 'note_old',
        })),
      }),
    ).toThrow();
  });

  it('extends to PriorContextBriefContent with metadata + openFollowUps', () => {
    expect(() =>
      PriorContextBriefContentSchema.parse({
        ...sample,
        generatedAt: new Date().toISOString(),
        generatorVersion: 'llm-v1',
        openFollowUps: [
          {
            followUpId: 'fu_001',
            text: 'Trial NSAID — ask if started',
            status: 'OPEN',
            source: { noteId: 'note_old', date: '2026-04-22' },
          },
        ],
      }),
    ).not.toThrow();
  });
});

describe('FollowupExtractionSchema', () => {
  it('accepts an empty items list (no future-facing commitments)', () => {
    expect(() => FollowupExtractionSchema.parse({ items: [] })).not.toThrow();
  });

  it('rejects items shorter than 3 chars or longer than 280', () => {
    expect(() => FollowupExtractionSchema.parse({ items: [{ text: 'ok' }] })).toThrow();
    expect(() =>
      FollowupExtractionSchema.parse({ items: [{ text: 'x'.repeat(281) }] }),
    ).toThrow();
  });

  it('caps the list at 20 items', () => {
    expect(() =>
      FollowupExtractionSchema.parse({
        items: Array.from({ length: 21 }, () => ({ text: 'recheck BP at next visit' })),
      }),
    ).toThrow();
  });
});

describe('projectSignedNoteForBrief', () => {
  it('refuses an unsigned note (rule 20)', () => {
    expect(() =>
      projectSignedNoteForBrief(
        // @ts-expect-error — deliberately wrong status
        { id: 'n', status: 'DRAFT', signedAt: null, finalJson: null },
        'Dr. X',
      ),
    ).toThrow(/not signed/i);
  });
});
