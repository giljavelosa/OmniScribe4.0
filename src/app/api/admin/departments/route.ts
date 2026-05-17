import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireAdminOrgRole } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { Division } from '@prisma/client';

export const runtime = 'nodejs';

const createSchema = z.object({
  name: z.string().min(1),
  division: z.enum(Division),
  siteId: z.string().optional(),
  intakeFormSchema: z.record(z.string(), z.unknown()).optional(),
});

export async function GET() {
  const guard = await requireAdminOrgRole();
  if ('error' in guard) return guard.error;
  const { orgUser } = guard;

  const departments = await prisma.department.findMany({
    where: { orgId: orgUser.orgId },
    orderBy: [{ division: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { enrollments: true, intakes: true, encounters: true } } },
  });
  return NextResponse.json({ data: departments });
}

export async function POST(req: Request) {
  const guard = await requireAdminOrgRole();
  if ('error' in guard) return guard.error;
  const { user, orgUser } = guard;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }

  const dept = await prisma.department.create({
    data: {
      orgId: orgUser.orgId,
      name: parsed.data.name,
      division: parsed.data.division,
      siteId: parsed.data.siteId,
      intakeFormSchema: parsed.data.intakeFormSchema as object | undefined,
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'DEPARTMENT_CREATED',
    resourceType: 'Department',
    resourceId: dept.id,
    metadata: { division: dept.division },
  });

  return NextResponse.json({ data: { id: dept.id } });
}
