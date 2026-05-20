import Stripe from 'stripe';

/**
 * Lazily-constructed Stripe SDK client. Lazy so importing this module never
 * throws at load time in a Stripe-unconfigured environment (dev, CI) — the
 * client is built only when a billing route actually calls `getStripe()`.
 */
let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('getStripe: STRIPE_SECRET_KEY is not set');
  }
  client = new Stripe(key);
  return client;
}

/**
 * The recurring per-seat Stripe price IDs, one per tier. Getters (not plain
 * constants) so an unconfigured env doesn't throw at module load — only when
 * a checkout actually needs the id.
 */
export const PRICE_IDS = {
  get SOLO(): string {
    const id = process.env.STRIPE_SOLO_PRICE_ID;
    if (!id) throw new Error('PRICE_IDS.SOLO: STRIPE_SOLO_PRICE_ID is not set');
    return id;
  },
  get TEAM(): string {
    const id = process.env.STRIPE_TEAM_PRICE_ID;
    if (!id) throw new Error('PRICE_IDS.TEAM: STRIPE_TEAM_PRICE_ID is not set');
    return id;
  },
};
