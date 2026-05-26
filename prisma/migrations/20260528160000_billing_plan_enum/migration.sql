-- BillingPlan — public pricing tier SKUs (2026-05-25).
--
-- Distinct from the legacy SubscriptionPlan enum (STARTER/PROFESSIONAL/
-- ENTERPRISE/CUSTOM) which is owner-console editable for sales overrides
-- and predates the public pricing model. Both columns coexist by design:
-- `billingPlan` is the SKU the customer pays for via Stripe and drives
-- seat caps + draft bundles + Stripe usage reporting.
--
-- Mapping to Stripe Product/Price IDs is documented in
-- references/strategic/stripe-pricing-skus.md.

CREATE TYPE "BillingPlan" AS ENUM (
    'TRIAL',
    'SOLO_STARTER',
    'SOLO_PRO',
    'SOLO_POWER',
    'SOLO_UNLIMITED',
    'DUO',
    'PRACTICE',
    'ENTERPRISE'
);

ALTER TABLE "Organization"
    ADD COLUMN "billingPlan" "BillingPlan" NOT NULL DEFAULT 'TRIAL',
    ADD COLUMN "stripeSubscriptionId" TEXT;
