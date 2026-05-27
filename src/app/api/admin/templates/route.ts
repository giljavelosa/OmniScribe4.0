import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Division, NoteSensitivityLevel } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { isOrgAdminRole } from '@/lib/authz/internal-authorization';
import { writeAuditLog } from '@/lib/audit/log';
import { TemplateSectionSchemaList } from '@/lib/templates/section-schema';

export const runtime = 'nodejs';

const VISIBILITY = z.enum(['PERSONAL', 'TEAM', 'PUBLIC']);

const createSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(1000).nullable().optional(),
  division: z.enum(Division),
  specialty: z.string().max(120).nullable().optional(),
  visibility: VISIBILITY,
  sensitivityDefault: z.enum(NoteSensitivityLevel).optional(),
  sectionSchema: TemplateSectionSchemaList,
});

/**
 * GET /api/admin/templates?division=...&includeArchived=...
 *
 * Lists templates visible to the current org:
 *   - Platform presets (isPreset=true, orgId=null) — read-only
 *   - Org templates (orgId=current) — editable
 *   - PERSONAL templates filter to the requesting user only (orgUserId)
 *
 * Archived rows excluded unless `includeArchived=true`.
 */
export async function GET(req: Request) {
  const guard = await requireFeatureAccess('TEMPLATE_LIBRARY_READ');
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;

  const url = new URL(req.url);
  const division = url.searchParams.get('division');
  const includeArchived = url.searchParams.get('includeArchived') === 'true';

  const templates = await prisma.noteTemplate.findMany({
    where: {
      OR: [
        // Platform presets (visible to everyone, read-only).
        { isPreset: true, orgId: null },
        // Org templates (PERSONAL filtered to the requesting user).
        {
          orgId: authorizationUser.orgId,
          OR: [
            { visibility: { in: ['TEAM', 'PUBLIC'] } },
            { visibility: 'PERSONAL', createdByOrgUserId: authorizationUser.orgUserId },
          ],
        },
      ],
      ...(division ? { division: division as Division } : {}),
      ...(includeArchived ? {} : { isArchived: false }),
    },
    orderBy: [
      { isPreset: 'desc' }, // presets first
      { division: 'asc' },
      { name: 'asc' },
    ],
    include: {
      _count: { select: { notes: true, clones: true } },
    },
  });

  return NextResponse.json({
    data: templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      division: t.division,
      specialty: t.specialty,
      visibility: t.visibility,
      isPreset: t.isPreset,
      isArchived: t.isArchived,
      archivedAt: t.archivedAt?.toISOString() ?? null,
      sensitivityDefault: t.sensitivityDefault,
      version: t.version,
      clonedFromId: t.clonedFromId,
      createdByOrgUserId: t.createdByOrgUserId,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      notesCount: t._count.notes,
      clonesCount: t._count.clones,
    })),
  });
}

export async function POST(req: Request) {
  const guard = await requireFeatureAccess('TEMPLATE_LIBRARY_MANAGE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  // Section ids must be unique within the sectionSchema.
  const ids = new Set<string>();
  for (const s of parsed.data.sectionSchema.sections) {
    if (ids.has(s.id)) {
      return NextResponse.json(
        { error: { code: 'duplicate_section_id', message: `Section id "${s.id}" is duplicated.` } },
        { status: 400 },
      );
    }
    ids.add(s.id);
  }

  // Option A — non-admin callers may only create PERSONAL templates.
  // Reject (rather than silently coerce) so the UI doesn't end up with a
  // mismatched optimistic state vs server response.
  const isAdmin = isOrgAdminRole(authorizationUser.role);
  if (!isAdmin && parsed.data.visibility !== 'PERSONAL') {
    return NextResponse.json(
      {
        error: {
          code: 'visibility_forbidden',
          message: 'Only org admins can create TEAM templates. Use visibility: "PERSONAL".',
        },
      },
      { status: 403 },
    );
  }

  const created = await prisma.noteTemplate.create({
    data: {
      orgId: authorizationUser.orgId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      division: parsed.data.division,
      specialty: parsed.data.specialty ?? null,
      visibility: parsed.data.visibility,
      isPreset: false,
      sectionSchema: parsed.data.sectionSchema as never,
      sensitivityDefault: parsed.data.sensitivityDefault ?? 'STANDARD_CLINICAL',
      version: 1,
      createdByOrgUserId: authorizationUser.orgUserId,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'TEMPLATE_CREATED',
    resourceType: 'NoteTemplate',
    resourceId: created.id,
    metadata: {
      name: created.name,
      division: created.division,
      visibility: created.visibility,
      sectionCount: parsed.data.sectionSchema.sections.length,
    },
  });

  return NextResponse.json({ data: created }, { status: 201 });
}
