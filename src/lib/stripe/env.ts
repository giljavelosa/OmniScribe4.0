/**
 * Stripe environment configuration.
 *
 * The four STRIPE_* vars are all required for the billing feature to
 * function — checkout, the webhook, and the customer portal each need a
 * subset, but `isStripeConfigured()` gates the whole feature as a unit so a
 * half-configured deploy fails loudly (routes return 501) rather than
 * silently provisioning nothing.
 */

/** True only when ALL four STRIPE_* vars are present and non-empty. */
export function isStripeConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
      process.env.STRIPE_WEBHOOK_SECRET &&
      process.env.STRIPE_SOLO_PRICE_ID &&
      process.env.STRIPE_TEAM_PRICE_ID,
  );
}

/**
 * Public origin for Stripe redirect URLs (checkout success/cancel, billing
 * portal return). Sourced from NEXTAUTH_URL — the app's canonical base URL —
 * with a localhost fallback for dev. Trailing slashes are trimmed so callers
 * can append `/path` safely.
 */
export function getPublicBaseUrl(): string {
  const raw = process.env.NEXTAUTH_URL?.trim();
  if (!raw) return 'http://localhost:3000';
  return raw.replace(/\/+$/, '');
}
