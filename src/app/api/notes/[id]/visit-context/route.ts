import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Division, NoteStyle } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

/**
 * PATCH /api/notes/[id]/visit-context — per-visit override of division,
 * template, and note style. Writes to Note.{division,templateId,noteStyle}
 * BEFORE the recording starts (status must still be PREPARING; downstream
 * status pins these for AI generation per spec §E).
 *
 * Refuses 409 once the note has moved past PREPARING — at that point the
 * division resolver has already locked + audit lens is committed.
 */
const bodySchema = z
  .object({
    division: z
      .nativeEnum(Division)
      .refine((d) => d !== Division.MULTI, {
        message: 'Division MULTI cannot be a per-visit choice.',
      })
      .optional(),
    templateId: z.string().min(1).nullable().optional(),
    noteStyle: z.nativeEnum(NoteStyle).optional(),
  })
  .refine(
    (v) =>
      v.division !== undefined ||
      v.templateId !== undefined ||
      v.noteStyle !== undefined,
    { message: 'Provide at least one of division / templateId / noteStyle.' },
  );

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireFeatureAccess('NOTE_EDIT');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id: noteId } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId: authorizationUser.orgId },
    select: {
      id: true,
      status: true,
      division: true,
      templateId: true,
      noteStyle: true,
      clinicianOrgUserId: true,
    },
  });
  if (!note) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  // Only the note's clinician (or a super-admin) may rewire its context.
  if (
    note.clinicianOrgUserId !== authorizationUser.orgUserId &&
    authorizationUser.role !== 'SUPER_ADMIN'
  ) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }
  // Once recording has started, the division/template/style are part of the
  // immutable record. Refuse rather than silently noop.
  if (note.status !== 'PREPARING') {
    return NextResponse.json(
      { error: { code: 'invalid_state', message: `Note is ${note.status}; visit context is locked once recording starts.` } },
      { status: 409 },
    );
  }

  // Profession lock: if the caller has a categorical profession set, the
  // visit's division is derived from it and is NOT user-changeable. Refuse
  // any division override that doesn't match. The UI hides the division
  // Select for this case; this is the server-side enforcement that prevents
  // curl/DevTools bypass.
  if (parsed.data.division !== undefined) {
    const clinician = await prisma.orgUser.findUnique({
      where: { id: authorizationUser.orgUserId },
      select: { professionType: true },
    });
    if (clinician?.professionType) {
      // Mapping is duplicated from the client; lives here too so the server
      // is authoritative (don't import client-only modules into a route).
      const TYPICAL: Partial<Record<string, Division>> = {
        MD: Division.MEDICAL, DO: Division.MEDICAL, NP: Division.MEDICAL,
        PA: Division.MEDICAL, RN: Division.MEDICAL,
        OT: Division.REHAB, PT: Division.REHAB, SLP: Division.REHAB,
        LCSW: Division.BEHAVIORAL_HEALTH, LMFT: Division.BEHAVIORAL_HEALTH,
        LPC: Division.BEHAVIORAL_HEALTH, PSYCHOLOGIST: Division.BEHAVIORAL_HEALTH,
      };
      const required = TYPICAL[clinician.professionType];
      if (required && parsed.data.division !== required) {
        return NextResponse.json(
          {
            error: {
              code: 'division_locked_by_profession',
              message: `Your profession (${clinician.professionType}) locks the visit division to ${required}.`,
            },
          },
          { status: 409 },
        );
      }
    }
  }

  // If the caller is changing division, validate that any supplied templateId
  // belongs to the new division (so we don't end up with a Medical SOAP
  // template on a Rehab note).
  const nextDivision = parsed.data.division ?? note.division;
  const nextTemplateId =
    parsed.data.templateId === undefined ? note.templateId : parsed.data.templateId;
  if (nextTemplateId) {
    const tmpl = await prisma.noteTemplate.findUnique({
      where: { id: nextTemplateId },
      select: { id: true, division: true, isArchived: true, isPreset: true, orgId: true },
    });
    if (!tmpl) {
      return NextResponse.json({ error: { code: 'template_not_found' } }, { status: 404 });
    }
    if (tmpl.isArchived) {
      return NextResponse.json({ error: { code: 'template_archived' } }, { status: 409 });
    }
    if (tmpl.division !== nextDivision) {
      return NextResponse.json(
        {
          error: {
            code: 'template_division_mismatch',
            message: `Template division (${tmpl.division}) does not match note division (${nextDivision}).`,
          },
        },
        { status: 409 },
      );
    }
    // Tenancy: presets are global (orgId=null) and OK for everyone; org
    // templates must match the caller's org.
    if (!tmpl.isPreset && tmpl.orgId !== authorizationUser.orgId) {
      return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
    }
  }

  const updated = await prisma.note.update({
    where: { id: noteId },
    data: {
      ...(parsed.data.division !== undefined && { division: parsed.data.division }),
      ...(parsed.data.templateId !== undefined && { templateId: parsed.data.templateId }),
      ...(parsed.data.noteStyle !== undefined && { noteStyle: parsed.data.noteStyle }),
    },
    select: { id: true, division: true, templateId: true, noteStyle: true, status: true },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'NOTE_VISIT_CONTEXT_CHANGED',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: {
      from: { division: note.division, templateId: note.templateId, noteStyle: note.noteStyle },
      to: { division: updated.division, templateId: updated.templateId, noteStyle: updated.noteStyle },
    },
  });

  return NextResponse.json({ data: updated });
}
