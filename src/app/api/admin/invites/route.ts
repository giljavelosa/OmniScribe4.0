import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { requireAdminOrgRole } from '@/lib/authz/server';
import { sendTransactional } from '@/lib/email/transport';
import { buildInviteEmail } from '@/lib/email/templates/invite';
import { writeAuditLog } from '@/lib/audit/log';
import { OrgRole, Division, Profession } from '@prisma/client';
import { canAddOrgMember } from '@/lib/billing/commercial-mode';
import { divisionForProfession } from '@/lib/professions';

export const runtime = 'nodejs';

const INVITE_TTL_DAYS = 7;

/** Roles invitable via the team-members surface. ORG_ADMIN is intentionally
 *  excluded — that role is assigned only at org-provisioning time (owner
 *  console or public signup), never by invite. Platform-owner power lives on
 *  `User.platformRole = PLATFORM_OWNER`, entirely separate from OrgRole. */
const INVITABLE_ROLES: OrgRole[] = [OrgRole.CLINICIAN, OrgRole.VIEWER, OrgRole.SITE_ADMIN];

/** Recording-capable invite roles — these end up able to start a visit, so the
 *  invite MUST carry a concrete profession + division (note division is derived
 *  from the recording clinician's profession at visit start). VIEWER is
 *  read-only and exempt; it keeps whatever division the admin picked but never
 *  needs a profession. */
const RECORDING_INVITE_ROLES: OrgRole[] = [OrgRole.CLINICIAN, OrgRole.SITE_ADMIN];

const bodySchema = z
  .object({
    email: z.email().transform((s) => s.toLowerCase()),
    role: z.enum(OrgRole).refine((r) => INVITABLE_ROLES.includes(r), {
      message: 'Only Clinician, Non-clinician, and Site admin roles can be invited.',
    }),
    division: z.enum(Division),
    /** Categorical profession of the invitee. Required + concrete for recording
     *  roles (enforced in superRefine); omitted for VIEWER. */
    professionType: z.enum(Profession).optional(),
    profession: z.string().min(1).optional(),
    canManagePatients: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (!RECORDING_INVITE_ROLES.includes(data.role)) return;
    if (!data.professionType || data.professionType === Profession.OTHER) {
      ctx.addIssue({
        code: 'custom',
        path: ['professionType'],
        message:
          'A concrete profession is required for recording roles — "Other" is not allowed.',
      });
    }
    if (data.division === Division.MULTI) {
      ctx.addIssue({
        code: 'custom',
        path: ['division'],
        message:
          'Pick a concrete division for recording roles — MULTI is an org-aggregate value, not a clinician scope of practice.',
      });
    }
  });

export async function POST(req: Request) {
  const guard = await requireAdminOrgRole();
  if ('error' in guard) return guard.error;
  const { user, orgUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
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

  // Seat-cap gate (BillingPlan, 2026-05-26). Count "currently held seats"
  // as active OrgUsers + still-pending invites — otherwise an admin could
  // spam invites past the cap by sending them faster than recipients
  // accept. Each active OrgUser AND each unconsumed unexpired invite
  // represents one potential clinician seat the org has committed to.
  const [org, contract] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgUser.orgId },
      select: { billingPlan: true, name: true },
    }),
    prisma.organizationCommercialContract.findUnique({
      where: { orgId: orgUser.orgId },
      select: {
        commercialModel: true,
        capacityEnforcementEnabled: true,
        committedSeats: true,
        trialEndsAt: true,
        visitDebitOrder: true,
      },
    }),
  ]);
  if (!org) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  const [activeOrgUsers, pendingInvites] = await Promise.all([
    prisma.orgUser.count({
      where: { orgId: orgUser.orgId, isActive: true },
    }),
    prisma.invite.count({
      where: {
        orgId: orgUser.orgId,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
    }),
  ]);
  const currentSeatCount = activeOrgUsers + pendingInvites;
  const seatCheck = canAddOrgMember({
    billingPlan: org.billingPlan,
    contract,
    currentSeatCount,
  });
  if (!seatCheck.ok) {
    return NextResponse.json(
      {
        error: {
          code: 'seat_cap_reached',
          message: seatCheck.reason,
        },
        meta: {
          billingPlan: org.billingPlan,
          currentSeatCount,
          suggestPlan: seatCheck.suggestPlan,
        },
      },
      { status: 409 },
    );
  }

  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  // Division is DERIVED from profession for recording roles (so a PT invite can't
  // be filed under MEDICAL). VIEWER carries no profession and keeps the
  // admin-picked division — a read-only viewer can legitimately be scoped to any
  // division. This is the server-side source of truth; the admin form shows the
  // derived value read-only but never decides it.
  const recordingDivision =
    data.professionType && data.professionType !== Profession.OTHER
      ? divisionForProfession(data.professionType)
      : null;
  const inviteDivision = recordingDivision ?? data.division;

  const invite = await prisma.invite.create({
    data: {
      email: data.email,
      orgId: orgUser.orgId,
      role: data.role,
      division: inviteDivision,
      professionType: data.professionType ?? null,
      profession: data.profession,
      canManagePatients: data.canManagePatients ?? false,
      token,
      expiresAt,
      invitedByUserId: user.id,
    },
  });

  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const onboardUrl = `${base}/onboarding/${token}`;

  await sendTransactional(
    buildInviteEmail({
      to: data.email,
      orgName: org.name ?? 'OmniScribe',
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
    metadata: { role: data.role, division: inviteDivision, professionType: data.professionType ?? null },
  });

  return NextResponse.json({ data: { inviteId: invite.id, onboardUrl } });
}
