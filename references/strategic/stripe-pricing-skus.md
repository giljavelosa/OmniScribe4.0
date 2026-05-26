# Stripe Pricing — SKUs, Products, and Prices

> Source of truth for the Stripe-side configuration that backs OmniScribe's
> public pricing page. Pair with `prisma/schema.prisma` (`BillingPlan` enum)
> and `src/lib/billing/plan-policy.ts` (seat caps + draft bundles).

Last revised: **2026-05-26** (initial draft alongside the BillingPlan migration).

---

## Decision summary

After the cost-basis correction (Soniox real-time at $0.12/hr, not the
$0.90/hr I'd assumed), per-draft marginal cost is **~$0.55**. That makes
the published ladder profitable at every tier:

| Tier | Price/mo | Drafts incl. | Overage | Right-fit margin (@ $0.55 cost) |
|---|---|---|---|---|
| Solo Starter | $99 | 60 | $1.99 | 67% |
| Solo Pro | $179 | 160 | $1.49 | 51% |
| Solo Power | $299 | 300 | $1.29 | 45% |
| Solo Unlimited (optional) | $349 | unlimited | — | 53% at 300, 21% at 500 |
| Duo (per seat) | $149 × 2 = $298 | 120/seat | $1.49 | ~45% |
| Practice 3–9 (per seat) | $179 | 160/seat | $1.49 | ~50% |
| Practice 10–24 (per seat) | $159 | 160/seat | $1.29 | ~45% |
| Practice 25–49 (per seat) | $139 | 160/seat | $1.29 | ~40% |
| Enterprise | Custom | Custom | Custom | Negotiated |

Annual prepay = **17% off** all tiers. Solo Pro annual = $149/mo equivalent.

---

## Stripe Product + Price configuration

**Mode**: Stripe live + test environments. Configure in test first, copy ids
to `.env.example` placeholders, then duplicate to live before launch.

### Solo tier

Each Solo SKU is **one** Stripe Product with **two** Prices (monthly + annual)
plus **one metered Price** for overage drafts.

#### Product: `OmniScribe Solo Starter`

- **Stripe Product name**: `OmniScribe Solo Starter`
- **Description**: `Solo subscription — 60 drafts/month included.`
- **Statement descriptor**: `OMNISCRIBE STARTER`
- **Metadata**:
  ```json
  {
    "billingPlan": "SOLO_STARTER",
    "seatCap": "1",
    "draftsIncluded": "60",
    "overageRateCents": "199"
  }
  ```

Prices:

| Stripe Price ID env var | Type | Currency | Unit amount | Interval | Notes |
|---|---|---|---|---|---|
| `STRIPE_PRICE_SOLO_STARTER_MONTHLY` | recurring | usd | 9900 (= $99.00) | month | |
| `STRIPE_PRICE_SOLO_STARTER_ANNUAL` | recurring | usd | 99000 (= $990) | year | 17% off |
| `STRIPE_PRICE_SOLO_STARTER_OVERAGE` | recurring (metered, sum-aggregated) | usd | 199 (= $1.99) | month | `included_quantity` field — irrelevant in metered, kept at 0; the bundled 60 is enforced in app code via `plan-policy.ts` |

#### Product: `OmniScribe Solo Pro`

Metadata: `{ "billingPlan": "SOLO_PRO", "seatCap": "1", "draftsIncluded": "160", "overageRateCents": "149" }`

| Env var | Unit amount | Interval |
|---|---|---|
| `STRIPE_PRICE_SOLO_PRO_MONTHLY` | 17900 ($179) | month |
| `STRIPE_PRICE_SOLO_PRO_ANNUAL` | 179000 ($1,790) | year |
| `STRIPE_PRICE_SOLO_PRO_OVERAGE` | 149 ($1.49) | month, metered |

#### Product: `OmniScribe Solo Power`

Metadata: `{ "billingPlan": "SOLO_POWER", "seatCap": "1", "draftsIncluded": "300", "overageRateCents": "129" }`

| Env var | Unit amount | Interval |
|---|---|---|
| `STRIPE_PRICE_SOLO_POWER_MONTHLY` | 29900 ($299) | month |
| `STRIPE_PRICE_SOLO_POWER_ANNUAL` | 299000 ($2,990) | year |
| `STRIPE_PRICE_SOLO_POWER_OVERAGE` | 129 ($1.29) | month, metered |

#### Product: `OmniScribe Solo Unlimited` (optional, gated by demand)

Metadata: `{ "billingPlan": "SOLO_UNLIMITED", "seatCap": "1", "draftsIncluded": "-1", "overageRateCents": "0" }`

`draftsIncluded: "-1"` is the convention for unlimited. No metered overage line.

| Env var | Unit amount | Interval |
|---|---|---|
| `STRIPE_PRICE_SOLO_UNLIMITED_MONTHLY` | 34900 ($349) | month |
| `STRIPE_PRICE_SOLO_UNLIMITED_ANNUAL` | 349000 ($3,490) | year |

### Duo tier

#### Product: `OmniScribe Duo`

- **Description**: `Two-clinician partner practice — $149/seat, 120 drafts/seat.`
- **Metadata**:
  ```json
  {
    "billingPlan": "DUO",
    "seatCap": "2",
    "seatMin": "2",
    "draftsIncludedPerSeat": "120",
    "overageRateCents": "149"
  }
  ```

Prices use Stripe's per-seat model — the subscription line carries `quantity: 2` (locked at 2 in app code; Stripe Checkout doesn't natively cap at 2 for `quantity`, so app-layer enforcement is mandatory):

| Env var | Unit amount/seat | Interval |
|---|---|---|
| `STRIPE_PRICE_DUO_SEAT_MONTHLY` | 14900 ($149) | month |
| `STRIPE_PRICE_DUO_SEAT_ANNUAL` | 149000 ($1,490) | year |
| `STRIPE_PRICE_DUO_OVERAGE` | 149 ($1.49) | month, metered |

### Practice tier

Practice uses **three Stripe Products** (one per volume band) so the volume
discount maps cleanly to a Stripe Price ID. Customers move between Products
when their seat count crosses a threshold; the Stripe webhook fires
`subscription.updated` and our handler bumps `Organization.billingPlan` (it
stays `PRACTICE` regardless of band — only the Stripe Product changes).

#### Products

| Stripe Product | Seats | Per-seat price (monthly / annual) |
|---|---|---|
| `OmniScribe Practice 3–9` | 3–9 | $179 / $179,000-cents annual |
| `OmniScribe Practice 10–24` | 10–24 | $159 / $1,590 annual |
| `OmniScribe Practice 25–49` | 25–49 | $139 / $1,390 annual |

Metadata for each:

```json
{
  "billingPlan": "PRACTICE",
  "seatCap": "<upper bound>",
  "seatMin": "<lower bound>",
  "draftsIncludedPerSeat": "160",
  "overageRateCents": "149"  // 129 for the 10-24 + 25-49 bands
}
```

| Env var | Unit amount/seat | Interval |
|---|---|---|
| `STRIPE_PRICE_PRACTICE_3_9_MONTHLY` | 17900 ($179) | month |
| `STRIPE_PRICE_PRACTICE_3_9_ANNUAL` | 179000 | year |
| `STRIPE_PRICE_PRACTICE_3_9_OVERAGE` | 149 | month, metered |
| `STRIPE_PRICE_PRACTICE_10_24_MONTHLY` | 15900 ($159) | month |
| `STRIPE_PRICE_PRACTICE_10_24_ANNUAL` | 159000 | year |
| `STRIPE_PRICE_PRACTICE_10_24_OVERAGE` | 129 | month, metered |
| `STRIPE_PRICE_PRACTICE_25_49_MONTHLY` | 13900 ($139) | month |
| `STRIPE_PRICE_PRACTICE_25_49_ANNUAL` | 139000 | year |
| `STRIPE_PRICE_PRACTICE_25_49_OVERAGE` | 129 | month, metered |

### Enterprise

No Stripe Product. Negotiated contract per customer; Stripe Subscription
created manually by the platform owner with custom amounts. The Stripe
metadata still carries `billingPlan: ENTERPRISE` so usage-reporting still
runs (overage pricing is contract-defined; the worker reports the usage,
the contract resolves the math).

---

## Metered usage reporting

Each subscription's overage Price is **metered**, sum-aggregated. The daily
usage reporter (`scripts/billing-usage-report.ts`) computes:

```
overage = max(0, distinct_drafts_this_period - drafts_included_this_period)
```

…then calls `stripe.subscriptionItems.createUsageRecord(<overage_si_id>, {
quantity: overage_delta_since_last_report, action: 'increment' })`.

`distinct_drafts_this_period` is read from `AuditLog` rows where
`action === 'NOTE_GENERATION_COMPLETED'` and `createdAt >= currentPeriodStart`.

**Idempotency**: Stripe deduplicates usage records on `idempotency_key`. The
reporter uses `${orgId}-${YYYYMMDD}` so a second run on the same calendar
day is a no-op.

**Backfill on reporter outage**: missed days are reconciled on the next run
because we report the *delta from the last successful report*, not the
absolute count. The script tracks `Organization.lastUsageReportedAt` so a
24-hour outage just produces a slightly larger increment on the recovery
run.

---

## Webhook handling

`POST /api/stripe/webhook` (existing) handles `subscription.created`,
`subscription.updated`, `subscription.deleted`, `invoice.payment_failed`,
and `invoice.paid`. With BillingPlan added, the handler will additionally:

1. On `subscription.created` / `.updated`: read the Product's
   `metadata.billingPlan` and set `Organization.billingPlan` accordingly.
2. On `subscription.deleted`: set `Organization.billingPlan = TRIAL` and
   clear `stripeSubscriptionId`.
3. On `invoice.payment_failed`: existing audit row stays; no plan change
   (Stripe handles the dunning grace period).

---

## Test-mode bootstrap script (suggested)

Future work — `scripts/stripe-bootstrap.ts` could create all the products
and prices via the Stripe SDK so a fresh test environment can be set up in
one command:

```bash
npx tsx scripts/stripe-bootstrap.ts > .env.stripe.test
```

…would output `STRIPE_PRICE_*` env vars ready to source.

Not built yet (manual dashboard config is fine for the initial set-up of
~20 Price IDs); revisit if we ever need to re-create the catalog.

---

## Validation checklist (before launch)

- [ ] All 8 BillingPlan values in `BillingPlan` enum have a registered
      policy in `src/lib/billing/plan-policy.ts`.
- [ ] All `STRIPE_PRICE_*` env vars are set in production (and in
      `.env.example` documented).
- [ ] Stripe `subscription.created` webhook handler reads
      `metadata.billingPlan` and updates `Organization.billingPlan`.
- [ ] `scripts/billing-usage-report.ts` runs hourly in staging for ≥48 h
      with no errors, then daily in production at 06:00 UTC.
- [ ] `/admin/seats` UI refuses to add a 2nd user on Solo plans (returns
      "Upgrade to Duo or Practice").
- [ ] `/admin/seats` UI refuses to add a 3rd user on Duo plans (returns
      "Upgrade to Practice").
- [ ] `/account/usage` page renders for every BillingPlan (Trial, Solo,
      Duo, Practice, Enterprise).
- [ ] Pricing page on the marketing site references the SAME numbers as
      this doc + the Stripe prices.
