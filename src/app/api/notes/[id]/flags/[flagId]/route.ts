import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ReviewFlagStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

const patchSchema = z.object({
  status: z.enum(['RESOLVED', 'DISMISSED']),
  resolutionAction: z.enum(['ACCEPT_EDIT', 'DISMISS_KEEP', 'REGENERATE_SECTION']),
  resolutionNote: z.string().max(500).optional(),
});

/**
 * PATCH /api/notes/[id]/flags/[flagId] — resolve or dismiss a flag.
 *
 * Refuses 409 if already non-OPEN (idempotency — once resolved/dismissed,
 * a flag is closed; re-analyzing creates new rows).
 *
 * Audits FLAG_RESOLVED or FLAG_DISMISSED with the resolutionAction +
 * sectionId + severity for compliance dashboards.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; flagId: string }> },
) {
  const guard = await requireFeatureAccess('NOTE_EDIT');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { id: noteId, flagId } = await params;
  const flag = await prisma.reviewFlag.findUnique({ where: { id: flagId } });
  if (!flag || flag.noteId !== noteId) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(flag.orgId, authorizationUser.orgId);

  if (flag.status !== ReviewFlagStatus.OPEN) {
    return NextResponse.json(
      { error: { code: 'not_open', message: `Flag is already ${flag.status}.` } },
      { status: 409 },
    );
  }

  const updated = await prisma.reviewFlag.update({
    where: { id: flagId },
    data: {
      status: ReviewFlagStatus[parsed.data.status],
      resolutionAction: parsed.data.resolutionAction,
      resolutionNote: parsed.data.resolutionNote ?? null,
      resolvedAt: new Date(),
      resolvedByOrgUserId: authorizationUser.orgUserId,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: parsed.data.status === 'RESOLVED' ? 'FLAG_RESOLVED' : 'FLAG_DISMISSED',
    resourceType: 'ReviewFlag',
    resourceId: flagId,
    metadata: {
      noteId,
      sectionId: flag.sectionId,
      severity: flag.severity,
      resolutionAction: parsed.data.resolutionAction,
      hasResolutionNote: !!parsed.data.resolutionNote,
    },
  });

  return NextResponse.json({ data: updated });
}
