import { describe, it, expect } from 'vitest';
import { PatientSex } from '@prisma/client';

import {
  BRIEF_SYSTEM_PROMPT,
  buildBriefUserMessage,
  projectPatientForBrief,
  projectSignedNoteForBrief,
  type BriefExternalContextProjection,
  type BuildBriefPromptInput,
} from '@/lib/notes/build-brief-prompt';

const patient = projectPatientForBrief({
  id: 'pat_ec',
  orgId: 'org_test',
  siteId: null,
  firstName: 'River',
  lastName: 'Chen',
  mrn: 'MRN-EC-1',
  dob: new Date('1972-08-04'),
  sex: PatientSex.MALE,
  phone: null,
  email: null,
  preferredLanguage: 'English',
  isDeleted: false,
  deletedAt: null,
  createdAt: new Date('2025-01-15'),
  updatedAt: new Date('2025-01-15'),
});

const signedNote = projectSignedNoteForBrief(
  {
    id: 'note_signed_1',
    orgId: 'org_test',
    patientId: 'pat_ec',
    encounterId: null,
    clinicianOrgUserId: 'ou_test',
    division: 'REHAB',
    status: 'SIGNED',
    captureMode: 'LIVE',
    audioFileKey: null,
    transcriptRaw: null,
    transcriptClean: null,
    inferenceLog: null,
    finalJson: {
      sections: [
        { id: 'plan', label: 'Plan', content: 'Recheck shoulder ROM next visit.' },
      ],
    } as unknown as object,
    draftJson: null,
    templateId: null,
    templateVersion: null,
    noteStyle: 'HYBRID',
    sensitivityLevel: null,
    signedAt: new Date('2026-05-01T14:00:00Z'),
    signedByUserId: 'u_test',
    interruptedAt: null,
    lastWorkerError: null,
    createdAt: new Date('2026-05-01T13:00:00Z'),
    updatedAt: new Date('2026-05-01T14:00:00Z'),
    template: { name: 'Rehab SOAP' },
  } as unknown as Parameters<typeof projectSignedNoteForBrief>[0],
  'Attending Clinician',
);

function input(
  externalContexts: BriefExternalContextProjection[],
): BuildBriefPromptInput {
  return {
    division: 'REHAB',
    todayIso: '2026-05-18T08:00:00Z',
    patient,
    episode: null,
    priorNotes: [signedNote],
    topActiveGoals: [],
    externalContexts,
  };
}

describe('buildBriefUserMessage — external context block', () => {
  it('emits an empty marker when no external context is provided', () => {
    const rendered = buildBriefUserMessage(input([]));
    expect(rendered).toContain('<external_context>');
    expect(rendered).toMatch(/no external context on file/);
    expect(rendered).toContain('</external_context>');
  });

  it('renders provided records with date, source, label, and transcript', () => {
    const rendered = buildBriefUserMessage(
      input([
        {
          externalContextId: 'ec_1',
          dateOfRecordIso: '2026-04-12T00:00:00Z',
          source: 'OUTSIDE_PROVIDER',
          sourceLabel: 'Dr. Smith referral letter',
          addedByName: 'Dr. Patel',
          transcriptClean: 'Patient reports R shoulder pain for 6 weeks, conservative care.',
        },
      ]),
    );
    expect(rendered).toContain('<external_context count="1">');
    expect(rendered).toContain('dateOfRecord="2026-04-12"');
    expect(rendered).toContain('source="OUTSIDE_PROVIDER"');
    expect(rendered).toContain('sourceLabel="Dr. Smith referral letter"');
    expect(rendered).toContain('addedBy="Dr. Patel"');
    expect(rendered).toContain('Patient reports R shoulder pain for 6 weeks');
  });

  it('truncates very long transcripts to a bounded length', () => {
    const big = 'x'.repeat(8_000);
    const rendered = buildBriefUserMessage(
      input([
        {
          externalContextId: 'ec_big',
          dateOfRecordIso: '2026-04-01T00:00:00Z',
          source: 'PATIENT_SUPPLIED',
          sourceLabel: null,
          addedByName: 'Dr. Patel',
          transcriptClean: big,
        },
      ]),
    );
    expect(rendered).toContain('[truncated]');
    // Should not contain the full 8 KB run anywhere
    expect(rendered.match(/x{8000}/g)).toBeNull();
  });

  it('escapes ampersands and quotes in addedBy + sourceLabel attrs', () => {
    const rendered = buildBriefUserMessage(
      input([
        {
          externalContextId: 'ec_esc',
          dateOfRecordIso: '2026-03-20T00:00:00Z',
          source: 'OUTSIDE_PROVIDER',
          sourceLabel: 'Smith & "Co" Group',
          addedByName: 'Dr. O\'Hara & "team"',
          transcriptClean: 'Body.',
        },
      ]),
    );
    expect(rendered).toContain('sourceLabel="Smith &amp; &quot;Co&quot; Group"');
    expect(rendered).toContain("addedBy=\"Dr. O'Hara &amp; &quot;team&quot;\"");
  });
});

describe('BRIEF_SYSTEM_PROMPT — external context block', () => {
  it('includes the EXTERNAL CONTEXT system rules', () => {
    expect(BRIEF_SYSTEM_PROMPT).toContain('EXTERNAL CONTEXT');
    expect(BRIEF_SYSTEM_PROMPT).toContain('LOWER-CONFIDENCE THAN SIGNED NOTES');
    expect(BRIEF_SYSTEM_PROMPT).toContain('per outside provider note dated');
    expect(BRIEF_SYSTEM_PROMPT).toContain('MUST NOT pull plan items');
    expect(BRIEF_SYSTEM_PROMPT).toContain('from external context');
  });
});
