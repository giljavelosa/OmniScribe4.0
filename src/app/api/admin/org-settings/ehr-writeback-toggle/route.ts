import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

/**
 * POST /api/admin/org-settings/ehr-writeback-toggle — Sprint 0.17.
 *
 * Flips `OrgEhrConnection.writebackEnabled`. Enable: stamps
 * writebackEnabledAt + writebackEnabledByUserId + emits
 * ORG_EHR_WRITEBACK_ENABLED. Disable: clears the timestamp + emits
 * ORG_EHR_WRITEBACK_DISABLED + batch-cancels every PROPOSED /
 * APPROVED proposal for the org (transition to CANCELLED + per-row
 * FHIR_WRITEBACK_CANCELLED with `cancelReason: 'org_disabled'`).
 *
 * Admin-only — `requireFeatureAccess('TEAM_MEMBERS_MANAGE')` gates
 * (matches the rest of `/api/admin/org-settings/`).
 * `org_disabled` is the categorical reason the worker also uses when
 * it re-checks the flag at job pickup; the auditor lens distinguishes
 * the batched (admin) and per-job (worker re-check) cohorts via the
 * `metadata.cancelReason` field.
 */
const bodySchema = z.object({
  connectionId: z.string().min(1).max(64),
  enabled: z.boolean(),
});

export async function POST(req: Request) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }

  const conn = await prisma.orgEhrConnection.findUnique({
    where: { id: parsed.data.connectionId },
    select: { id: true, orgId: true, ehrSystem: true, writebackEnabled: true },
  });
  if (!conn) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(conn.orgId, authorizationUser.orgId);

  // Idempotent — no-op flip is a 200 with the current state.
  if (conn.writebackEnabled === parsed.data.enabled) {
    return NextResponse.json({
      data: { enabled: conn.writebackEnabled, cancelledCount: 0 },
    });
  }

  if (parsed.data.enabled) {
    // Enable path — single update + single audit row. No batch work.
    await prisma.orgEhrConnection.update({
      where: { id: conn.id },
      data: {
        writebackEnabled: true,
        writebackEnabledAt: new Date(),
        writebackEnabledByUserId: user.id,
      },
    });
    await writeAuditLog({
      userId: user.id,
      orgId: conn.orgId,
      action: 'ORG_EHR_WRITEBACK_ENABLED',
      resourceType: 'OrgEhrConnection',
      resourceId: conn.id,
      metadata: { ehrSystem: conn.ehrSystem },
    });
    return NextResponse.json({ data: { enabled: true, cancelledCount: 0 } });
  }

  // Disable path — flip the flag + batch-cancel pending proposals
  // + per-row audit. Wrapped in $transaction so the toggle flip and
  // the batch cancels commit atomically; the per-row audit emissions
  // fire after the tx so they don't bloat the transaction window
  // (audit writes are append-only + can tolerate a partial-batch retry
  // — rule 8 is satisfied because they're outside any swallowing
  // try-catch).
  const toCancel = await prisma.fhirWriteBackProposal.findMany({
    where: {
      orgId: conn.orgId,
      status: { in: ['PROPOSED', 'APPROVED'] },
    },
    select: { id: true, caseManagementId: true },
  });

  await prisma.$transaction([
    prisma.orgEhrConnection.update({
      where: { id: conn.id },
      data: {
        writebackEnabled: false,
        writebackEnabledAt: null,
        writebackEnabledByUserId: null,
      },
    }),
    prisma.fhirWriteBackProposal.updateMany({
      where: {
        orgId: conn.orgId,
        status: { in: ['PROPOSED', 'APPROVED'] },
      },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledByUserId: user.id,
      },
    }),
  ]);

  await writeAuditLog({
    userId: user.id,
    orgId: conn.orgId,
    action: 'ORG_EHR_WRITEBACK_DISABLED',
    resourceType: 'OrgEhrConnection',
    resourceId: conn.id,
    metadata: {
      ehrSystem: conn.ehrSystem,
      cancelledProposalCount: toCancel.length,
    },
  });

  // Per-row cancellation audits. Bulk-insertable but we emit each
  // distinctly so the auditor query "which proposals were cancelled
  // by which admin action?" remains a single join.
  for (const row of toCancel) {
    await writeAuditLog({
      userId: user.id,
      orgId: conn.orgId,
      action: 'FHIR_WRITEBACK_CANCELLED',
      resourceType: 'FhirWriteBackProposal',
      resourceId: row.id,
      metadata: {
        proposalId: row.id,
        caseManagementId: row.caseManagementId,
        cancelReason: 'org_disabled',
      },
    });
  }

  return NextResponse.json({
    data: { enabled: false, cancelledCount: toCancel.length },
  });
}
