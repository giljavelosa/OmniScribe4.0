import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { PatientAddressKind } from '@prisma/client';

export const runtime = 'nodejs';

const bodySchema = z.object({
  kind: z.enum(PatientAddressKind).default(PatientAddressKind.HOME),
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  postalCode: z.string().min(1),
  country: z.string().default('US'),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('PATIENT_MANAGEMENT');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }

  const { id } = await params;
  const patient = await prisma.patient.findFirst({
    where: { id, orgId: authorizationUser.orgId, isDeleted: false },
  });
  if (!patient) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  const address = await prisma.patientAddress.create({
    data: { patientId: id, ...parsed.data },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'PATIENT_ADDRESS_UPSERT',
    resourceType: 'PatientAddress',
    resourceId: address.id,
    metadata: { kind: parsed.data.kind, op: 'create' },
  });

  return NextResponse.json({ data: { id: address.id } });
}
