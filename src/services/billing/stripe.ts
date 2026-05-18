import type { SeatTier } from '@prisma/client';

/**
 * Stripe billing service — stub-mode wrapper.
 *
 * Spec §D / Unit 09: when STRIPE_SECRET_KEY is unset we return a synthetic
 * "stub" subscription result so the seat-allocation API works end-to-end
 * in dev. When the key is set, the real Stripe SDK call would land here;
 * v1 keeps the stub path the production path until the first real Stripe
 * account lands — the seat-allocation route audits BOTH the stub and
 * real responses so the trail is consistent across modes.
 *
 * Pattern mirrors Soniox / S3 / Bedrock stub-mode helpers — single
 * source of truth, exported config flag for the health surface.
 */

export type UpsertSubscriptionInput = {
  orgId: string;
  seatCount: number;
  tier: SeatTier;
  expiresAt: Date;
};

export type UpsertSubscriptionResult = {
  /** Always present — stub uses a synthetic prefix, real Stripe returns the real id. */
  subscriptionId: string;
  /** 'active' | 'trialing' | 'past_due' etc. Stub always returns 'active'. */
  status: string;
  stub: boolean;
};

const SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? '';

export const stripeConfig = {
  isStubMode: !SECRET_KEY,
};

export async function upsertSubscription(input: UpsertSubscriptionInput): Promise<UpsertSubscriptionResult> {
  if (stripeConfig.isStubMode) {
    return {
      subscriptionId: `stub-${input.orgId}-${Date.now()}`,
      status: 'active',
      stub: true,
    };
  }
  // Real Stripe SDK call would land here. For v1 we throw a clear error so
  // anyone who sets STRIPE_SECRET_KEY without finishing the integration
  // sees the gap immediately rather than getting silent wrong behavior.
  throw new Error(
    'Real Stripe path not yet implemented. Unset STRIPE_SECRET_KEY to use stub mode, or land the real integration before invoking this code path.',
  );
}
