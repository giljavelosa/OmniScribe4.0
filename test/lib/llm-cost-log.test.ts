import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Division, PrismaClient } from '@prisma/client';

import { writeLlmCallLog } from '@/lib/llm/cost-log';

/**
 * writeLlmCallLog integration tests — Unit 35.
 *
 * Hits the live Postgres. Verifies the writer produces correct
 * Decimal(12,4) cost rows for known + unknown models + handles
 * stub-mode (zero tokens, costUsd=0, stub=true column).
 */

const prisma = new PrismaClient();
const ORG_ID = 'test-org-unit-35-cost-log';

beforeAll(async () => {
  await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: {},
    create: {
      id: ORG_ID,
      name: 'Unit 35 Cost Log Test Org',
      division: Division.MEDICAL,
      billingEmail: 'unit35costlog@test.local',
    },
  });
});

beforeEach(async () => {
  await prisma.llmCallLog.deleteMany({ where: { orgId: ORG_ID } });
});

afterAll(async () => {
  await prisma.llmCallLog.deleteMany({ where: { orgId: ORG_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.$disconnect();
});

describe('writeLlmCallLog', () => {
  it('writes a row with the computed costUsd for a known Sonnet model', async () => {
    await writeLlmCallLog({
      orgId: ORG_ID,
      surface: 'copilot.ask',
      model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      tokensIn: 1000,
      tokensOut: 500,
      latencyMs: 1234,
    });
    const rows = await prisma.llmCallLog.findMany({ where: { orgId: ORG_ID } });
    expect(rows).toHaveLength(1);
    // (1000 * 3 + 500 * 15) / 1_000_000 = 0.0105
    expect(Number(rows[0]!.costUsd)).toBe(0.0105);
    expect(rows[0]!.tokensIn).toBe(1000);
    expect(rows[0]!.tokensOut).toBe(500);
    expect(rows[0]!.stub).toBe(false);
    expect(rows[0]!.surface).toBe('copilot.ask');
  });

  it('writes a row with Haiku pricing for a known Haiku model', async () => {
    await writeLlmCallLog({
      orgId: ORG_ID,
      surface: 'copilot.draft.patientMessage',
      model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      tokensIn: 1000,
      tokensOut: 500,
      latencyMs: 800,
    });
    const row = await prisma.llmCallLog.findFirst({ where: { orgId: ORG_ID } });
    // (1000 * 1 + 500 * 5) / 1_000_000 = 0.0035
    expect(Number(row!.costUsd)).toBe(0.0035);
  });

  it('writes costUsd=0 for zero-token stub responses', async () => {
    await writeLlmCallLog({
      orgId: ORG_ID,
      surface: 'worker.brief.sonnet',
      model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 5,
      stub: true,
    });
    const row = await prisma.llmCallLog.findFirst({ where: { orgId: ORG_ID } });
    expect(Number(row!.costUsd)).toBe(0);
    expect(row!.stub).toBe(true);
  });

  it('uses the conservative unknown fallback for unmapped models', async () => {
    await writeLlmCallLog({
      orgId: ORG_ID,
      surface: 'test.unknown',
      model: 'meta.llama-99-omg',
      tokensIn: 100_000,
      tokensOut: 50_000,
      latencyMs: 100,
    });
    const row = await prisma.llmCallLog.findFirst({ where: { orgId: ORG_ID } });
    // Fallback: $10/$30 per MTok → (100k * 10 + 50k * 30) / 1M = 2.5
    expect(Number(row!.costUsd)).toBe(2.5);
  });

  it('persists the noteId when provided', async () => {
    await writeLlmCallLog({
      orgId: ORG_ID,
      noteId: 'note-xyz',
      surface: 'worker.note-generation.assessment',
      model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      tokensIn: 2000,
      tokensOut: 1500,
      latencyMs: 3000,
    });
    const row = await prisma.llmCallLog.findFirst({ where: { orgId: ORG_ID } });
    expect(row!.noteId).toBe('note-xyz');
  });
});
