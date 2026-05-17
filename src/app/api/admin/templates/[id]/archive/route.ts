import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

const bodySchema = z.object({
  action: z.enum(['archive', 'unarchive']),
});

/**
 * POST /api/admin/templates/[id]/archive — soft-archive or restore.
 *
 * Presets (isPreset=true, orgId=null) cannot be archived — return 403
 * preset_readonly. Archived templates don't surface in the picker but
 * the row stays so historical notes still resolve their template.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('TEMPLATE_LIBRARY_MANAGE');
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
  const template = await prisma.noteTemplate.findUnique({ where: { id } });
  if (!template) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  if (template.isPreset || template.orgId === null) {
    return NextResponse.json(
      { error: { code: 'preset_readonly' } },
      { status: 403 },
    );
  }
  assertOrgScoped(template.orgId, authorizationUser.orgId);

  const archiving = parsed.data.action === 'archive';
  if (archiving === template.isArchived) {
    return NextResponse.json(
      { error: { code: archiving ? 'already_archived' : 'already_active' } },
      { status: 409 },
    );
  }

  const updated = await prisma.noteTemplate.update({
    where: { id },
    data: {
      isArchived: archiving,
      archivedAt: archiving ? new Date() : null,
      archivedByOrgUserId: archiving ? authorizationUser.orgUserId : null,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: archiving ? 'TEMPLATE_ARCHIVED' : 'TEMPLATE_UNARCHIVED',
    resourceType: 'NoteTemplate',
    resourceId: id,
    metadata: { name: template.name, division: template.division },
  });

  return NextResponse.json({ data: updated });
}
