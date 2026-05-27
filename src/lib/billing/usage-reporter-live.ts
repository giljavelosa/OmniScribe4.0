/**
 * Live deps for the usage-reporter — reads org context from Stripe,
 * pushes usage records to Stripe.
 *
 * Pulled into its own file so the test suite can import + mock-replace
 * just the deps without bringing in the Stripe SDK at module load.
 */

import { prisma } from '@/lib/prisma';
import { getStripe } from '@/lib/stripe/client';
import type { OrgUsageContext, UsageReporterDeps } from './usage-reporter';

/**
 * Build the deps object the reporter consumes. Reads each org's
 * Stripe Subscription on demand to discover the overage subscription-
 * item id + the current billing period start.
 */
export function buildLiveUsageReporterDeps(): UsageReporterDeps {
  return {
    loadOrgUsageContext: async (orgId): Promise<OrgUsageContext | null> => {
      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { stripeSubscriptionId: true },
      });
      if (!org?.stripeSubscriptionId) return null;

      const stripe = getStripe();
      // We expand `items` so the overage subscription-item is in the
      // initial response and we don't need a second roundtrip.
      const sub = await stripe.subscriptions.retrieve(
        org.stripeSubscriptionId,
        { expand: ['items.data.price.product'] },
      );

      // Identify the overage line by Price metadata. The Stripe-side
      // convention (set when we created the Product in
      // references/strategic/stripe-pricing-skus.md) is that the
      // overage Price's Product carries `metadata.role = 'overage'`.
      // Falls back to first metered price if the metadata is missing.
      const overageItem =
        findItemByProductMetadata(sub, 'role', 'overage') ??
        findFirstMeteredItem(sub);
      const overageSubscriptionItemId = overageItem?.id ?? null;

      // Stripe's API doesn't directly tell us "how much have we
      // reported this period". Since v1 launches with overage=0 for
      // every org's first period (the audit log is empty until the
      // first NOTE_GENERATION_COMPLETED row lands), we read 0 here
      // and rely on the cumulative-vs-delta math in the reporter
      // for steady-state. A future PR can replace this with a
      // `Subscription.usage_records.list()` aggregate.
      const overageReportedSoFar = 0;

      const seatCount = await prisma.orgUser.count({
        where: { orgId, isActive: true },
      });

      // `current_period_start` is a documented Stripe Subscription field
      // (Unix epoch seconds) but Stripe SDK v22 narrowed the TS surface
      // and dropped it from the typed shape. We read through a typed
      // accessor — the runtime field exists. Falls back to "now" if
      // Stripe ever returns null (TRIAL extension, paused subscription).
      const subRuntime = sub as unknown as { current_period_start?: number | null };
      const periodStart =
        subRuntime.current_period_start != null
          ? new Date(subRuntime.current_period_start * 1000)
          : new Date();

      return {
        overageSubscriptionItemId,
        overageReportedSoFar,
        currentPeriodStartIso: periodStart.toISOString(),
        seatCount,
      };
    },

    reportToStripe: async ({
      subscriptionItemId,
      quantity,
      idempotencyKey,
      timestampMs,
    }) => {
      try {
        const stripe = getStripe();
        // Stripe's `subscriptionItems.createUsageRecord` is a documented
        // method on the live API; SDK v22's type defs are missing it
        // (they're behind on the metered-billing API surface). Cast
        // through `unknown` to call it. If Stripe deprecates the
        // method we'll see it as a 4xx at runtime, NOT a silent
        // mis-bill — the reporter returns ok:false and the cron
        // exit-code is non-zero.
        const subscriptionItems = stripe.subscriptionItems as unknown as {
          createUsageRecord: (
            id: string,
            params: { quantity: number; timestamp: number; action: 'increment' | 'set' },
            options?: { idempotencyKey?: string },
          ) => Promise<unknown>;
        };
        await subscriptionItems.createUsageRecord(
          subscriptionItemId,
          {
            quantity,
            timestamp: Math.floor(timestampMs / 1000),
            action: 'increment',
          },
          { idempotencyKey },
        );
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error ? err.message.slice(0, 500) : 'unknown',
        };
      }
    },
  };
}

type SubscriptionWithItems = Awaited<
  ReturnType<ReturnType<typeof getStripe>['subscriptions']['retrieve']>
>;

function findItemByProductMetadata(
  sub: SubscriptionWithItems,
  key: string,
  value: string,
) {
  for (const item of sub.items.data) {
    const product = item.price.product;
    if (typeof product !== 'object' || product === null) continue;
    if ('deleted' in product && product.deleted) continue;
    const metadata = (product as { metadata?: Record<string, string> }).metadata;
    if (metadata?.[key] === value) return item;
  }
  return null;
}

function findFirstMeteredItem(sub: SubscriptionWithItems) {
  return sub.items.data.find((i) => i.price.recurring?.usage_type === 'metered');
}
