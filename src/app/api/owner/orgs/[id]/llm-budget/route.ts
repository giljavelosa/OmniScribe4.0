import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requirePlatformOwner } from '@/lib/authz/platform';
import { writeAuditLog, writePlatformAuditLog } from '@/lib/audit/log';
import { singleFieldChange } from '@/lib/audit/diff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  /** Monthly LLM budget in USD. null = no threshold. Float in body; we
   *  coerce to Prisma.Decimal before write. Hard cap 99_999_999.99 to
   *  match the Decimal(10,2) column ceiling. */
  monthlyLlmBudgetUsd: z.number().min(0).max(99_999_999.99).nullable(),
});

/**
 * PATCH /api/owner/orgs/[id]/llm-budget — Unit 35.
 *
 * Owner-only. Updates `Organization.monthlyLlmBudgetUsd`. Two-row
 * audit (org + platform) mirrors ORG_SUBSCRIPTION_UPDATED +
 * AUDIT_RETENTION_UPDATED. Before/after captured via singleFieldChange
 * so the diff renderer surfaces the change cleanly in audit tables.
 *
 * v1 is surface-only — setting the budget doesn't auto-alert when
 * crossed; the LlmCostCard renders an over-budget warning when the
 * current-month spend exceeds the threshold. Automated alerting
 * (LLM_BUDGET_THRESHOLD_CROSSED action with state to avoid duplicate
 * alerts per month) is a polish iteration.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;
  const { user } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { id } = await params;
  const before = await prisma.organization.findUnique({
    where: { id },
    select: { monthlyLlmBudgetUsd: true },
  });
  if (!before) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  const newBudget =
    parsed.data.monthlyLlmBudgetUsd == null
      ? null
      : new Prisma.Decimal(parsed.data.monthlyLlmBudgetUsd);

  await prisma.organization.update({
    where: { id },
    data: { monthlyLlmBudgetUsd: newBudget },
  });

  const beforeNumeric = before.monthlyLlmBudgetUsd ? Number(before.monthlyLlmBudgetUsd) : null;
  const afterNumeric = parsed.data.monthlyLlmBudgetUsd;
  const changes = singleFieldChange('monthlyLlmBudgetUsd', beforeNumeric, afterNumeric);

  if (Object.keys(changes).length > 0) {
    await writeAuditLog({
      userId: user.id,
      orgId: id,
      action: 'LLM_BUDGET_UPDATED',
      resourceType: 'Organization',
      resourceId: id,
      metadata: { changes },
    });
    await writePlatformAuditLog({
      actingUserId: user.id,
      action: 'LLM_BUDGET_UPDATED',
      resourceType: 'Organization',
      resourceId: id,
      metadata: { changes },
    });
  }

  return NextResponse.json({ data: { ok: true } });
}
