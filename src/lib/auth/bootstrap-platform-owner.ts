/**
 * Platform-owner bootstrap (env-driven, idempotent).
 *
 * Production day-1 has a chicken-and-egg: the platform owner is the only role
 * that can grant platform owner, but until someone IS one, nobody can. This
 * module breaks the loop from outside the app by reading
 * `BOOTSTRAP_PLATFORM_OWNER_EMAIL` and promoting that email if it exists.
 *
 * Triggered from two places:
 *   - `src/instrumentation.ts` — runs once per server boot.
 *   - `src/app/api/auth/signup/route.ts` — fires inline so an operator who
 *     signs up after deploy is elevated atomically (no reboot needed).
 *
 * Idempotent by design — refuses to fire if any `PLATFORM_OWNER` already
 * exists in the system. Operators rotating to a new owner email after launch
 * should use the future `/owner/users` elevation UI, NOT this env var.
 */

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import type { Prisma, PrismaClient } from '@prisma/client';

type Client = Prisma.TransactionClient | PrismaClient;

export type BootstrapResult =
  | { status: 'disabled' }
  | { status: 'already_bootstrapped'; existingOwnerUserId: string }
  | { status: 'waiting_for_user'; configuredEmail: string }
  | { status: 'elevated'; userId: string; email: string; source: 'startup' | 'signup' };

const ENV_VAR = 'BOOTSTRAP_PLATFORM_OWNER_EMAIL';

/**
 * Normalize the configured email the same way signup does (lowercase, trim).
 * Returns null when the env var is unset/blank.
 */
export function readBootstrapEmail(): string | null {
  const raw = process.env[ENV_VAR];
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Startup-path bootstrap: looks up the configured user, elevates them if
 * eligible. Safe to call on every server boot — early-returns when there's
 * nothing to do.
 *
 * Accepts an optional tx client so a caller already inside a transaction
 * (signup) can re-use it; defaults to the global `prisma` singleton.
 */
export async function bootstrapPlatformOwner(opts: {
  source: 'startup' | 'signup';
  /** Override the email source; signup passes the just-created user's email
   *  so the bootstrap looks up the right row even when env normalization
   *  differs from signup normalization. Defaults to readBootstrapEmail(). */
  email?: string | null;
  client?: Client;
} = { source: 'startup' }): Promise<BootstrapResult> {
  const client: Client = opts.client ?? prisma;
  const email = (opts.email ?? readBootstrapEmail())?.toLowerCase() ?? null;

  if (!email) return { status: 'disabled' };

  // Idempotency: never elevate if any platform owner already exists.
  // We don't compare emails here on purpose — once *someone* is the owner,
  // ongoing changes happen through the /owner UI, not the env var. This
  // avoids the env-var-as-source-of-truth footgun (e.g., demoting yourself
  // via UI and then having the next boot silently re-promote you).
  const existingOwner = await client.user.findFirst({
    where: { platformRole: 'PLATFORM_OWNER' },
    select: { id: true },
  });
  if (existingOwner) {
    return { status: 'already_bootstrapped', existingOwnerUserId: existingOwner.id };
  }

  const user = await client.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });
  if (!user) {
    return { status: 'waiting_for_user', configuredEmail: email };
  }

  await client.user.update({
    where: { id: user.id },
    data: { platformRole: 'PLATFORM_OWNER' },
  });

  await writeAuditLog({
    userId: user.id,
    action: 'PLATFORM_OWNER_BOOTSTRAPPED',
    resourceType: 'User',
    resourceId: user.id,
    metadata: { source: opts.source },
    tx: client,
  });

  return { status: 'elevated', userId: user.id, email: user.email, source: opts.source };
}
