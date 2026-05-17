import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { readInferenceLog } from '@/lib/notes/section-status';

export const runtime = 'nodejs';

/**
 * GET /api/notes/[id]/sections/[sectionId]/diff?regenIndex=...
 *
 * Returns `{ previous, current, regeneratedAt, model, overwroteEdited }` for
 * the diff dialog. `regenIndex` is 0-based newest-first within the section's
 * regeneration history (defaults to 0 — the most recent).
 *
 * Audits `SECTION_DIFF_VIEWED` with the section id + regenIndex + the
 * presence of previousContent (whether it survived the per-section cap).
 *
 * Returns 404 when the regeneration entry has no captured previousContent
 * (it was trimmed out by the per-section cap, or this is a fresh
 * generate-note pass with no prior content).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; sectionId: string }> },
) {
  const guard = await requireFeatureAccess('NOTE_REVIEW');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id: noteId, sectionId } = await params;
  const url = new URL(req.url);
  const regenIndex = Math.max(0, Number(url.searchParams.get('regenIndex')) || 0);

  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId: authorizationUser.orgId },
    select: { orgId: true, inferenceLog: true, draftJson: true, finalJson: true, status: true },
  });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(note.orgId, authorizationUser.orgId);

  const log = readInferenceLog(note.inferenceLog);
  // Section regenerations, newest first.
  const sectionRegens = (log._regenerations ?? [])
    .filter((r) => r.sectionId === sectionId)
    .slice()
    .reverse();
  const entry = sectionRegens[regenIndex];
  if (!entry) {
    return NextResponse.json(
      { error: { code: 'no_history', message: 'No regeneration history for this section.' } },
      { status: 404 },
    );
  }
  if (entry.previousContent === undefined) {
    return NextResponse.json(
      {
        error: {
          code: 'previous_trimmed',
          message: 'Previous content was trimmed out of history (older than the cap).',
        },
      },
      { status: 404 },
    );
  }

  const draft = (note.draftJson as Record<string, { content: string }> | null) ?? {};
  const final = (note.finalJson as Record<string, { content: string }> | null) ?? {};
  const currentSource = note.status === 'SIGNED' ? final : draft;
  const currentContent = currentSource[sectionId]?.content ?? '';

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'SECTION_DIFF_VIEWED',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: {
      sectionId,
      regenIndex,
      hadPreviousContent: true,
    },
  });

  return NextResponse.json({
    data: {
      sectionId,
      regeneratedAt: entry.at,
      overwroteEdited: entry.overwroteEdited,
      previous: entry.previousContent,
      current: currentContent,
      regenCount: sectionRegens.length,
    },
  });
}
