import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { Division, OrgRole, PlatformRole } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireAdminOrgRole } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { validatePassword } from '@/lib/auth/password-policy';

export const runtime = 'nodejs';

/**
 * POST /api/admin/users — admin creates a user directly with a pre-set password.
 *
 * Complements the invite flow at `POST /api/admin/invites`. Invites send a
 * one-time onboarding link and the user picks their own password; THIS route
 * lets the admin hand out credentials directly — useful for pilot trials where
 * email isn't reliably reachable, or testers who shouldn't have to navigate
 * an invite link. Both paths converge on the same User + OrgUser shape.
 *
 * Differences from invite:
 *   - No Invite row is created (the link-based handoff is skipped).
 *   - The admin chooses the password instead of the user. Same 12-char policy.
 *   - No email is sent. Admin shares credentials by their own channel.
 *   - The audit row records `via: 'admin_direct'` so the auditor can
 *     distinguish admin-set passwords from user-set ones — relevant for
 *     "did the admin briefly know this user's credential?" questions.
 *
 * No Seat is auto-created — same as the invite flow. Seats are Stripe-owned
 * when Stripe is configured; assigned later from /admin/seats. When Stripe is
 * unconfigured (the pilot / trial posture), the seat gate is inert anyway
 * (`src/lib/authz/seat.ts`), so the new user can record visits immediately.
 *
 * TEAM_MEMBERS_MANAGE-gated (ORG_ADMIN / SITE_ADMIN). Mirrors the invite
 * route's role allowlist: only CLINICIAN / VIEWER / SITE_ADMIN are creatable.
 * ORG_ADMIN elevation is reserved for org provisioning (signup / owner
 * console), never the team-members surface.
 */

const INVITABLE_ROLES: OrgRole[] = [OrgRole.CLINICIAN, OrgRole.VIEWER, OrgRole.SITE_ADMIN];

const bodySchema = z.object({
  email: z.email().transform((s) => s.toLowerCase()),
  password: z.string().min(1).max(128),
  role: z.enum(OrgRole).refine((r) => INVITABLE_ROLES.includes(r), {
    message: 'Only Clinician, Non-clinician, and Site admin roles can be created.',
  }),
  division: z.enum(Division),
  name: z.string().min(1).max(200).optional(),
  profession: z.string().min(1).max(200).optional(),
  canManagePatients: z.boolean().optional(),
});

export async function POST(req: Request) {
  const guard = await requireAdminOrgRole();
  if ('error' in guard) return guard.error;
  const { user: actor, orgUser: actorOrgUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const policy = validatePassword(data.password);
  if (!policy.ok) {
    return NextResponse.json(
      { error: { code: 'weak_password', message: policy.reason } },
      { status: 400 },
    );
  }

  // Email-uniqueness — refuse on any existing User row, even one in another
  // org. Cross-org membership is a real use case but adding it here mixes a
  // "create user" path with an "add existing user to my org" path, and the
  // latter has a different security posture (cannot reset their password,
  // for instance). Keep this route to the single-org first-touch case;
  // existing users can be onboarded via the invite flow.
  const existing = await prisma.user.findUnique({
    where: { email: data.email },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ error: { code: 'email_in_use' } }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  const created = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email: data.email,
        name: data.name,
        passwordHash,
        platformRole: PlatformRole.NONE,
      },
    });
    const newOrgUser = await tx.orgUser.create({
      data: {
        userId: newUser.id,
        orgId: actorOrgUser.orgId,
        role: data.role,
        division: data.division,
        profession: data.profession,
        canManagePatients: data.canManagePatients ?? false,
        isActive: true,
      },
    });
    return { user: newUser, orgUser: newOrgUser };
  });

  await writeAuditLog({
    userId: created.user.id,
    actingUserId: actor.id,
    orgId: actorOrgUser.orgId,
    action: 'USER_CREATED',
    resourceType: 'User',
    resourceId: created.user.id,
    metadata: {
      via: 'admin_direct',
      role: data.role,
      division: data.division,
      hasName: Boolean(data.name),
      hasProfession: Boolean(data.profession),
      canManagePatients: data.canManagePatients ?? false,
    },
  });

  return NextResponse.json(
    {
      data: {
        userId: created.user.id,
        orgUserId: created.orgUser.id,
        email: created.user.email,
      },
    },
    { status: 201 },
  );
}
