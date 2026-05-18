import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { singleFieldChange } from '@/lib/audit/diff';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

const bodySchema = z.object({
  reason: z.string().min(10).max(500),
});

/**
 * POST /api/episodes/[id]/reopen — DISCHARGED → ACTIVE.
 *
 * Reason required (≥10 chars). Resets the recert cycle (re-opens with a
 * fresh due date based on the episode's recertIntervalDays). Does NOT
 * re-open closed-by-discharge follow-ups — those need to be re-created
 * manually if still relevant.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('PATIENT_MANAGEMENT');
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
  const episode = await prisma.episodeOfCare.findFirst({
    where: { id, orgId: authorizationUser.orgId },
  });
  if (!episode) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(episode.orgId, authorizationUser.orgId);

  if (episode.status !== 'DISCHARGED') {
    return NextResponse.json(
      {
        error: {
          code: 'not_discharged',
          message: `Only DISCHARGED episodes can be reopened (current: ${episode.status}).`,
        },
      },
      { status: 409 },
    );
  }

  const nextDue = new Date(Date.now() + episode.recertIntervalDays * 86_400_000);
  const updated = await prisma.episodeOfCare.update({
    where: { id },
    data: {
      status: 'ACTIVE',
      endedAt: null,
      recertDueAt: nextDue,
      reopenReason: parsed.data.reason,
    },
  });

  // Unit 34 — uniform `changes` shape for the audit-table diff renderer.
  // Reason text excluded (length only) per audit hygiene; status +
  // recertDueAt transitions captured as before/after.
  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'EPISODE_REOPENED',
    resourceType: 'EpisodeOfCare',
    resourceId: id,
    metadata: {
      changes: {
        ...singleFieldChange('status', episode.status, 'ACTIVE'),
        ...singleFieldChange('recertDueAt', episode.recertDueAt, nextDue),
      },
      patientId: episode.patientId,
      reasonLength: parsed.data.reason.length,
    },
  });

  return NextResponse.json({ data: updated });
}
