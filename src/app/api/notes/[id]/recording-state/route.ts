import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { NoteStatus } from '@prisma/client';

export const runtime = 'nodejs';

const bodySchema = z.object({
  action: z.enum(['pause', 'resume']),
});

/**
 * POST /api/notes/[id]/recording-state — best-effort pause/resume audit hook.
 * The browser still owns the actual mic stream; this endpoint just records
 * the lifecycle event + flips Note.status between RECORDING and PAUSED so
 * other surfaces (admin views, future watchdog) can see the state.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_CREATE');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }

  const { id } = await params;
  const note = await prisma.note.findFirst({
    where: { id, orgId: authorizationUser.orgId },
    select: { id: true, status: true, clinicianOrgUserId: true },
  });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  if (note.clinicianOrgUserId !== authorizationUser.orgUserId && authorizationUser.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  const action = parsed.data.action;
  const next = action === 'pause' ? NoteStatus.PAUSED : NoteStatus.RECORDING;

  // Only transition between RECORDING / PAUSED — leave terminal states alone.
  if (note.status !== NoteStatus.RECORDING && note.status !== NoteStatus.PAUSED) {
    return NextResponse.json({ error: { code: 'invalid_state' } }, { status: 409 });
  }

  await prisma.note.update({ where: { id: note.id }, data: { status: next } });

  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: action === 'pause' ? 'RECORDING_PAUSED' : 'RECORDING_RESUMED',
    resourceType: 'Note',
    resourceId: note.id,
  });

  return NextResponse.json({ data: { ok: true, status: next } });
}
