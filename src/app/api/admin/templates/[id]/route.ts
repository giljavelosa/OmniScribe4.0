import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Division, NoteSensitivityLevel } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { diffForAudit } from '@/lib/audit/diff';
import { TemplateSectionSchemaList } from '@/lib/templates/section-schema';

export const runtime = 'nodejs';

const VISIBILITY = z.enum(['PERSONAL', 'TEAM', 'PUBLIC']);

const patchSchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    description: z.string().max(1000).nullable().optional(),
    division: z.enum(Division).optional(),
    specialty: z.string().max(120).nullable().optional(),
    visibility: VISIBILITY.optional(),
    sensitivityDefault: z.enum(NoteSensitivityLevel).optional(),
    sectionSchema: TemplateSectionSchemaList.optional(),
    promptHints: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no_fields' });

const TEMPLATE_FIELDS = [
  'name',
  'description',
  'division',
  'specialty',
  'visibility',
  'sensitivityDefault',
] as const;

/**
 * GET /api/admin/templates/[id] — single template with clonedFrom chain.
 *
 * The chain is the version-history trail (Unit 13 §B): each row points
 * at the source it was cloned from; walking back gives the lineage.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('TEMPLATE_LIBRARY_READ');
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;

  const { id } = await params;
  const template = await prisma.noteTemplate.findUnique({
    where: { id },
    include: {
      clonedFrom: { select: { id: true, name: true, version: true } },
      _count: { select: { notes: true, clones: true } },
    },
  });
  if (!template) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  const visibleToOrg =
    (template.isPreset && template.orgId === null) ||
    template.orgId === authorizationUser.orgId;
  if (!visibleToOrg) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }
  if (template.orgId) assertOrgScoped(template.orgId, authorizationUser.orgId);
  // PERSONAL templates are visible only to the creator — enforce here so
  // GET-by-id can't bypass the list endpoint's PERSONAL filter.
  if (
    template.visibility === 'PERSONAL' &&
    template.createdByOrgUserId !== authorizationUser.orgUserId
  ) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  return NextResponse.json({ data: template });
}

/**
 * PATCH /api/admin/templates/[id] — update fields.
 *
 * Presets (orgId=null, isPreset=true) are read-only for non-owners; we
 * reject with 403 preset_readonly. Editing sectionSchema bumps version
 * by 1 — the row IS the latest version (clones preserve the prior).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('TEMPLATE_LIBRARY_MANAGE');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { id } = await params;
  const before = await prisma.noteTemplate.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  if (before.isPreset || before.orgId === null) {
    return NextResponse.json(
      { error: { code: 'preset_readonly', message: 'Preset templates are read-only; clone first to edit.' } },
      { status: 403 },
    );
  }
  assertOrgScoped(before.orgId, authorizationUser.orgId);
  if (
    before.visibility === 'PERSONAL' &&
    before.createdByOrgUserId !== authorizationUser.orgUserId
  ) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  // sectionSchema change bumps version.
  const sectionSchemaChanged =
    parsed.data.sectionSchema !== undefined &&
    JSON.stringify(parsed.data.sectionSchema) !== JSON.stringify(before.sectionSchema);

  // Section id uniqueness check.
  if (parsed.data.sectionSchema) {
    const ids = new Set<string>();
    for (const s of parsed.data.sectionSchema.sections) {
      if (ids.has(s.id)) {
        return NextResponse.json(
          { error: { code: 'duplicate_section_id' } },
          { status: 400 },
        );
      }
      ids.add(s.id);
    }
  }

  const after = await prisma.noteTemplate.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.division !== undefined ? { division: parsed.data.division } : {}),
      ...(parsed.data.specialty !== undefined ? { specialty: parsed.data.specialty } : {}),
      ...(parsed.data.visibility !== undefined ? { visibility: parsed.data.visibility } : {}),
      ...(parsed.data.sensitivityDefault !== undefined
        ? { sensitivityDefault: parsed.data.sensitivityDefault }
        : {}),
      ...(parsed.data.sectionSchema !== undefined
        ? { sectionSchema: parsed.data.sectionSchema as never }
        : {}),
      ...(parsed.data.promptHints !== undefined
        ? { promptHints: parsed.data.promptHints as never }
        : {}),
      ...(sectionSchemaChanged ? { version: before.version + 1 } : {}),
    },
  });

  const changes = diffForAudit(
    before as Record<string, unknown>,
    after as Record<string, unknown>,
    TEMPLATE_FIELDS,
  );
  if (sectionSchemaChanged) {
    changes.sectionSchema = {
      before: `version ${before.version}`,
      after: `version ${after.version}`,
    };
  }
  if (Object.keys(changes).length > 0) {
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'TEMPLATE_UPDATED',
      resourceType: 'NoteTemplate',
      resourceId: after.id,
      metadata: { changes, sectionSchemaChanged },
    });
  }

  return NextResponse.json({ data: after });
}
