import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Profession } from '@prisma/client';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { divisionForProfession } from '@/lib/professions';

export const runtime = 'nodejs';

/**
 * POST /api/me/complete-profile
 *
 * Lets the signed-in clinician set their categorical professionType (the
 * profile-completion gate). Writes to the user's own OrgUser row only — no
 * cross-user access needed, so auth is just "signed in with an orgUser".
 *
 * Division is DERIVED from profession (divisionForProfession), never supplied by
 * the client — so a clinician's documented division always matches their scope of
 * practice (a PT can't complete their profile as MEDICAL). OTHER is refused
 * because it maps to no division.
 */
const bodySchema = z.object({
  professionType: z.nativeEnum(Profession).refine(
    (p) => p !== Profession.OTHER,
    { message: 'Profession "Other" is not allowed for recording clinicians — pick a concrete profession.' },
  ),
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

  const { professionType, profession } = parsed.data;

  // Division is derived from profession (never client-supplied). professionType is
  // guaranteed concrete (schema refuses OTHER) so this is always non-null; the
  // guard is belt-and-suspenders against a future enum gap.
  const division = divisionForProfession(professionType);
  if (!division) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'Profession has no clinical division.' } },
      { status: 400 },
    );
  }

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
