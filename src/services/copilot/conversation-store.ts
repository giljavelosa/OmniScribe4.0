/**
 * Sprint 0.14 — persistent-conversation read/write helpers.
 *
 * One `CopilotConversation` per `(orgId, patientId, clinicianOrgUserId,
 * mode)`. Research-mode rows have `patientId = null`.
 *
 * Rule 8: audit writes (CLEO_CONVERSATION_OPENED, _PURGED) live in the
 * route handlers — never wrapped in swallowing try-catch. This helper
 * is the data layer; audits stay at the API boundary so a regression
 * doesn't bury them.
 */

import { CopilotConversationMode, type CopilotConversation, type CopilotMessage } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { PERSONA_VERSION } from './persona';

/** Number of prior turns we include as agent context per call. Bounded so
 *  the prompt stays cheap. Anything older is still in DB + visible in the
 *  Sheet, but the agent doesn't re-read it on every turn. */
export const CONVERSATION_HISTORY_TURNS = 20;

export type ConversationMode = 'CHART' | 'RESEARCH';

export type LoadResult = {
  conversation: CopilotConversation;
  messages: CopilotMessage[];
  /** True when this is the first time the conversation row was created
   *  in THIS request. The route uses it to fire CLEO_CONVERSATION_OPENED
   *  exactly once. */
  wasCreated: boolean;
};

export type ConversationTuple = {
  orgId: string;
  patientId: string | null;
  clinicianOrgUserId: string;
  mode: ConversationMode;
};

/**
 * Look up a conversation by its (org × patient × clinician × mode) tuple.
 * Prisma's findUnique rejects null patientId in compound keys (RESEARCH
 * mode), so we use findFirst with an explicit null filter instead.
 */
export async function findConversationByTuple(
  tuple: ConversationTuple,
): Promise<CopilotConversation | null> {
  const { orgId, patientId, clinicianOrgUserId, mode } = tuple;
  const prismaMode = mode as CopilotConversationMode;

  if (patientId === null) {
    return prisma.copilotConversation.findFirst({
      where: {
        orgId,
        patientId: null,
        clinicianOrgUserId,
        mode: prismaMode,
      },
    });
  }

  return prisma.copilotConversation.findUnique({
    where: {
      orgId_patientId_clinicianOrgUserId_mode: {
        orgId,
        patientId,
        clinicianOrgUserId,
        mode: prismaMode,
      },
    },
  });
}

/**
 * Load (or lazily create) the conversation for a tuple. Both chart and
 * research modes flow through here — research callers pass patientId=null.
 *
 * Idempotent at the DB layer via the (orgId, patientId, clinicianOrgUserId,
 * mode) unique. The wasCreated flag indicates whether this call inserted
 * the row, so the route can audit OPENED exactly once.
 */
export async function loadOrCreateConversation(args: {
  orgId: string;
  patientId: string | null;
  clinicianOrgUserId: string;
  mode: ConversationMode;
  historyTurns?: number;
}): Promise<LoadResult> {
  const { orgId, patientId, clinicianOrgUserId, mode } = args;
  const historyTurns = args.historyTurns ?? CONVERSATION_HISTORY_TURNS;

  // Prisma's upsert doesn't accept compound keys with nullable fields cleanly
  // (patientId is nullable for research mode). Use findConversationByTuple,
  // fall back to create. Race-safe via the unique index — a duplicate-key
  // error falls through to a fresh read.
  let conversation = await findConversationByTuple({
    orgId,
    patientId,
    clinicianOrgUserId,
    mode,
  });

  let wasCreated = false;
  if (!conversation) {
    try {
      conversation = await prisma.copilotConversation.create({
        data: {
          orgId,
          patientId,
          clinicianOrgUserId,
          mode: mode as CopilotConversationMode,
          personaVersion: PERSONA_VERSION,
        },
      });
      wasCreated = true;
    } catch (err) {
      // Race: a sibling request created the row between our find + create.
      // Re-read; we should now find it.
      conversation = await findConversationByTuple({
        orgId,
        patientId,
        clinicianOrgUserId,
        mode,
      });
      if (!conversation) throw err;
    }
  }

  const messages = await prisma.copilotMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'asc' },
    take: historyTurns,
  });

  return { conversation, messages, wasCreated };
}

/**
 * Append a user message + the assistant's response to a conversation in a
 * single transaction so a partial write never leaves the thread half-
 * persisted. Also bumps lastActivityAt via the prisma @updatedAt magic.
 */
export async function appendTurn(args: {
  conversationId: string;
  userContent: string;
  assistantContent: string;
  /** Source pills from the agent's answer. */
  sources: unknown;
  /** Tool call shapes from the agent. PHI-bearing tool args are NOT in
   *  here — they're the structured shape the chat surface renders below
   *  the bubble. */
  toolCalls: unknown;
}): Promise<{ userMessage: CopilotMessage; assistantMessage: CopilotMessage }> {
  const { conversationId, userContent, assistantContent, sources, toolCalls } = args;
  return prisma.$transaction(async (tx) => {
    const userMessage = await tx.copilotMessage.create({
      data: {
        conversationId,
        role: 'user',
        content: userContent,
      },
    });
    const assistantMessage = await tx.copilotMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        content: assistantContent,
        sourcesJson: sources as never,
        toolCallsJson: toolCalls as never,
      },
    });
    // Bump lastActivityAt explicitly — @updatedAt only fires on an update.
    await tx.copilotConversation.update({
      where: { id: conversationId },
      data: { lastActivityAt: new Date() },
    });
    return { userMessage, assistantMessage };
  });
}

/**
 * Purge a conversation. Cascades to messages via onDelete: Cascade. Returns
 * the message count that was deleted (for audit metadata). The
 * CopilotPatientState row is NOT touched here — facts distilled from prior
 * chats remain in `conversationFactsJson` and they're already cited.
 */
export async function purgeConversation(args: {
  orgId: string;
  conversationId: string;
}): Promise<{ messageCount: number; mode: ConversationMode; patientId: string | null } | null> {
  const { orgId, conversationId } = args;
  const conversation = await prisma.copilotConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, orgId: true, mode: true, patientId: true },
  });
  if (!conversation || conversation.orgId !== orgId) return null;
  const messageCount = await prisma.copilotMessage.count({
    where: { conversationId },
  });
  await prisma.copilotConversation.delete({ where: { id: conversationId } });
  return {
    messageCount,
    mode: conversation.mode as ConversationMode,
    patientId: conversation.patientId,
  };
}

/**
 * Map stored message rows → agent turn shape (`role: 'user' | 'assistant'`).
 * Drops 'tool-result' rows (we don't persist those today).
 */
export function messagesToAgentHistory(
  messages: CopilotMessage[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: m.content,
    }));
}
