import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requirePlatformOwner } from '@/lib/authz/platform';
import { computeOrgUsage, USAGE_MAX_WINDOW_DAYS } from '@/lib/owner/usage-rollup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(USAGE_MAX_WINDOW_DAYS).optional(),
});

/**
 * GET /api/owner/orgs/[id]/usage?days=30 — Unit 32.
 *
 * Returns the per-day usage rollup for the org over the last N UTC-day
 * buckets (default + max 30). Cached in OrgUsageDaily with a 60-min
 * freshness window; stale buckets recompute synchronously before the
 * response.
 *
 * GET-only (no audit row — read traffic on this endpoint can be heavy
 * when an owner is comparing orgs, and adding a USAGE_VIEWED audit row
 * would balloon cardinality). The underlying queries are bounded by
 * the 30-day window.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;

  const { id: orgId } = await params;
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    days: url.searchParams.get('days') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }

  // Org existence check before spending compute on a bogus id.
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true },
  });
  if (!org) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  const days = parsed.data.days ?? USAGE_MAX_WINDOW_DAYS;
  const usage = await computeOrgUsage(orgId, days);

  return NextResponse.json({
    data: {
      windowDays: days,
      rollup: usage,
    },
  });
}
