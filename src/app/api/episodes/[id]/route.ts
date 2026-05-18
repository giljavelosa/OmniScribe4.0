import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { diffForAudit } from '@/lib/audit/diff';

export const runtime = 'nodejs';

export const RECERT_INTERVAL_MIN = 7;
export const RECERT_INTERVAL_MAX = 365;

const patchSchema = z
  .object({
    diagnosis: z.string().min(1).max(280).optional(),
    bodyPart: z.string().max(120).nullable().optional(),
    recertIntervalDays: z.number().int().min(RECERT_INTERVAL_MIN).max(RECERT_INTERVAL_MAX).optional(),
    visitsAuthorized: z.number().int().min(0).max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no_fields' });

const EPISODE_FIELDS = [
  'diagnosis',
  'bodyPart',
  'recertIntervalDays',
  'visitsAuthorized',
] as const;

/**
 * PATCH /api/episodes/[id] — edit per-episode config.
 *
 * recertIntervalDays default is 90; min 7, max 365 enforced here so future
 * surfaces (template editor, owner-side policy) inherit the same bounds.
 *
 * Audits EPISODE_UPDATED with diffForAudit so only moved fields land.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('PATIENT_MANAGEMENT', req);
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
  const before = await prisma.episodeOfCare.findFirst({
    where: { id, orgId: authorizationUser.orgId },
  });
  if (!before) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(before.orgId, authorizationUser.orgId);

  const after = await prisma.episodeOfCare.update({
    where: { id },
    data: {
      ...(parsed.data.diagnosis !== undefined ? { diagnosis: parsed.data.diagnosis } : {}),
      ...(parsed.data.bodyPart !== undefined ? { bodyPart: parsed.data.bodyPart } : {}),
      ...(parsed.data.recertIntervalDays !== undefined
        ? { recertIntervalDays: parsed.data.recertIntervalDays }
        : {}),
      ...(parsed.data.visitsAuthorized !== undefined
        ? { visitsAuthorized: parsed.data.visitsAuthorized }
        : {}),
    },
  });

  const changes = diffForAudit(
    before as Record<string, unknown>,
    after as Record<string, unknown>,
    EPISODE_FIELDS,
  );
  if (Object.keys(changes).length > 0) {
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'EPISODE_UPDATED',
      resourceType: 'EpisodeOfCare',
      resourceId: id,
      metadata: { patientId: before.patientId, changes },
    });
  }

  return NextResponse.json({ data: after });
}
