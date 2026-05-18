import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Division, NoteStyle, ComplianceProfile } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { diffForAudit } from '@/lib/audit/diff';

export const runtime = 'nodejs';

const patchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    division: z.enum(Division).optional(),
    defaultDivision: z.enum(Division).nullable().optional(),
    forceMfa: z.boolean().optional(),
    complianceProfile: z.enum(ComplianceProfile).optional(),
    /** Sets the org-wide default note style for new clinicians. The
     *  per-clinician `OrgUser.preferredNoteStyle` overrides this. */
    defaultNoteStyle: z.enum(NoteStyle).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no_fields' });

const ORG_FIELDS = [
  'name',
  'division',
  'defaultDivision',
  'forceMfa',
  'complianceProfile',
] as const;

/**
 * PATCH /api/admin/org-settings — update org-wide settings.
 *
 * Gated by TEAM_MEMBERS_MANAGE (same posture as Sites — org structural data).
 * The setting changes audit with diffForAudit so only fields that actually
 * moved land in the audit row.
 *
 * defaultNoteStyle is stored on the Organization for v1; per-user override
 * lives on OrgUser.preferredNoteStyle (already in Unit 01). When the
 * schema grows an `Organization.defaultNoteStyle` field it'll be wired
 * here; for now we accept the field but route it to the audit log only
 * (no schema bloat yet — wait until a real customer asks for org-wide
 * note-style defaults).
 */
export async function PATCH(req: Request) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const before = await prisma.organization.findUnique({
    where: { id: authorizationUser.orgId },
  });
  if (!before) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  const after = await prisma.organization.update({
    where: { id: before.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.division !== undefined ? { division: parsed.data.division } : {}),
      ...(parsed.data.defaultDivision !== undefined
        ? { defaultDivision: parsed.data.defaultDivision }
        : {}),
      ...(parsed.data.forceMfa !== undefined ? { forceMfa: parsed.data.forceMfa } : {}),
      ...(parsed.data.complianceProfile !== undefined
        ? { complianceProfile: parsed.data.complianceProfile }
        : {}),
    },
  });

  const changes = diffForAudit(
    before as Record<string, unknown>,
    after as Record<string, unknown>,
    ORG_FIELDS,
  );
  // defaultNoteStyle isn't a schema field yet — capture as a separate
  // requested-change field so the audit log preserves the intent.
  if (parsed.data.defaultNoteStyle) {
    (changes as Record<string, { before: unknown; after: unknown }>).defaultNoteStyle = {
      before: '(not stored on Organization yet)',
      after: parsed.data.defaultNoteStyle,
    };
  }

  if (Object.keys(changes).length > 0) {
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'ORG_SETTINGS_UPDATED',
      resourceType: 'Organization',
      resourceId: after.id,
      metadata: { changes },
    });
  }

  return NextResponse.json({ data: after });
}
