import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requirePlatformOwner } from '@/lib/authz/platform';
import { writeAuditLog, writePlatformAuditLog } from '@/lib/audit/log';
import { SubscriptionPlan } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  subscriptionPlan: z.enum(SubscriptionPlan),
  /** Free-text sales/ops context. Max 500 chars enforced here; the
   *  audit row records the LENGTH only (notes can contain sales
   *  context like rep names + customer-specific terms — better not
   *  logged in the audit metadata). */
  subscriptionOverrideNotes: z
    .string()
    .max(500)
    .nullable()
    .optional()
    .transform((s) => (s == null ? null : s.trim() || null)),
});

/**
 * PATCH /api/owner/orgs/[id]/subscription — Unit 32.
 *
 * Updates the org's subscription tier + override notes. Writes one
 * AuditLog row (org-scope) + one PlatformAuditLog row (cross-org owner
 * action) — both with before/after metadata so the auditor can see the
 * plan transition.
 *
 * PHI fence: subscription override notes can contain sensitive sales
 * context. Audit row records LENGTH only — never the notes text.
 *
 * No impersonation gate needed at the helper level — middleware blocks
 * PATCH during impersonation at the edge. requirePlatformOwner returns
 * 403 for non-owners regardless.
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
  const data = parsed.data;

  const { id } = await params;
  const before = await prisma.organization.findUnique({
    where: { id },
    select: { subscriptionPlan: true, subscriptionOverrideNotes: true },
  });
  if (!before) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  await prisma.organization.update({
    where: { id },
    data: {
      subscriptionPlan: data.subscriptionPlan,
      subscriptionOverrideNotes: data.subscriptionOverrideNotes,
    },
  });

  const beforePayload = {
    plan: before.subscriptionPlan,
    notesLength: before.subscriptionOverrideNotes?.length ?? 0,
  };
  const afterPayload = {
    plan: data.subscriptionPlan,
    notesLength: data.subscriptionOverrideNotes?.length ?? 0,
  };

  // Two-row audit: org-scope row + platform-scope row. Org row appears
  // in the Transactions timeline (per-org view); platform row appears
  // in the cross-org platform audit table.
  await writeAuditLog({
    userId: user.id,
    orgId: id,
    action: 'ORG_SUBSCRIPTION_UPDATED',
    resourceType: 'Organization',
    resourceId: id,
    metadata: { before: beforePayload, after: afterPayload },
  });
  await writePlatformAuditLog({
    actingUserId: user.id,
    action: 'ORG_SUBSCRIPTION_UPDATED',
    resourceType: 'Organization',
    resourceId: id,
    metadata: { before: beforePayload, after: afterPayload },
  });

  return NextResponse.json({ data: { ok: true } });
}
