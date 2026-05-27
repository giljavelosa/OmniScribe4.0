import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { requirePlatformOwner } from '@/lib/authz/platform';
import { writeAuditLog, writePlatformAuditLog } from '@/lib/audit/log';
import { sendTransactional } from '@/lib/email/transport';
import { buildInviteEmail } from '@/lib/email/templates/invite';
import { Division, ComplianceProfile, OrgRole } from '@prisma/client';

export const runtime = 'nodejs';
const INVITE_TTL_DAYS = 7;

const bodySchema = z.object({
  name: z.string().min(1),
  division: z.enum(Division),
  complianceProfile: z.enum(ComplianceProfile),
  billingEmail: z.email(),
  baaExecutedAt: z.string().min(1),
  baaVersion: z.string().min(1),
  initialAdminEmail: z.email(),
});

export async function POST(req: Request) {
  const guard = await requirePlatformOwner();
  if ('error' in guard) return guard.error;
  const { user } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'Missing required field. BAA fields are required.' } },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const baaDate = new Date(data.baaExecutedAt);
  if (Number.isNaN(baaDate.getTime())) {
    return NextResponse.json({ error: { code: 'bad_request', message: 'Invalid BAA date.' } }, { status: 400 });
  }

  const inviteToken = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const created = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: data.name,
        division: data.division,
        defaultDivision: data.division === Division.MULTI ? Division.MEDICAL : data.division,
        billingEmail: data.billingEmail,
        complianceProfile: data.complianceProfile,
        baaExecutedAt: baaDate,
        baaVersion: data.baaVersion,
        baaCountersignedBy: user.id,
      },
    });
    const invite = await tx.invite.create({
      data: {
        email: data.initialAdminEmail.toLowerCase(),
        orgId: org.id,
        role: OrgRole.ORG_ADMIN,
        division: data.division === Division.MULTI ? Division.MEDICAL : data.division,
        token: inviteToken,
        expiresAt,
        invitedByUserId: user.id,
      },
    });
    return { org, invite };
  });

  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const onboardUrl = `${base}/onboarding/${inviteToken}`;

  await sendTransactional(
    buildInviteEmail({
      to: data.initialAdminEmail,
      orgName: created.org.name,
      invitedByName: user.name ?? user.email,
      onboardUrl,
      expiresInDays: INVITE_TTL_DAYS,
    }),
  );

  await writeAuditLog({
    userId: user.id,
    orgId: created.org.id,
    action: 'ORG_CREATED',
    resourceType: 'Organization',
    resourceId: created.org.id,
    metadata: {
      division: data.division,
      complianceProfile: data.complianceProfile,
      baaVersion: data.baaVersion,
    },
  });
  await writePlatformAuditLog({
    actingUserId: user.id,
    action: 'PLATFORM_ORG_CREATED',
    resourceType: 'Organization',
    resourceId: created.org.id,
    metadata: { name: data.name, division: data.division },
  });

  return NextResponse.json({ data: { orgId: created.org.id, onboardUrl } });
}
