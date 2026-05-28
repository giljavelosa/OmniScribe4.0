/**
 * Live deps for visit-overage-reporter — discovers visit_overage metered
 * subscription items from Stripe capacity subscriptions.
 */

import { prisma } from '@/lib/prisma';
import { getStripe } from '@/lib/stripe/client';
import type { VisitOverageReporterDeps } from './visit-overage-reporter';

export function buildLiveVisitOverageReporterDeps(): VisitOverageReporterDeps {
  return {
    loadOrgContext: async (orgId) => {
      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { stripeSubscriptionId: true },
      });
      if (!org?.stripeSubscriptionId) return null;

      const stripe = getStripe();
      const sub = await stripe.subscriptions.retrieve(org.stripeSubscriptionId, {
        expand: ['items.data.price.product'],
      });

      const overageItem =
        findItemByProductMetadata(sub, 'role', 'visit_overage') ??
        findFirstMeteredItem(sub);
      const overageSubscriptionItemId = overageItem?.id ?? null;

      const subRuntime = sub as unknown as { current_period_start?: number | null };
      const periodStart =
        subRuntime.current_period_start != null
          ? new Date(subRuntime.current_period_start * 1000)
          : new Date();

      return {
        overageSubscriptionItemId,
        overageReportedSoFar: 0,
        currentPeriodStartIso: periodStart.toISOString(),
      };
    },

    reportToStripe: async ({ subscriptionItemId, quantity, idempotencyKey, timestampMs }) => {
      try {
        const stripe = getStripe();
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
          error: err instanceof Error ? err.message.slice(0, 500) : 'unknown',
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
