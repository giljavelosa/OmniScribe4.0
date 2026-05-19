import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Division, Profession } from '@prisma/client';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

/**
 * POST /api/me/complete-profile
 *
 * Lets the signed-in clinician set their categorical division +
 * professionType (the profile-completion gate). Writes to the user's
 * own OrgUser row only — no cross-user access needed, so auth is just
 * "signed in with an orgUser".
 *
 * Division MULTI is rejected: per spec it's the org-aggregate value,
 * not a per-clinician scope of practice. The picker hides it; this
 * endpoint enforces it on the server too.
 */
const bodySchema = z.object({
  division: z.nativeEnum(Division).refine(
    (d) => d !== Division.MULTI,
    { message: 'Division MULTI cannot be a per-clinician choice.' },
  ),
  professionType: z.nativeEnum(Profession),
  profession: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 });
  }
  if (!session.user.orgUserId || !session.user.orgId) {
    return NextResponse.json({ error: { code: 'no_org_membership' } }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { division, professionType, profession } = parsed.data;

  await prisma.orgUser.update({
    where: { id: session.user.orgUserId },
    data: {
      division,
      professionType,
      profession: profession ?? null,
    },
  });

  await writeAuditLog({
    userId: session.user.id,
    orgId: session.user.orgId,
    action: 'ORG_USER_PROFILE_COMPLETED',
    resourceType: 'OrgUser',
    resourceId: session.user.orgUserId,
    metadata: {
      division,
      professionType,
      hadFreeText: !!profession,
    },
  });

  return NextResponse.json({ data: { ok: true } });
}
