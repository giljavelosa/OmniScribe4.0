/**
 * Self-service site enrollment for the onboarding wizard.
 * Spec: context/specs/clinician-site-enrollment.md §UI/Clinician onboarding
 *
 * Unlike POST /api/admin/users/[id]/sites (admin-gated), this endpoint lets
 * the freshly-onboarded clinician declare their own enrollment as part of the
 * sign-up flow. We only let them write rows when they currently have ZERO
 * enrollments — once an admin has set the list, the clinician can no longer
 * edit it themselves. This keeps the admin's intentional assignment intact.
 *
 * Org-wide-admins shouldn't hit this route (the wizard skips them) but if
 * they do, we return 200 immediately so the wizard can move on without
 * inserting redundant OrgUserSite rows.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { isAllSitesRole } from '@/lib/authz/site-scope';

export const runtime = 'nodejs';

const bodySchema = z.object({
  siteIds: z.array(z.string().min(1)).min(1).max(20),
  primarySiteId: z.string().min(1).nullable().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || !session.user.orgId || !session.user.orgUserId) {
    return NextResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const { siteIds, primarySiteId } = parsed.data;

  const orgUser = await prisma.orgUser.findUnique({
    where: { id: session.user.orgUserId },
    select: { id: true, orgId: true, role: true, siteEnrollments: { select: { id: true } } },
  });
  if (!orgUser || orgUser.orgId !== session.user.orgId) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  // Org-wide-admins don't need rows; treat as no-op success.
  if (isAllSitesRole(orgUser.role)) {
    return NextResponse.json({ data: { ok: true, skipped: 'all_sites_role' } });
  }

  // Self-service is one-shot — only allowed when the clinician currently has
  // zero enrollments. After that, edits go through the admin endpoint.
  if (orgUser.siteEnrollments.length > 0) {
    return NextResponse.json(
      { error: { code: 'already_enrolled', message: 'Ask your admin to change your sites.' } },
      { status: 409 },
    );
  }

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

  // All sites must be in the caller's org.
  const validSites = await prisma.site.findMany({
    where: { id: { in: uniqueSiteIds }, orgId: orgUser.orgId },
    select: { id: true },
  });
  if (validSites.length !== uniqueSiteIds.length) {
    return NextResponse.json(
      { error: { code: 'invalid_site', message: 'One or more sites are not in your org.' } },
      { status: 400 },
    );
  }

  const primaryResolved = primarySiteId ?? uniqueSiteIds[0] ?? null;

  await prisma.$transaction(async (tx) => {
    await tx.orgUserSite.createMany({
      data: uniqueSiteIds.map((siteId) => ({
        orgUserId: orgUser.id,
        siteId,
        isPrimary: siteId === primaryResolved,
        enrolledByOrgUserId: orgUser.id, // self-enrolled
      })),
    });
    await writeAuditLog({
      tx,
      userId: session.user.id,
      orgId: orgUser.orgId,
      actingUserId: session.user.id,
      action: 'CLINICIAN_SITES_UPDATED',
      resourceType: 'OrgUser',
      resourceId: orgUser.id,
      metadata: {
        before: [],
        after: uniqueSiteIds.slice().sort(),
        primary: primaryResolved,
        source: 'onboarding',
      },
    });
  });

  return NextResponse.json({ data: { ok: true, count: uniqueSiteIds.length } });
}
