/**
 * writeAuditLog — sole audit-log writer (spec §K).
 *
 * Anti-regression rule 8: NEVER wrapped in try-catch that swallows. If audit
 * write fails, the caller's request fails. Compliance > convenience.
 *
 * PHI-free metadata enforced by assertPhiFreeMetadata; throws
 * PhiInAuditMetadataError on violation. Caller MUST surface a 500 to the
 * client — leaking PHI into audit logs is the exact failure this guards.
 */

import { Prisma, type PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import type { AuditAction } from './actions';
import { assertPhiFreeMetadata } from './phi-free-check';

type AuditClient = Prisma.TransactionClient | PrismaClient;

export type AuditEntry = {
  userId?: string;
  orgId?: string;
  actingUserId?: string;
  onBehalfOfUserId?: string;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  /** Optional Prisma tx client — pass when calling from inside `$transaction`
   * so the audit row commits/rolls back atomically with the caller's writes.
   */
  tx?: AuditClient;
};

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  assertPhiFreeMetadata(entry.metadata);

  const client = entry.tx ?? prisma;
  await client.auditLog.create({
    data: {
      userId: entry.userId,
      orgId: entry.orgId,
      actingUserId: entry.actingUserId,
      onBehalfOfUserId: entry.onBehalfOfUserId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      metadata: (entry.metadata ?? undefined) as unknown as object | undefined,
    },
  });
}

/** Same shape but writes to PlatformAuditLog (cross-org owner actions). */
export async function writePlatformAuditLog(entry: {
  actingUserId: string;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  assertPhiFreeMetadata(entry.metadata);

  await prisma.platformAuditLog.create({
    data: {
      actingUserId: entry.actingUserId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      metadata: (entry.metadata ?? undefined) as unknown as object | undefined,
    },
  });
}
