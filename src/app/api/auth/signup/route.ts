import { NextResponse } from 'next/server';
import { Division, OrgRole, ComplianceProfile, SeatTier, SubscriptionPlan } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { writeAuditLog, writePlatformAuditLog } from '@/lib/audit/log';
import { validatePassword } from '@/lib/auth/password-policy';
import { consumeSignupAttempt } from '@/lib/rate-limit';
import {
  hashIpForAudit,
  isTurnstileConfigured,
  verifyTurnstileToken,
} from '@/lib/captcha/turnstile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  email: z.email().transform((s) => s.toLowerCase()),
  password: z.string().min(1).max(128),
  orgName: z.string().min(1).max(200),
  division: z.enum(Division),
  /** Cloudflare Turnstile token; required when TURNSTILE_SECRET_KEY
   *  is set; ignored when unconfigured (dev). */
  captchaToken: z.string().optional(),
});

/**
 * POST /api/auth/signup — Unit 37.
 *
 * Public, anonymous. Self-serve org creation:
 *   1. Per-IP rate limit (5 attempts / 15 min).
 *   2. CAPTCHA verification when TURNSTILE_SECRET_KEY is set.
 *   3. Password policy validation.
 *   4. Email uniqueness check (returns 409 — no enumeration risk for
 *      a self-serve signup; pretending the email IS available would
 *      just make the next step fail anyway).
 *   5. Atomic transaction: Organization + User + OrgUser(ORG_ADMIN)
 *      + Seat. Default subscription = STARTER, compliance =
 *      STANDARD, no BAA.
 *   6. Audit ORG_SELF_PROVISIONED twice (org-scope + platform-scope).
 *      Metadata: orgName + division + ipHash + captchaUsed flag.
 *      IP is HASHED via crypto.subtle.digest (last-3 + SHA prefix)
 *      so repeat-IP signup detection works without storing raw IPs.
 *
 * Client signs in via NextAuth after this returns 201; new user
 * lands at /mfa-setup per the existing D2 enforcement chain.
 */
export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for')?.split(',')[0] ?? '').trim() || null;

  // 1. Rate limit.
  const rate = await consumeSignupAttempt(ip ?? 'unknown');
  if (!rate.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited', retryAfterSeconds: rate.retryAfterSeconds } },
      {
        status: 429,
        headers: { 'Retry-After': String(rate.retryAfterSeconds) },
      },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // 2. CAPTCHA.
  const captchaRequired = isTurnstileConfigured();
  if (captchaRequired) {
    if (!data.captchaToken) {
      return NextResponse.json(
        { error: { code: 'captcha_required' } },
        { status: 400 },
      );
    }
    const ok = await verifyTurnstileToken(data.captchaToken, ip);
    if (!ok) {
      return NextResponse.json(
        { error: { code: 'captcha_failed' } },
        { status: 400 },
      );
    }
  }

  // 3. Password policy.
  const pwResult = validatePassword(data.password);
  if (!pwResult.ok) {
    return NextResponse.json(
      { error: { code: 'password_policy', message: pwResult.reason } },
      { status: 400 },
    );
  }

  // 4. Email uniqueness.
  const existing = await prisma.user.findUnique({
    where: { email: data.email },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: { code: 'email_in_use' } },
      { status: 409 },
    );
  }

  // 5. Atomic transaction.
  const passwordHash = await bcrypt.hash(data.password, 10);
  const { org, user } = await prisma.$transaction(async (tx) => {
    const newOrg = await tx.organization.create({
      data: {
        name: data.orgName,
        division: data.division,
        billingEmail: data.email,
        subscriptionPlan: SubscriptionPlan.STARTER,
        complianceProfile: ComplianceProfile.STANDARD,
      },
    });
    const newUser = await tx.user.create({
      data: {
        email: data.email,
        passwordHash,
      },
    });
    await tx.orgUser.create({
      data: {
        orgId: newOrg.id,
        userId: newUser.id,
        role: OrgRole.ORG_ADMIN,
        division: data.division,
        isActive: true,
      },
    });
    // SOLO tier = single-clinician self-serve org. The owner can
    // upgrade to TEAM / ENTERPRISE when seats > 1 are needed.
    // expiresAt = 1 year out matches the existing seat-grant pattern.
    await tx.seat.create({
      data: {
        orgId: newOrg.id,
        tier: SeatTier.SOLO,
        expiresAt: new Date(Date.now() + 365 * 86_400_000),
      },
    });
    return { org: newOrg, user: newUser };
  });

  // 6. Audit.
  const ipHash = await hashIpForAudit(ip);
  const auditMeta = {
    orgId: org.id,
    orgName: org.name,
    division: data.division,
    ipHash,
    captchaUsed: captchaRequired,
  };
  await writeAuditLog({
    userId: user.id,
    orgId: org.id,
    action: 'ORG_SELF_PROVISIONED',
    resourceType: 'Organization',
    resourceId: org.id,
    metadata: auditMeta,
  });
  await writePlatformAuditLog({
    actingUserId: user.id,
    action: 'ORG_SELF_PROVISIONED',
    resourceType: 'Organization',
    resourceId: org.id,
    metadata: auditMeta,
  });

  return NextResponse.json(
    { data: { ok: true, orgId: org.id, userId: user.id } },
    { status: 201 },
  );
}
