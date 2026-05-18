import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

const bodySchema = z.object({
  action: z.enum(['archive', 'unarchive']),
  reason: z.string().min(10).max(500).optional(),
});

/**
 * POST /api/admin/sites/[id]/archive — soft-archive or restore a site.
 *
 * Action discriminator on the body so both surfaces share the same endpoint
 * (single audit path, single test target). Reason is optional (sites are
 * org structural data, not patient data) but encouraged for the archive
 * direction — captured in audit metadata when supplied.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { id } = await params;
  const site = await prisma.site.findFirst({
    where: { id, orgId: authorizationUser.orgId },
  });
  if (!site) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(site.orgId, authorizationUser.orgId);

  const archiving = parsed.data.action === 'archive';
  if (archiving === site.isArchived) {
    return NextResponse.json(
      {
        error: {
          code: site.isArchived ? 'already_archived' : 'already_active',
        },
      },
      { status: 409 },
    );
  }

  const updated = await prisma.site.update({
    where: { id },
    data: {
      isArchived: archiving,
      archivedAt: archiving ? new Date() : null,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: archiving ? 'SITE_ARCHIVED' : 'SITE_UNARCHIVED',
    resourceType: 'Site',
    resourceId: updated.id,
    metadata: {
      name: updated.name,
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    },
  });

  return NextResponse.json({ data: updated });
}
