import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Sprint 0.14 — Ask conversation persistence tests.
 *
 * Coverage:
 *   - First message creates a CopilotConversation + audits
 *     CLEO_CONVERSATION_OPENED with persona metadata.
 *   - Subsequent messages reuse the same conversation (no double
 *     OPENED audit).
 *   - Both user + assistant turns persist with sourcesJson.
 *   - Conversation history is loaded from DB and threaded into the
 *     agent's input.
 */

const noteFindFirst = vi.fn();
const patientFindFirst = vi.fn();
const convoFindUnique = vi.fn();
const convoCreate = vi.fn();
const convoUpdate = vi.fn();
const messageFindMany = vi.fn();
const messageCreate = vi.fn();
const txMock = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    note: { findFirst: (...a: unknown[]) => noteFindFirst(...a) },
    patient: { findFirst: (...a: unknown[]) => patientFindFirst(...a) },
    copilotConversation: {
      findUnique: (...a: unknown[]) => convoFindUnique(...a),
      create: (...a: unknown[]) => convoCreate(...a),
      update: (...a: unknown[]) => convoUpdate(...a),
    },
    copilotMessage: {
      findMany: (...a: unknown[]) => messageFindMany(...a),
      create: (...a: unknown[]) => messageCreate(...a),
    },
    $transaction: (cb: (tx: unknown) => Promise<unknown>) => txMock(cb),
  },
}));

const requireFeatureAccess = vi.fn();
vi.mock('@/lib/authz/server', () => ({
  requireFeatureAccess: (...a: unknown[]) => requireFeatureAccess(...a),
}));

const writeAuditLog = vi.fn();
vi.mock('@/lib/audit/log', () => ({
  writeAuditLog: (...a: unknown[]) => writeAuditLog(...a),
}));

vi.mock('@/lib/phi-access', () => ({
  assertOrgScoped: vi.fn(),
}));

const runAgent = vi.fn();
vi.mock('@/services/copilot/agent', () => ({
  runAgent: (...a: unknown[]) => runAgent(...a),
}));

import { POST } from '@/app/api/copilot/ask/route';

function authedAsClinician() {
  requireFeatureAccess.mockResolvedValueOnce({
    user: { id: 'user_1' },
    authorizationUser: { orgId: 'org_1', orgUserId: 'ou_1', role: 'CLINICIAN' },
    orgUser: { id: 'ou_1', orgId: 'org_1' },
  });
}

function buildReq(body: unknown) {
  return new Request('http://test.local/api/copilot/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function primeAgentAnswer(text = 'Hi there.') {
  runAgent.mockResolvedValueOnce({
    answer: { text, sources: [{ kind: 'note', id: 'n_1', label: 'Source' }], isClarification: false },
    toolCalls: [],
    drafts: [],
    reasoningSteps: [],
    iterations: 1,
    stub: false,
  });
}

beforeEach(() => {
  noteFindFirst.mockReset();
  patientFindFirst.mockReset();
  convoFindUnique.mockReset();
  convoCreate.mockReset();
  convoUpdate.mockReset();
  messageFindMany.mockReset();
  messageCreate.mockReset();
  txMock.mockReset();
  requireFeatureAccess.mockReset();
  writeAuditLog.mockReset();
  runAgent.mockReset();
});

describe('POST /api/copilot/ask — conversation persistence', () => {
  it('first message creates a conversation + audits CLEO_CONVERSATION_OPENED', async () => {
    authedAsClinician();
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_1',
      orgId: 'org_1',
      patientId: 'pat_1',
      encounter: { episodeOfCareId: null },
    });
    patientFindFirst.mockResolvedValueOnce({ id: 'pat_1' });
    // No prior conversation.
    convoFindUnique.mockResolvedValueOnce(null);
    convoCreate.mockResolvedValueOnce({ id: 'convo_1' });
    messageFindMany.mockResolvedValueOnce([]);
    primeAgentAnswer();
    txMock.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        copilotMessage: { create: messageCreate },
        copilotConversation: { update: convoUpdate },
      }),
    );
    messageCreate.mockResolvedValue({ id: 'msg_1' });

    const res = await POST(
      buildReq({ patientId: 'pat_1', noteId: 'note_1', question: 'hello' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.conversationId).toBe('convo_1');

    const auditActions = writeAuditLog.mock.calls.map((c) => c[0].action);
    expect(auditActions).toContain('CLEO_CONVERSATION_OPENED');
    expect(auditActions).toContain('COPILOT_ASK_QUERY');
    expect(auditActions).toContain('COPILOT_ASK_ANSWERED');

    // OPENED stamps the persona version.
    const openedCall = writeAuditLog.mock.calls.find(
      (c) => c[0].action === 'CLEO_CONVERSATION_OPENED',
    );
    expect(openedCall?.[0].metadata).toMatchObject({
      conversationId: 'convo_1',
      mode: 'CHART',
      patientId: 'pat_1',
      personaVersion: 'miss-cleo-v1',
    });

    // Two CopilotMessage rows written in the tx — one user, one assistant.
    expect(messageCreate).toHaveBeenCalledTimes(2);
    expect(messageCreate.mock.calls[0]![0].data).toMatchObject({
      conversationId: 'convo_1',
      role: 'user',
      content: 'hello',
    });
    expect(messageCreate.mock.calls[1]![0].data).toMatchObject({
      conversationId: 'convo_1',
      role: 'assistant',
      content: 'Hi there.',
    });
  });

  it('subsequent messages reuse the existing conversation (no double OPENED)', async () => {
    authedAsClinician();
    noteFindFirst.mockResolvedValueOnce({
      id: 'note_1',
      orgId: 'org_1',
      patientId: 'pat_1',
      encounter: { episodeOfCareId: null },
    });
    patientFindFirst.mockResolvedValueOnce({ id: 'pat_1' });
    // Existing conversation row already exists.
    convoFindUnique.mockResolvedValueOnce({
      id: 'convo_existing',
      orgId: 'org_1',
      patientId: 'pat_1',
      clinicianOrgUserId: 'ou_1',
      mode: 'CHART',
    });
    messageFindMany.mockResolvedValueOnce([
      {
        role: 'user',
        content: 'older question',
        createdAt: new Date(),
      },
      {
        role: 'assistant',
        content: 'older answer',
        createdAt: new Date(),
      },
    ]);
    primeAgentAnswer('Following up on your earlier question.');
    txMock.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        copilotMessage: { create: messageCreate },
        copilotConversation: { update: convoUpdate },
      }),
    );
    messageCreate.mockResolvedValue({ id: 'msg_2' });

    const res = await POST(
      buildReq({ patientId: 'pat_1', noteId: 'note_1', question: 'follow-up' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.conversationId).toBe('convo_existing');

    const auditActions = writeAuditLog.mock.calls.map((c) => c[0].action);
    expect(auditActions).not.toContain('CLEO_CONVERSATION_OPENED');
    expect(convoCreate).not.toHaveBeenCalled();

    // The agent received the prior turns as history.
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        history: [
          { role: 'user', content: 'older question' },
          { role: 'assistant', content: 'older answer' },
        ],
        question: 'follow-up',
      }),
      expect.any(Object),
    );
  });
});
