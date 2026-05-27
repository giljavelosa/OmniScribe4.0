import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { isOrgAdminRole } from '@/lib/authz/internal-authorization';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

const bodySchema = z.object({
  name: z.string().min(1).max(160),
  visibility: z.enum(['PERSONAL', 'TEAM', 'PUBLIC']),
});

/**
 * POST /api/admin/templates/[id]/clone — clone source → new row with
 * `version: 1` + `clonedFromId` pointing at the source. Body supplies a
 * new name + visibility for the clone.
 *
 * Anyone with TEMPLATE_LIBRARY_READ on the source can clone (including
 * cloning a preset into an org-scoped editable copy). The clone always
 * lands in the current org (orgId = current).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('TEMPLATE_LIBRARY_MANAGE', req);
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
  const source = await prisma.noteTemplate.findUnique({ where: { id } });
  if (!source) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  // Source must be visible to this org (preset OR same-org); PERSONAL
  // sources are visible only to their creator.
  const visible = (source.isPreset && source.orgId === null) || source.orgId === authorizationUser.orgId;
  if (!visible) return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  if (
    source.visibility === 'PERSONAL' &&
    source.createdByOrgUserId !== authorizationUser.orgUserId
  ) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  // Option A — non-admin clones land as PERSONAL (rule: they can't
  // publish team templates). Refuse rather than silently coerce so the
  // UI's optimistic state stays in sync with the server response.
  const isAdmin = isOrgAdminRole(authorizationUser.role);
  if (!isAdmin && parsed.data.visibility !== 'PERSONAL') {
    return NextResponse.json(
      {
        error: {
          code: 'visibility_forbidden',
          message: 'Only org admins can clone into TEAM templates. Use visibility: "PERSONAL".',
        },
      },
      { status: 403 },
    );
  }

  const clone = await prisma.noteTemplate.create({
    data: {
      orgId: authorizationUser.orgId,
      name: parsed.data.name,
      description: source.description,
      division: source.division,
      specialty: source.specialty,
      visibility: parsed.data.visibility,
      isPreset: false,
      sectionSchema: source.sectionSchema as never,
      promptHints: source.promptHints as never,
      sensitivityDefault: source.sensitivityDefault,
      version: 1,
      createdByOrgUserId: authorizationUser.orgUserId,
      clonedFromId: source.id,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'TEMPLATE_CLONED',
    resourceType: 'NoteTemplate',
    resourceId: clone.id,
    metadata: {
      sourceTemplateId: source.id,
      sourceName: source.name,
      sourceIsPreset: source.isPreset,
      sourceVersion: source.version,
      newVisibility: parsed.data.visibility,
    },
  });

  return NextResponse.json({ data: clone }, { status: 201 });
}
