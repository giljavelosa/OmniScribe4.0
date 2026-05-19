/**
 * Next.js instrumentation hook — runs once per server runtime boot.
 *
 * Use sparingly: anything in here delays first-request handling. Today we
 * only run the platform-owner bootstrap (env-driven, idempotent — early-
 * returns when there's nothing to do).
 *
 * Errors are swallowed + logged so a bootstrap problem (DB unreachable at
 * boot, etc.) never crashes the server. The audit-log discipline (rule 8 —
 * never swallow audit errors) doesn't apply here because the bootstrap
 * function ITSELF wraps its audit write inside the elevation call; if we
 * crash here we'd take the whole server down without serving traffic.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { bootstrapPlatformOwner } = await import('@/lib/auth/bootstrap-platform-owner');
  try {
    const result = await bootstrapPlatformOwner({ source: 'startup' });
    switch (result.status) {
      case 'disabled':
        // No env var set — quiet. Most likely path in dev (seed handles it).
        return;
      case 'already_bootstrapped':
        console.info(
          `[bootstrap] platform owner already exists (userId=${result.existingOwnerUserId}); skipping`,
        );
        return;
      case 'waiting_for_user':
        console.info(
          `[bootstrap] BOOTSTRAP_PLATFORM_OWNER_EMAIL=${result.configuredEmail} configured but ` +
            `no matching User row yet — will elevate when that account signs up`,
        );
        return;
      case 'elevated':
        console.info(
          `[bootstrap] elevated user ${result.email} (id=${result.userId}) to PLATFORM_OWNER via ${result.source}`,
        );
        return;
    }
  } catch (err) {
    console.error('[bootstrap] platform-owner bootstrap failed:', err);
  }
}
