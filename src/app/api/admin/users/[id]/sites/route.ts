/**
 * Admin endpoints for clinician site enrollment.
 * Spec: context/specs/clinician-site-enrollment.md
 *
 *   GET  /api/admin/users/[id]/sites  → current enrollment
 *   POST /api/admin/users/[id]/sites  → replace enrollment + audit
 *
 * Gated by `TEAM_MEMBERS_MANAGE`. The id param is the User.id of the target
 * (matches the existing /api/admin/users/[id] PATCH conventions).
 *
 * Audit row `CLINICIAN_SITES_UPDATED` is PHI-free — only siteId arrays + the
 * primary id. The clinician's name / email is never in metadata.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

const replaceSchema = z.object({
  siteIds: z.array(z.string().min(1)).max(100),
  primarySiteId: z.string().min(1).nullable().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE');
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;

  const { id: targetUserId } = await params;
  const targetOrgUser = await prisma.orgUser.findFirst({
    where: { userId: targetUserId, orgId: authorizationUser.orgId },
    select: { id: true, role: true },
  });
  if (!targetOrgUser) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  const rows = await prisma.orgUserSite.findMany({
    where: { orgUserId: targetOrgUser.id },
    include: { site: { select: { id: true, name: true, isArchived: true } } },
    orderBy: [{ isPrimary: 'desc' }, { enrolledAt: 'asc' }],
  });

  return NextResponse.json({
    data: {
      orgUserId: targetOrgUser.id,
      role: targetOrgUser.role,
      enrollments: rows.map((r) => ({
        siteId: r.siteId,
        siteName: r.site.name,
        siteArchived: r.site.isArchived,
        isPrimary: r.isPrimary,
        credentialNotes: r.credentialNotes,
        enrolledAt: r.enrolledAt.toISOString(),
      })),
    },
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = replaceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const { siteIds, primarySiteId } = parsed.data;

  // De-duplicate; preserve order.
  const seen = new Set<string>();
  const uniqueSiteIds = siteIds.filter((s) => {
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });

  if (primarySiteId && !uniqueSiteIds.includes(primarySiteId)) {
    return NextResponse.json(
      { error: { code: 'primary_not_in_set', message: 'primarySiteId must be one of siteIds.' } },
      { status: 400 },
    );
  }

  const { id: targetUserId } = await params;
  const targetOrgUser = await prisma.orgUser.findFirst({
    where: { userId: targetUserId, orgId: authorizationUser.orgId },
    select: { id: true, role: true },
  });
  if (!targetOrgUser) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  // All requested sites must belong to the actor's org (defense in depth — a
  // malicious payload cannot enroll someone at another tenant's site).
  if (uniqueSiteIds.length > 0) {
    const validSites = await prisma.site.findMany({
      where: { id: { in: uniqueSiteIds }, orgId: authorizationUser.orgId },
      select: { id: true },
    });
    if (validSites.length !== uniqueSiteIds.length) {
      return NextResponse.json(
        { error: { code: 'invalid_site', message: 'One or more siteIds are not in your org.' } },
        { status: 400 },
      );
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.orgUserSite.findMany({
      where: { orgUserId: targetOrgUser.id },
      select: { siteId: true, isPrimary: true },
    });
    const beforeIds = before.map((r) => r.siteId).sort();

    // Delete-then-create gives us a clean audit "before/after" and avoids the
    // upsert path having to think about primary toggling.
    await tx.orgUserSite.deleteMany({ where: { orgUserId: targetOrgUser.id } });
    if (uniqueSiteIds.length > 0) {
      await tx.orgUserSite.createMany({
        data: uniqueSiteIds.map((siteId) => ({
          orgUserId: targetOrgUser.id,
          siteId,
          isPrimary: siteId === primarySiteId,
          enrolledByOrgUserId: authorizationUser.orgUserId,
        })),
      });
    }

    const afterIds = uniqueSiteIds.slice().sort();
    const primaryResolved =
      primarySiteId ?? before.find((r) => r.isPrimary)?.siteId ?? null;

    await writeAuditLog({
      tx,
      userId: targetUserId,
      orgId: authorizationUser.orgId,
      actingUserId: user.id,
      action: 'CLINICIAN_SITES_UPDATED',
      resourceType: 'OrgUser',
      resourceId: targetOrgUser.id,
      metadata: {
        before: beforeIds,
        after: afterIds,
        primary: primaryResolved,
      },
    });

    return { before: beforeIds, after: afterIds };
  });

  return NextResponse.json({ data: { ok: true, count: result.after.length } });
}
