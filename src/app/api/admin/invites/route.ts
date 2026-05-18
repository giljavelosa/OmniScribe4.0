import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { requireAdminOrgRole } from '@/lib/authz/server';
import { sendTransactional } from '@/lib/email/transport';
import { buildInviteEmail } from '@/lib/email/templates/invite';
import { writeAuditLog } from '@/lib/audit/log';
import { OrgRole, Division } from '@prisma/client';

export const runtime = 'nodejs';

const INVITE_TTL_DAYS = 7;

const bodySchema = z.object({
  email: z.email().transform((s) => s.toLowerCase()),
  role: z.enum(OrgRole),
  division: z.enum(Division),
  profession: z.string().min(1).optional(),
  canManagePatients: z.boolean().optional(),
});

export async function POST(req: Request) {
  const guard = await requireAdminOrgRole();
  if ('error' in guard) return guard.error;
  const { user, orgUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const data = parsed.data;

  const existingActive = await prisma.user.findUnique({
    where: { email: data.email },
    include: { orgUsers: { where: { orgId: orgUser.orgId } } },
  });
  if (existingActive?.orgUsers.length) {
    return NextResponse.json(
      { error: { code: 'already_member' } },
      { status: 409 },
    );
  }

  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const invite = await prisma.invite.create({
    data: {
      email: data.email,
      orgId: orgUser.orgId,
      role: data.role,
      division: data.division,
      profession: data.profession,
      canManagePatients: data.canManagePatients ?? false,
      token,
      expiresAt,
      invitedByUserId: user.id,
    },
  });

  const org = await prisma.organization.findUnique({ where: { id: orgUser.orgId } });
  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const onboardUrl = `${base}/onboarding/${token}`;

  await sendTransactional(
    buildInviteEmail({
      to: data.email,
      orgName: org?.name ?? 'OmniScribe',
      invitedByName: user.name ?? user.email,
      onboardUrl,
      expiresInDays: INVITE_TTL_DAYS,
    }),
  );

  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'INVITE_SENT',
    resourceType: 'Invite',
    resourceId: invite.id,
    metadata: { role: data.role, division: data.division },
  });

  return NextResponse.json({ data: { inviteId: invite.id, onboardUrl } });
}
