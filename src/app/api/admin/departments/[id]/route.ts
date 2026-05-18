import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAdminOrgRole } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { Division, Prisma } from '@prisma/client';

export const runtime = 'nodejs';

const patchSchema = z
  .object({
    name: z.string().min(1).optional(),
    division: z.enum(Division).optional(),
    siteId: z.string().nullable().optional(),
    intakeFormSchema: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no_fields' });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminOrgRole();
  if ('error' in guard) return guard.error;
  const { user, orgUser } = guard;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const { id } = await params;

  const before = await prisma.department.findFirst({ where: { id, orgId: orgUser.orgId } });
  if (!before) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  const updateData: Prisma.DepartmentUncheckedUpdateInput = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.division !== undefined) updateData.division = parsed.data.division;
  if (parsed.data.siteId !== undefined) updateData.siteId = parsed.data.siteId;
  if (parsed.data.intakeFormSchema !== undefined) {
    updateData.intakeFormSchema = (parsed.data.intakeFormSchema ?? Prisma.JsonNull) as Prisma.InputJsonValue;
  }
  await prisma.department.update({ where: { id }, data: updateData });

  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'DEPARTMENT_UPDATED',
    resourceType: 'Department',
    resourceId: id,
    metadata: { changedFields: Object.keys(parsed.data) },
  });

  return NextResponse.json({ data: { ok: true } });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminOrgRole();
  if ('error' in guard) return guard.error;
  const { user, orgUser } = guard;

  const { id } = await params;
  const dept = await prisma.department.findFirst({ where: { id, orgId: orgUser.orgId } });
  if (!dept) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  // Refuse to hard-delete if anything references it (rule 1 spirit — preserve
  // historical context). Unit 11 may add a soft-archive on Department.
  const counts = await prisma.department.findUnique({
    where: { id },
    select: { _count: { select: { enrollments: true, encounters: true, episodes: true, intakes: true } } },
  });
  const inUse =
    (counts?._count.enrollments ?? 0) +
      (counts?._count.encounters ?? 0) +
      (counts?._count.episodes ?? 0) +
      (counts?._count.intakes ?? 0) >
    0;
  if (inUse) {
    return NextResponse.json({ error: { code: 'in_use' } }, { status: 409 });
  }

  await prisma.department.delete({ where: { id } });

  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'DEPARTMENT_DELETED',
    resourceType: 'Department',
    resourceId: id,
  });

  return NextResponse.json({ data: { ok: true } });
}
