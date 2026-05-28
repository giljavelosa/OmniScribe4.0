# Unit 51: Commercial capacity — visit bank, wallets, catalog & contracts

> **Wave 7 extension** (replaces / extends planned Unit 41 usage-billing scope for the visit-bank commercial model). Depends on Units 38–40 (Stripe pipeline, signup, plan-policy).

## Goal

Ship the **visit-bank commercial model** discussed in product planning:

1. **Platform owner catalog** — global defaults (monthly tiers, bundles, seat fees, trial limits).
2. **Per-org commercial contract** — enterprise deals (seats × term, $/seat, visits/seat/month, credit basis, rollover policy).
3. **Org bank + user wallets** — admin allocate/reclaim; debit on `NOTE_GENERATION_COMPLETED`.
4. **Capacity gate** — block new visit creation when no visits available (unless overage allowed).
5. **Visit requests** — clinicians request visits; org admin approve/deny (v1 workflow, not open chat).

Stripe catalog sync and checkout for bundles remain **follow-up PR**; this unit wires ledger + owner/admin surfaces + gates.

## Locked decisions

| # | Decision | Value |
|---|----------|-------|
| 1 | Billing event | One visit debited per distinct `NOTE_GENERATION_COMPLETED` (noteId idempotency). |
| 2 | Debit order | `USER_WALLET_THEN_BANK` default; `BANK_ONLY` org-wide pool option on contract. |
| 3 | Start-visit gate | Check capacity before `POST /api/encounters` (and schedule/telehealth start paths). |
| 4 | Enforcement | Active when org has `OrganizationCommercialContract` row; legacy orgs without contract skip gate (migration backfills Demo Clinic). |
| 5 | Catalog | Versioned `PlatformBillingCatalog`; exactly one `isActive=true` row; owner publishes new version. |
| 6 | Trial | `commercialModel=TRIAL`: solo 50 visits / 14d; org 100 visits / 3 seats / 14d (from active catalog defaults). |
| 7 | Monthly allowance expiry | Job deferred to PR2; schema + policy enum present; manual owner credit in v1. |
| 8 | Visit requests | `VisitCapacityRequest` PENDING → APPROVED allocates from bank; DENIED audited. |
| 9 | Audit | `VISIT_LEDGER_CREDIT`, `VISIT_LEDGER_DEBIT`, `VISIT_ALLOCATED`, `VISIT_RECLAIMED`, `VISIT_REQUEST_*`, `PLATFORM_CATALOG_PUBLISHED`, `ORG_COMMERCIAL_UPDATED`. |
| 10 | PHI fence | Ledger metadata: noteId, counts, tier ids only — no note bodies. |

## Schema (additive)

See migration `20260603000000_unit_51_commercial_capacity`.

- `Organization.visitBankBalance`
- `OrgUser.visitWalletBalance`
- `OrganizationCommercialContract` (1:1 org)
- `PlatformBillingCatalog` (versioned)
- `VisitLedgerEntry` (append-only)
- `VisitCapacityRequest`

## Surfaces

| Actor | Route | Capability |
|-------|-------|------------|
| Owner | `/owner/commercial/catalog` | View/edit draft catalog; publish |
| Owner | `/owner/orgs/[id]` → Commercial card | Contract fields, manual bank credit |
| Org admin | `/admin/capacity` | Bank balance, user wallets, allocate/reclaim, visit requests |
| Clinician | `/account/usage` | Bank + wallet balance (existing page extended in PR2) |
| Clinician | Request visits API | POST when low balance |

## Verify when done

- [ ] Migration applies; seed creates active catalog + Demo Clinic contract with bank balance.
- [ ] `npm test` — visit-ledger + capacity-gate tests green.
- [ ] Owner can publish catalog; org contract PATCH audited.
- [ ] Admin allocate 10 visits user A → bank −10, wallet +10.
- [ ] Admin reclaim 5 → wallet −5, bank +5.
- [ ] Encounter POST returns 403 `no_visit_capacity` when bank+wallet=0 and no overage.
- [ ] Note generation debits 1 visit idempotently per noteId.
- [ ] Visit request approve flow credits wallet from bank.

## Out of scope (PR3+)

- Contract term reminder **emails** (in-app banner shipped PR2)
- Full legacy draft-based usage page removal
- General org messaging / clinical chat

## PR2 (shipped in branch)

- Stripe Checkout for visit bundles + solo monthly tiers (`/api/billing/checkout-capacity`, webhook fulfillment)
- Admin `/admin/billing` capacity purchase UI
- Enterprise monthly allowance cron (`npm run billing:monthly-allowance`)
- `/account/usage` visit bank + wallet section + visit request button
- Contract expiry in-app warnings on `/admin/capacity` and `/account/usage`
