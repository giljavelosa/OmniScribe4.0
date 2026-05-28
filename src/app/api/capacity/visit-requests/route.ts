import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

const bodySchema = z.object({
  requestedVisits: z.number().int().min(1).max(500),
  message: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const guard = await requireFeatureAccess('VISITS_CREATE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const contract = await prisma.organizationCommercialContract.findUnique({
    where: { orgId: authorizationUser.orgId },
  });
  if (contract && !contract.allowUserVisitRequests) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'Visit requests are disabled for this organization.' } },
      { status: 403 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const row = await prisma.visitCapacityRequest.create({
    data: {
      orgId: authorizationUser.orgId,
      requesterOrgUserId: authorizationUser.orgUserId,
      requestedVisits: parsed.data.requestedVisits,
      message: parsed.data.message?.trim() || null,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'VISIT_REQUEST_CREATED',
    resourceType: 'VisitCapacityRequest',
    resourceId: row.id,
    metadata: { requestedVisits: parsed.data.requestedVisits },
  });

  return NextResponse.json({ data: { id: row.id, status: row.status } }, { status: 201 });
}
