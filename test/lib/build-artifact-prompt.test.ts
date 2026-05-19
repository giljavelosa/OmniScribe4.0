import { describe, it, expect } from 'vitest';

import {
  buildPatientInstructionsPrompt,
  buildReferralLetterPrompt,
  type FinalJsonShape,
} from '@/lib/notes/build-artifact-prompt';
import type { PatientProjection, EpisodeProjection } from '@/lib/notes/projections';

const patient: PatientProjection = {
  firstName: 'Riley',
  age: 42,
  sex: 'F',
  preferredLanguage: 'English',
  mrn: 'MRN-TEST-001',
};

const episode: EpisodeProjection = {
  diagnosis: 'Acute rhinosinusitis',
  bodyPart: null,
  departmentName: 'Family Medicine',
  status: 'ACTIVE',
  goals: [{ text: 'Resolve symptoms by week 2', type: 'STG', status: 'ACTIVE' }],
};

const finalJson: FinalJsonShape = {
  signedAt: new Date().toISOString(),
  schemaVersion: 1,
  sections: [
    { id: 'subjective', label: 'Subjective', required: true, content: 'Pt reports facial pressure and congestion for 5 days.' },
    { id: 'plan', label: 'Plan', required: true, content: 'Recommend amoxicillin 500mg TID x 10 days. Consider ENT referral if no improvement in 14 days.' },
    { id: 'addl', label: 'Additional', required: false, content: '' },
  ],
};

describe('buildPatientInstructionsPrompt', () => {
  const { system, user } = buildPatientInstructionsPrompt(finalJson, patient, episode);

  it('sets a plain-language, 6th-grade reading-level voice', () => {
    expect(system).toMatch(/6th-grade/i);
    expect(system).toMatch(/plain/i);
  });

  it('forbids inventing dosages or red-flag symptoms', () => {
    expect(system).toMatch(/Do not invent dosages/);
    expect(system).toMatch(/red-flag/i);
  });

  it('honors the patient preferred language', () => {
    expect(system).toMatch(/Localization/);
    expect(system).toMatch(/English/);
  });

  it('includes the signed sections in the user prompt — never PHI we said NEVER to project', () => {
    expect(user).toContain('Subjective');
    expect(user).toContain('Pt reports facial pressure');
    // Empty sections must be dropped, not shown as "(empty)".
    expect(user).not.toMatch(/Additional[\s\S]{0,40}\(empty\)/);
    // The projection guarantees DOB / SSN / phone / email are not present.
    expect(user).not.toMatch(/DOB|SSN/);
  });

  it('asks for strict JSON output (no markdown fences)', () => {
    expect(system).toMatch(/no markdown fences/);
    expect(system).toMatch(/"plainLanguage"/);
  });
});

describe('buildReferralLetterPrompt', () => {
  const { system, user } = buildReferralLetterPrompt(finalJson, patient, episode);

  it('sets a clinician-to-clinician voice', () => {
    expect(system).toMatch(/clinician-to-clinician/i);
    expect(system).toMatch(/Professional/);
  });

  it('falls back to a sensible recipient when nothing in the note specifies one', () => {
    expect(system).toMatch(/General — please direct as appropriate/);
  });

  it('grounds the body in the signed note only — does not invent history', () => {
    expect(system).toMatch(/SOLE source of clinical detail/);
    expect(system).toMatch(/Do not invent/);
  });

  it('echoes the signed sections in the user prompt', () => {
    expect(user).toContain('Plan');
    expect(user).toContain('amoxicillin 500mg TID');
  });

  it('asks for strict JSON output with recipient / subject / body', () => {
    expect(system).toMatch(/"recipient"/);
    expect(system).toMatch(/"subject"/);
    expect(system).toMatch(/"body"/);
  });
});

describe('buildPatientInstructionsPrompt — no episode linked', () => {
  it('produces a prompt that is still well-formed when no episode is given', () => {
    const { user } = buildPatientInstructionsPrompt(finalJson, patient);
    expect(user).toContain('Episode of care: (not linked)');
  });
});
