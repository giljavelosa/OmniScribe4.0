/**
 * Audit retention purge — Unit 34.
 *
 * Deletes AuditLog rows older than `Organization.auditRetentionDays`
 * for each org. PlatformAuditLog is the governance trail and is
 * retained forever in v1.
 *
 * Three guarantees:
 *   1. AUDIT_PURGE_RUN rows are NEVER purged — explicitly excluded
 *      from the delete predicate so the deletion history survives.
 *   2. Batches at 5,000 rows per pass to keep transactions short and
 *      avoid blocking concurrent writes.
 *   3. Fail-loud (Rule 8): errors propagate; the caller decides whether
 *      to retry or bail. The CLI runner catches per-org errors so one
 *      org's transient failure doesn't bail the whole run.
 *
 * On every purge run we write one AUDIT_PURGE_RUN row capturing the
 * cutoff, the count deleted, and the duration. That row is immune to
 * future purges (see guarantee 1).
 *
 * Manual + CLI in v1; BullMQ background scheduler deferred to a polish
 * iteration once we know prod hot/cold patterns.
 */

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from './log';

const BATCH_SIZE = 5_000;

export type PurgeResult = {
  orgId: string;
  retentionDays: number | null;
  cutoffDate: string | null; // ISO; null when no retention configured
  rowsDeleted: number;
  durationMs: number;
  skipped: 'no_retention' | 'no_rows_to_delete' | null;
};

/**
 * Purge expired AuditLog rows for a single org. Returns a
 * `PurgeResult` describing the outcome (including the no-op cases —
 * caller can aggregate without branching on errors).
 *
 * No-op when:
 *   - `auditRetentionDays` is null on the org (retain forever).
 *   - Zero rows match the cutoff predicate.
 *
 * Writes AUDIT_PURGE_RUN on success (whether or not rows were
 * deleted; the audit row is the proof the purge ran).
 */
export async function purgeAuditForOrg(
  orgId: string,
  now: Date = new Date(),
): Promise<PurgeResult> {
  const start = Date.now();
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, auditRetentionDays: true },
  });
  if (!org) {
    throw new Error(`purgeAuditForOrg: org not found: ${orgId}`);
  }
  if (org.auditRetentionDays == null) {
    return {
      orgId,
      retentionDays: null,
      cutoffDate: null,
      rowsDeleted: 0,
      durationMs: Date.now() - start,
      skipped: 'no_retention',
    };
  }

  const cutoffMs = now.getTime() - org.auditRetentionDays * 86_400_000;
  const cutoff = new Date(cutoffMs);

  let totalDeleted = 0;
  // Loop in batches until no more matching rows. Each pass is its own
  // delete statement (Prisma's deleteMany doesn't support LIMIT, so we
  // use a select+delete pair).
  while (true) {
    const candidates = await prisma.auditLog.findMany({
      where: {
        orgId,
        createdAt: { lt: cutoff },
        // Don't purge the purge-receipt rows themselves.
        action: { not: 'AUDIT_PURGE_RUN' },
      },
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (candidates.length === 0) break;

    const { count } = await prisma.auditLog.deleteMany({
      where: { id: { in: candidates.map((r) => r.id) } },
    });
    totalDeleted += count;
    if (candidates.length < BATCH_SIZE) break;
  }

  const durationMs = Date.now() - start;
  await writeAuditLog({
    orgId,
    action: 'AUDIT_PURGE_RUN',
    resourceType: 'AuditLog',
    resourceId: 'purge',
    metadata: {
      retentionDays: org.auditRetentionDays,
      cutoffDate: cutoff.toISOString(),
      rowsDeleted: totalDeleted,
      durationMs,
    },
  });

  return {
    orgId,
    retentionDays: org.auditRetentionDays,
    cutoffDate: cutoff.toISOString(),
    rowsDeleted: totalDeleted,
    durationMs,
    skipped: totalDeleted === 0 ? 'no_rows_to_delete' : null,
  };
}

/**
 * Purge across every org that has `auditRetentionDays` set. Per-org
 * failures are caught + logged in the result so cron doesn't bail on
 * a single org's transient error.
 */
export async function purgeAuditAllOrgs(
  now: Date = new Date(),
): Promise<{
  orgsProcessed: number;
  totalRowsDeleted: number;
  perOrg: Array<PurgeResult | { orgId: string; error: string }>;
}> {
  const orgs = await prisma.organization.findMany({
    where: { auditRetentionDays: { not: null } },
    select: { id: true },
  });
  const perOrg: Array<PurgeResult | { orgId: string; error: string }> = [];
  let totalDeleted = 0;
  for (const { id } of orgs) {
    try {
      const result = await purgeAuditForOrg(id, now);
      perOrg.push(result);
      totalDeleted += result.rowsDeleted;
    } catch (err) {
      perOrg.push({
        orgId: id,
        error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      });
    }
  }
  return { orgsProcessed: orgs.length, totalRowsDeleted: totalDeleted, perOrg };
}
