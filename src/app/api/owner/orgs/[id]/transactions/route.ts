import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requirePlatformOwner } from '@/lib/authz/platform';
import type { AuditAction } from '@/lib/audit/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Curated allowlist of actions that surface in the per-org Transactions
 * timeline. Excludes high-volume operational events (NOTE_*, PATIENT_*,
 * FHIR_*, COPILOT_*) — the view is for **org-level governance**, not
 * per-encounter audit. Full audit table covers deep dives.
 *
 * Centralized here (not inline) so adding a new "governance-relevant"
 * action is a one-line append + the Transactions view picks it up
 * automatically.
 */
const TRANSACTION_ACTIONS: readonly AuditAction[] = [
  // Org lifecycle
  'ORG_CREATED',
  'ORG_BAA_UPDATED',
  'ORG_SETTINGS_UPDATED',
  'ORG_SUBSCRIPTION_UPDATED',
  'PLATFORM_ORG_CREATED',
  'PLATFORM_BAA_UPDATED',
  // User membership lifecycle
  'INVITE_SENT',
  'INVITE_CONSUMED',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_DEACTIVATED',
  'USER_ROLE_CHANGED',
  'MFA_RESET',
  'PASSWORD_RESET_INITIATED_BY_ADMIN',
  // Seat lifecycle (Unit 09 audit emitters)
  'SEAT_ALLOCATED',
  'SEAT_REVOKED',
  'STRIPE_SUBSCRIPTION_UPDATED',
  'STRIPE_SUBSCRIPTION_STUB',
  // Impersonation (Unit 32)
  'IMPERSONATION_BEGAN',
  'IMPERSONATION_ENDED',
  'IMPERSONATION_BLOCKED_MUTATION',
  // Announcements (Unit 09)
  'ANNOUNCEMENT_CREATED',
  'ANNOUNCEMENT_UPDATED',
  'ANNOUNCEMENT_DELETED',
];

const HARD_LIMIT = 100;

/**
 * GET /api/owner/orgs/[id]/transactions — Unit 32.
 *
 * Returns the unified org timeline: top N (capped at 100) audit rows
 * matching the curated TRANSACTION_ACTIONS allowlist, merging
 * AuditLog (org-scope) + PlatformAuditLog (cross-org, filtered to
 * rows that resource-anchor on this org).
 *
 * Sort: createdAt DESC. No pagination in v1 — customer success uses
 * the full audit table for deep dives; this view is at-a-glance.
 *
 * Hydration: batched lookup of acting/onBehalfOf user emails so the
 * client doesn't need to round-trip per row.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;

  const { id: orgId } = await params;

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true },
  });
  if (!org) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  // Parallel fetch from both audit tables. Both query the same
  // curated action list; PlatformAuditLog filters additionally on
  // resourceId === orgId so cross-org platform actions only surface
  // here when they relate to THIS org.
  const [orgRows, platformRows] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        orgId,
        action: { in: TRANSACTION_ACTIONS as unknown as string[] },
      },
      orderBy: { createdAt: 'desc' },
      take: HARD_LIMIT,
    }),
    prisma.platformAuditLog.findMany({
      where: {
        action: { in: TRANSACTION_ACTIONS as unknown as string[] },
        resourceId: orgId,
      },
      orderBy: { createdAt: 'desc' },
      take: HARD_LIMIT,
    }),
  ]);

  // Interleave + sort DESC, then cap.
  type Row = {
    id: string;
    occurredAt: Date;
    source: 'audit' | 'platform-audit';
    action: string;
    actingUserId: string | null;
    onBehalfOfUserId: string | null;
    resourceType: string | null;
    resourceId: string | null;
    metadata: unknown;
  };
  const merged: Row[] = [
    ...orgRows.map((r) => ({
      id: r.id,
      occurredAt: r.createdAt,
      source: 'audit' as const,
      action: r.action,
      actingUserId: r.actingUserId ?? r.userId,
      onBehalfOfUserId: r.onBehalfOfUserId,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      metadata: r.metadata,
    })),
    ...platformRows.map((r) => ({
      id: r.id,
      occurredAt: r.createdAt,
      source: 'platform-audit' as const,
      action: r.action,
      actingUserId: r.actingUserId,
      onBehalfOfUserId: null,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      metadata: r.metadata,
    })),
  ]
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, HARD_LIMIT);

  // Batched email hydration. Collect unique user ids, one query.
  const userIds = new Set<string>();
  for (const row of merged) {
    if (row.actingUserId) userIds.add(row.actingUserId);
    if (row.onBehalfOfUserId) userIds.add(row.onBehalfOfUserId);
  }
  const users =
    userIds.size > 0
      ? await prisma.user.findMany({
          where: { id: { in: Array.from(userIds) } },
          select: { id: true, email: true },
        })
      : [];
  const emailById = new Map(users.map((u) => [u.id, u.email]));

  const transactions = merged.map((row) => ({
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    source: row.source,
    action: row.action,
    actingUserId: row.actingUserId,
    actingUserEmail: row.actingUserId ? emailById.get(row.actingUserId) ?? null : null,
    onBehalfOfUserId: row.onBehalfOfUserId,
    onBehalfOfUserEmail: row.onBehalfOfUserId
      ? emailById.get(row.onBehalfOfUserId) ?? null
      : null,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    metadata: row.metadata,
  }));

  return NextResponse.json({
    data: {
      transactions,
      totalReturned: transactions.length,
      capReached: transactions.length === HARD_LIMIT,
    },
  });
}
