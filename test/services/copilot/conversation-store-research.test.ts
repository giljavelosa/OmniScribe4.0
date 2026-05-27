import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression: Prisma's findUnique on a compound key rejects null values at
 * the validation layer, so loadOrCreateConversation must branch to findFirst
 * when patientId is null (RESEARCH mode). The partial unique index
 * `CopilotConversation_research_singleton_idx` still enforces "one RESEARCH
 * thread per (org × clinician)" at the DB layer.
 */

const convoFindUnique = vi.fn();
const convoFindFirst = vi.fn();
const convoCreate = vi.fn();
const messageFindMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    copilotConversation: {
      findUnique: (...a: unknown[]) => convoFindUnique(...a),
      findFirst: (...a: unknown[]) => convoFindFirst(...a),
      create: (...a: unknown[]) => convoCreate(...a),
    },
    copilotMessage: {
      findMany: (...a: unknown[]) => messageFindMany(...a),
    },
  },
}));

import { loadOrCreateConversation } from '@/services/copilot/conversation-store';

beforeEach(() => {
  convoFindUnique.mockReset();
  convoFindFirst.mockReset();
  convoCreate.mockReset();
  messageFindMany.mockReset().mockResolvedValue([]);
});

describe('loadOrCreateConversation — RESEARCH mode (patientId=null)', () => {
  it('uses findFirst (not findUnique) when patientId is null', async () => {
    convoFindFirst.mockResolvedValueOnce({
      id: 'convo_1',
      orgId: 'org_1',
      patientId: null,
      clinicianOrgUserId: 'ou_1',
      mode: 'RESEARCH',
    });

    const result = await loadOrCreateConversation({
      orgId: 'org_1',
      patientId: null,
      clinicianOrgUserId: 'ou_1',
      mode: 'RESEARCH',
    });

    expect(convoFindUnique).not.toHaveBeenCalled();
    expect(convoFindFirst).toHaveBeenCalledTimes(1);
    expect(convoFindFirst).toHaveBeenCalledWith({
      where: {
        orgId: 'org_1',
        patientId: null,
        clinicianOrgUserId: 'ou_1',
        mode: 'RESEARCH',
      },
    });
    expect(result.wasCreated).toBe(false);
    expect(result.conversation.id).toBe('convo_1');
  });

  it('creates the conversation when no row exists and reports wasCreated', async () => {
    convoFindFirst.mockResolvedValueOnce(null);
    convoCreate.mockResolvedValueOnce({
      id: 'convo_new',
      orgId: 'org_1',
      patientId: null,
      clinicianOrgUserId: 'ou_1',
      mode: 'RESEARCH',
    });

    const result = await loadOrCreateConversation({
      orgId: 'org_1',
      patientId: null,
      clinicianOrgUserId: 'ou_1',
      mode: 'RESEARCH',
    });

    expect(convoCreate).toHaveBeenCalledTimes(1);
    expect(result.wasCreated).toBe(true);
    expect(result.conversation.id).toBe('convo_new');
  });

  it('on create race, re-reads via findFirst (not findUnique)', async () => {
    convoFindFirst
      .mockResolvedValueOnce(null) // initial lookup misses
      .mockResolvedValueOnce({
        id: 'convo_raced',
        orgId: 'org_1',
        patientId: null,
        clinicianOrgUserId: 'ou_1',
        mode: 'RESEARCH',
      });
    convoCreate.mockRejectedValueOnce(new Error('duplicate key'));

    const result = await loadOrCreateConversation({
      orgId: 'org_1',
      patientId: null,
      clinicianOrgUserId: 'ou_1',
      mode: 'RESEARCH',
    });

    expect(convoFindUnique).not.toHaveBeenCalled();
    expect(convoFindFirst).toHaveBeenCalledTimes(2);
    expect(result.conversation.id).toBe('convo_raced');
    expect(result.wasCreated).toBe(false);
  });
});

describe('loadOrCreateConversation — CHART mode (patientId set)', () => {
  it('uses findUnique on the compound key', async () => {
    convoFindUnique.mockResolvedValueOnce({
      id: 'convo_chart',
      orgId: 'org_1',
      patientId: 'pt_1',
      clinicianOrgUserId: 'ou_1',
      mode: 'CHART',
    });

    await loadOrCreateConversation({
      orgId: 'org_1',
      patientId: 'pt_1',
      clinicianOrgUserId: 'ou_1',
      mode: 'CHART',
    });

    expect(convoFindFirst).not.toHaveBeenCalled();
    expect(convoFindUnique).toHaveBeenCalledTimes(1);
    expect(convoFindUnique).toHaveBeenCalledWith({
      where: {
        orgId_patientId_clinicianOrgUserId_mode: {
          orgId: 'org_1',
          patientId: 'pt_1',
          clinicianOrgUserId: 'ou_1',
          mode: 'CHART',
        },
      },
    });
  });
});
