# Unit 38: Stripe Subscriptions — Live Pipeline

> **Wave 7 — Billing & subscriptions.** Retroactive spec for work shipped 2026-05-19 (post–Unit 37 follow-up PR stack). Canonical home for all Stripe checkout / webhook / portal behavior.

## Goal

Replace Unit 09's stub-mode seat allocation with a real Stripe subscription flow: org admins subscribe via Checkout, seats are materialized only through the verified webhook, admins assign seats to clinicians in-app, and clinicians cannot start visits without an assigned seat when Stripe is configured.

## Design

- **`/admin/billing`** — Subscribe (Checkout) + Manage billing (Customer Portal) CTAs; stub banner when `STRIPE_SECRET_KEY` unset
- **`/admin/seats`** — assign / revoke only (seats are Stripe-owned; no manual allocate)
- Owner console cross-org seat view unchanged from Unit 09 (`/owner/orgs/[id]`)

### Subscription model

One Stripe subscription per org. Line-item `quantity` = seat count. Webhook is the **only** path that creates or deactivates `Seat` rows.

### Enforcement

`checkClinicianSeat` gates `/api/encounters`, `/api/schedules/[id]/start`, and telehealth session start. **Inert when Stripe is unconfigured** so dev / non-billing deploys are never blocked.

## Implementation

### Schema (migration `20260519150000_seat_subscription_fields`)

- `Seat.isActive` — webhook soft-deactivates on downgrade/cancel (never hard-deletes)
- `Seat.stripeSubId` — reconciliation key
- `SeatTransfer` — append-only assign / reassign / revoke trail

### APIs

| Route | Purpose |
|---|---|
| `POST /api/billing/checkout` | Stripe Checkout Session with `subscription_data.metadata.orgId` |
| `POST /api/webhooks/stripe` | Signature-verified; `reconcileSeats` diffs quantity vs active seats |
| `POST /api/billing/portal` | Customer Portal redirect |
| `POST /api/admin/seats` | Action-based `assign` / `revoke` only (legacy allocate POST removed) |

### Services

- `src/lib/stripe/{env,client}.ts` — config + SDK client
- `src/services/billing/stripe.ts` — owner-console stub path retained for cross-org ops

### Audit actions

`STRIPE_CHECKOUT_STARTED`, `STRIPE_SUBSCRIPTION_UPDATED`, `STRIPE_SUBSCRIPTION_CANCELED`, `STRIPE_PAYMENT_FAILED`, `STRIPE_BILLING_PORTAL_OPENED`, `SEAT_ASSIGNED`

## Dependencies

- Unit 01 — `Seat` model, `OrgUser.seatId`
- Unit 09 — owner seat surfaces, stub Stripe wrapper, audit action union

## Verify when done

- [ ] Checkout → webhook → N active `Seat` rows where N = subscription quantity
- [ ] Downgrade deactivates unassigned seats; assigned seats untouched until revoke
- [ ] Assign links seat to clinician; revoke frees it; `SeatTransfer` + audit trail complete
- [ ] Clinician without assigned seat gets blocked at visit start when Stripe configured
- [ ] Dev without `STRIPE_SECRET_KEY` — full app usable; gate inert
- [ ] Webhook rejects unsigned payloads
