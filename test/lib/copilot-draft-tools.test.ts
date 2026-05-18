import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Division, NoteStatus, PatientSex, Prisma, PrismaClient } from '@prisma/client';

import {
  runDraftPatientMessage,
  runProposeFollowUpCadence,
  runSuggestReferralLetterContent,
} from '@/services/copilot/draft-tools';
import type { LLMService } from '@/services/llm';

/**
 * Unit 30 — Draft tool tests.
 *
 * Hits real local Postgres for the patient + signed-note fixtures
 * (matches the Unit 28 FHIR-tool pattern). LLM is scripted so the
 * test exercises both the happy-path (model returns valid JSON) +
 * parse-failure paths without spending tokens.
 *
 * Stub-mode is also exercised: LLMService with stub: true triggers
 * the deterministic per-tool canned draft.
 */

const prisma = new PrismaClient();

const ORG_ID = 'test-org-unit-30-drafts';
const PATIENT_ID = 'test-pat-unit-30';
const ORGUSER_ID = 'test-orguser-unit-30';
const USER_ID = 'test-user-unit-30';
const SIGNED_NOTE_ID = 'test-note-unit-30';

beforeAll(async () => {
  await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: {},
    create: {
      id: ORG_ID,
      name: 'Unit 30 Test Org',
      division: Division.MEDICAL,
      billingEmail: 'unit30@test.local',
    },
  });
  await prisma.user.upsert({
    where: { id: USER_ID },
    update: {},
    create: {
      id: USER_ID,
      email: 'unit30@test.local',
      passwordHash: 'x',
      mfaEnabled: false,
    },
  });
  await prisma.orgUser.upsert({
    where: { id: ORGUSER_ID },
    update: {},
    create: {
      id: ORGUSER_ID,
      userId: USER_ID,
      orgId: ORG_ID,
      role: 'CLINICIAN',
      division: Division.MEDICAL,
    },
  });
  await prisma.patient.upsert({
    where: { id: PATIENT_ID },
    update: {},
    create: {
      id: PATIENT_ID,
      orgId: ORG_ID,
      mrn: PATIENT_ID,
      firstName: 'Test',
      lastName: 'DraftPatient',
      dob: new Date('1980-01-01'),
      sex: PatientSex.FEMALE,
      division: Division.MEDICAL,
    },
  });
  // Signed note with a Plan section so the loader has something to grip.
  await prisma.note.upsert({
    where: { id: SIGNED_NOTE_ID },
    update: {},
    create: {
      id: SIGNED_NOTE_ID,
      orgId: ORG_ID,
      patientId: PATIENT_ID,
      clinicianOrgUserId: ORGUSER_ID,
      division: Division.MEDICAL,
      status: NoteStatus.SIGNED,
      signedAt: new Date('2026-04-01T00:00:00Z'),
      finalJson: {
        sections: [
          { label: 'Plan', content: 'Recheck A1c in 90 days. Continue metformin.' },
        ],
      } as unknown as Prisma.InputJsonValue,
    },
  });
});

afterAll(async () => {
  await prisma.note.deleteMany({ where: { id: SIGNED_NOTE_ID } });
  await prisma.patient.deleteMany({ where: { id: PATIENT_ID } });
  await prisma.orgUser.deleteMany({ where: { id: ORGUSER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.organization.delete({ where: { id: ORG_ID } });
  await prisma.$disconnect();
});

function scriptedLlm(text: string, opts?: { stub?: boolean }): LLMService {
  return {
    async generate() {
      return {
        text,
        model: opts?.stub ? 'stub' : 'haiku',
        latencyMs: 1,
        tokensIn: 0,
        tokensOut: 0,
        stub: !!opts?.stub,
      };
    },
    async *generateStream() {
      throw new Error('not used');
    },
  };
}

describe('runDraftPatientMessage', () => {
  it('returns a draft with kind + content + topic + tone meta', async () => {
    const llm = scriptedLlm(
      JSON.stringify({
        content: 'Hi — just following up on your visit.',
        topic: 'A1c follow-up',
        tone: 'follow-up',
      }),
    );
    const out = await runDraftPatientMessage(
      { patientId: PATIENT_ID, topic: 'A1c follow-up' },
      { orgId: ORG_ID },
      llm,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data.draft.kind).toBe('patient-message');
    expect(out.data.draft.content).toContain('following up');
    expect(out.data.draft.meta.topic).toBe('A1c follow-up');
    expect(out.data.draft.meta.tone).toBe('follow-up');
    expect(out.data.sourceNoteId).toBe(SIGNED_NOTE_ID);
  });

  it('returns canned stub draft when LLM is stubbed', async () => {
    const llm = scriptedLlm('irrelevant', { stub: true });
    const out = await runDraftPatientMessage(
      { patientId: PATIENT_ID, topic: 'Stub check' },
      { orgId: ORG_ID },
      llm,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data.draft.content).toMatch(/\[stub\]/);
  });

  it('returns draft_parse_failed on non-JSON LLM output', async () => {
    const llm = scriptedLlm('not json');
    const out = await runDraftPatientMessage(
      { patientId: PATIENT_ID, topic: 'X' },
      { orgId: ORG_ID },
      llm,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe('draft_parse_failed');
  });

  it('returns patient_not_found for an unknown patient id', async () => {
    const llm = scriptedLlm('{}');
    const out = await runDraftPatientMessage(
      { patientId: 'unknown', topic: 'X' },
      { orgId: ORG_ID },
      llm,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe('patient_not_found');
  });
});

describe('runProposeFollowUpCadence', () => {
  it('returns a draft with basis + suggestedIntervals', async () => {
    const llm = scriptedLlm(
      JSON.stringify({
        content: 'Recheck A1c in 90 days.',
        basis: 'Most recent plan.',
        suggestedIntervals: [{ label: 'first recheck', days: 90 }],
      }),
    );
    const out = await runProposeFollowUpCadence(
      { patientId: PATIENT_ID, basis: 'A1c control' },
      { orgId: ORG_ID },
      llm,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data.draft.kind).toBe('followup-cadence');
    expect(out.data.draft.meta.basis).toBe('Most recent plan.');
    const intervals = (out.data.draft.meta.suggestedIntervals as Array<{ days: number }>) ?? [];
    expect(intervals[0]!.days).toBe(90);
  });

  it('filters malformed intervals defensively', async () => {
    const llm = scriptedLlm(
      JSON.stringify({
        content: 'Recheck soon.',
        basis: 'Plan.',
        suggestedIntervals: [
          { label: 'good', days: 60 },
          { label: 'no-days' }, // dropped
          { days: 30 }, // dropped (no label)
          'not-an-object', // dropped
        ],
      }),
    );
    const out = await runProposeFollowUpCadence(
      { patientId: PATIENT_ID, basis: 'X' },
      { orgId: ORG_ID },
      llm,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const intervals = (out.data.draft.meta.suggestedIntervals as Array<{ days: number }>) ?? [];
    expect(intervals).toHaveLength(1);
    expect(intervals[0]!.days).toBe(60);
  });
});

describe('runSuggestReferralLetterContent', () => {
  it('returns a draft with specialty + reason + optional recommendedReceiver', async () => {
    const llm = scriptedLlm(
      JSON.stringify({
        content: 'Dear Colleague, …',
        specialty: 'Endocrinology',
        reason: 'A1c management refractory to first-line therapy',
        recommendedReceiver: 'Dr. Smith @ City Endo',
      }),
    );
    const out = await runSuggestReferralLetterContent(
      { patientId: PATIENT_ID, specialty: 'Endocrinology', reason: 'A1c control' },
      { orgId: ORG_ID },
      llm,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data.draft.kind).toBe('referral-letter');
    expect(out.data.draft.meta.specialty).toBe('Endocrinology');
    expect(out.data.draft.meta.recommendedReceiver).toBe('Dr. Smith @ City Endo');
  });
});
