# Unit 09: Owner Console v1

> **Wave 1** (owner console). Billing prerequisites in this unit are **Wave 7 §09** — see [`00-build-plan.md`](00-build-plan.md) Wave 7 for the canonical billing wave. Live Stripe lands in **Unit 38**.

## Goal

Close Wave 1 by giving the platform owner the surfaces needed to run OmniScribe as a multi-tenant service: cross-org user search, cross-org audit (PHI-free), system-wide announcements, system health, and seat allocation. After this unit, the first paying customer can be provisioned, onboarded, recorded, signed, AND paid (seat allocation drives the billing intent — actual Stripe API calls are stubbed in v1 per the existing provider-stub pattern).

## Design

Platform-owner-only. `(owner)/layout.tsx` already gates on `platformRole === 'PLATFORM_OWNER'`. All routes audit to BOTH `AuditLog` (when org-scoped) AND `PlatformAuditLog` (always).

### Surfaces

- `/owner/orgs` — already exists from Unit 01 (BAA-status column + filter)
- `/owner/orgs/new` — already exists from Unit 01 (BAA required)
- `/owner/orgs/[id]` — existing BAA editor + NEW seat allocation section + NEW subscription view
- `/owner/users` — NEW cross-org user search (email/name; org column; last sign-in; MFA enrolled)
- `/owner/audit` — NEW cross-org audit log (filter by org / actor / action / resource; PHI-free metadata only; CSV export)
- `/owner/announcements` — NEW SystemAnnouncement CRUD (title, body markdown, severity, target orgs, schedule window)
- `/owner/health` — NEW health surface (DB ping, Redis ping, S3 reachability, Bedrock + Soniox + Resend provider checks, BullMQ queue depths)

### Owner-mode posture vs admin-mode posture

- Admin surfaces (Unit 08) are org-scoped: the actor's `orgId` is the boundary.
- Owner surfaces are platform-scoped: any org's data is reachable, BUT cross-org reads must surface PHI-free metadata by default. PHI ingress in owner audit logs is intentional risk surface — Unit 09 v1 keeps the owner audit log PHI-free (denylist already enforced at `writeAuditLog`) and surfaces it directly.

### Impersonation deferred

The build plan calls for impersonation ("acting as user X to debug their session") inside `/owner/orgs/[id]`. That's high blast radius (audit must capture `actingUserId` vs `onBehalfOfUserId`; session-mint requires care to never grant ambient PHI access). Defer to a later unit (Unit 09.5 or part of Unit 33 Ops Console). Logged as scope decision in tracker.

### Stripe seat allocation — stub-mode pattern

Stripe is a real dependency (`STRIPE_SECRET_KEY` env var). For v1 we adopt the same stub-mode pattern Soniox/Bedrock/S3 use: when the key is absent, the seat-allocation API still works end-to-end (creates `Seat` rows, audits, writes a "stub: true" marker in metadata). When the key is set, the API calls Stripe to create/update the subscription with the new seat count. The wrapper lives in `src/services/billing/stripe.ts` so future Stripe surfaces (`/admin/billing`) reuse the same client.

## Implementation

### A. Audit actions

`src/lib/audit/actions.ts` appends:

- `PLATFORM_USERS_VIEWED` — `/owner/users` list read
- `PLATFORM_AUDIT_VIEWED` — `/owner/audit` list read
- `PLATFORM_AUDIT_EXPORTED` — CSV download
- `PLATFORM_HEALTH_CHECKED` — `/owner/health` page hit
- `ANNOUNCEMENT_CREATED` / `_UPDATED` / `_DELETED`
- `SEAT_ALLOCATED` / `SEAT_REVOKED`
- `STRIPE_SUBSCRIPTION_UPDATED` (or `_STUB` when no key) — wraps the Stripe call result for audit-trail completeness

### B. APIs

- `GET /api/owner/users?q=...&page=...` — cross-org search joining `User` + `OrgUser` + `Organization`. Returns `{ data: [...users with primary org info], nextCursor }`. Audits `PLATFORM_USERS_VIEWED`.
- `GET /api/owner/audit?...` — same filter shape as `/api/admin/audit` plus `orgId` filter. Joins `Organization` for org name. Audits `PLATFORM_AUDIT_VIEWED`.
- `GET /api/owner/audit/export` — CSV, 10k cap.
- `GET / POST / PATCH / DELETE /api/owner/announcements[/[id]]` — `SystemAnnouncement` CRUD. Body schema accepts `targetOrgIds: string[]` (empty = all orgs).
- `GET /api/owner/health` — runs DB ping (`SELECT 1`), Redis ping, S3 head-bucket, Bedrock list-models, Soniox temporary-key mint, Resend `/domains`. Returns `{ checks: [{ name, ok, latencyMs, detail? }] }`. Each check has a 5s timeout; failures don't throw — they return `ok: false` with the error class.
- `POST /api/admin/seats` — accepts `{ tier, count, expiresAt }`. Creates Seat rows + invokes `billingService.upsertSubscription()` (stub-mode when no STRIPE_SECRET_KEY). Atomic — if Stripe fails, transaction rolls back Seat rows.
- `DELETE /api/admin/seats/[id]` — revokes a single seat row. Unassigns from OrgUser first.

### C. UI

`/owner/users` — search box + paginated table (email, name, primary org, last sign-in, MFA badge).

`/owner/audit` — same layout as `/admin/audit` plus an "Org" filter dropdown hydrated from distinct `orgId`s. Org column added to the table.

`/owner/announcements` — list + Create sheet. Per-row Edit / Delete. Severity badge (info/warning/critical). Schedule window shown. `targetOrgIds: []` displays as "all orgs."

`/owner/health` — single-page check report. Each provider/service shows ✓/✗ + latency badge. Auto-refresh every 60s (or on tap).

`/owner/orgs/[id]` — existing BAA editor + new SeatSection (current seat counts by tier, "+ Allocate seats" sheet, list of active seats with revoke button) + new SubscriptionView (read-only Stripe state OR "stub mode" banner).

`/admin/seats` — same SeatSection but org-scoped (admin sees their own seats; can't allocate new ones — owner-only).

### D. Stripe billing service

`src/services/billing/stripe.ts`:

```ts
export class StripeBillingService {
  isStubMode = !process.env.STRIPE_SECRET_KEY;

  async upsertSubscription(input: { orgId: string; seatCount: number; tier: SeatTier; expiresAt: Date }) {
    if (this.isStubMode) {
      return { stub: true, subscriptionId: `stub-${input.orgId}-${Date.now()}`, status: 'active' as const };
    }
    // Real Stripe SDK call lands here when STRIPE_SECRET_KEY is set.
    throw new Error('Real Stripe path not yet implemented in v1 — set STRIPE_SECRET_KEY=stub to use stub mode.');
  }
}
```

The seat-allocation route wraps both `prisma.seat.create()` and the Stripe call in a transaction; if Stripe errors, the seat rows are rolled back. Stub mode never errors so the transaction always commits.

### E. Health check service

`src/services/health/checks.ts`:

```ts
export async function runAllHealthChecks(): Promise<HealthCheckResult[]> {
  return Promise.all([
    checkPostgres(),    // SELECT 1
    checkRedis(),       // PING
    checkS3(),          // HeadBucket on S3_AUDIO_BUCKET
    checkBedrock(),     // ListInferenceProfiles
    checkSoniox(),      // mintEphemeralKey
    checkResend(),      // GET /domains
  ]);
}
```

Each check has a 5-second timeout enforced via `Promise.race`. Results are PHI-free (`{ name, ok, latencyMs, detail? }`).

## Dependencies

- `stripe` SDK already in package.json (deferred from Unit 08)
- No new packages

## Verify when done

- [ ] `/owner/users` lists cross-org users with primary-org column + MFA badge.
- [ ] `/owner/audit` filters by org + actor + action + resource; CSV exports correctly.
- [ ] `/owner/announcements` CRUD works; created announcement is visible (storage tested — actual banner-render across the app is Unit 33+).
- [ ] `/owner/health` page renders within 6s (5s timeout per check + render); each check shows ✓/✗ + latency.
- [ ] Stripe seat allocation works in stub mode (no STRIPE_SECRET_KEY): creates Seat rows + writes `STRIPE_SUBSCRIPTION_UPDATED` audit with `{ stub: true }`.
- [ ] Seat allocation rolls back on Stripe error (test with stub-mode disabled + invalid key).
- [ ] Every owner surface audits to `PlatformAuditLog`; cross-org reads also audit to per-org `AuditLog`.
- [ ] `npm run typecheck`, `lint`, `test`, `build` all green.
- [ ] Three-lens evaluation: Clinician (n/a — owner-mode), Compliance (every cross-org read auditable + PHI-free), Auditor (PlatformAuditLog reconstructs every owner action with actor + timestamp + scope).
- [ ] `progress-tracker.md` updated; Wave 1 marked complete.
