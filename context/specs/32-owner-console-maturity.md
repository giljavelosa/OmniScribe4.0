# Unit 32: Owner Console Maturity

## Goal

Wave 6 opener. Unit 09 shipped the owner console v1: cross-org list, BAA
on/off, seats, users search, audit table, health, announcements. v1 was
read-mostly + provisioning — the owner can SEE everything but their
levers are blunt. Unit 32 sharpens the levers customer-success + sales
+ compliance actually use day-to-day:

1. **Subscription plan + override notes** — record what tier the org is
   on; capture override notes for sales-approved discounts; audit every
   change with before/after.
2. **Impersonation v1 (READ-ONLY)** — owner can browse the app AS a
   target user (see what they see) without mutations. Every audit row
   minted during the session carries `actingUserId` (owner) +
   `onBehalfOfUserId` (target). Global banner makes the mode
   unmistakable.
3. **Transactions view** — per-org timeline that unifies
   PlatformAuditLog (cross-org actions) + significant AuditLog rows
   (ORG_*, SUBSCRIPTION_*, IMPERSONATION_*, USER_INVITED, etc.) into
   one chronological feed. The single page customer-success opens to
   answer "what changed on this org and when?"
4. **Usage rollups** — per-org daily counts (notes generated,
   transcription minutes, copilot asks, drafts accepted). Computed
   on-demand with a 60-min cache in `OrgUsageDaily`. Owner page renders
   a 30-day bar chart. Background BullMQ aggregation defers to Wave 6
   polish.

> **Unit 32 ships when** the owner can: open an org page → see
> subscription tier + override notes (with editable form + audit row on
> save), see a 30-day usage chart pulling from cached
> `OrgUsageDaily` rows, see a Transactions timeline showing recent
> ORG_* + IMPERSONATION_* + SUBSCRIPTION_* events, and click "Begin
> Impersonation" → land on `/home` as the target user with a banner
> "Acting as Dr. Smith @ Demo Clinic — End impersonation" and ALL
> mutation routes refuse with `impersonation_read_only`.

## Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | Impersonation auth mechanism | JWT extension on the existing NextAuth session, NOT a separate session table. Owner stays signed in as themselves; JWT gains `impersonation: { targetUserId, targetOrgId, beganAt, sessionId }`. End = unset the field. PlatformSession is unused — adding a second session would force every authz check to fork on which to read. |
| 2 | Impersonation mutation scope | **READ-ONLY in v1.** Mutations return `403 impersonation_read_only`. Implementation: `requireFeatureAccess` checks `session.impersonation` and rejects POST/PATCH/DELETE on every gated route. Future iteration can add scoped mutations (e.g. owner can edit a USER row but not sign a Note). Belt-and-suspenders: middleware enforces it method-level as the structural guarantee. |
| 3 | Subscription plan shape | New enum `SubscriptionPlan = STARTER \| PROFESSIONAL \| ENTERPRISE \| CUSTOM`. `Organization.subscriptionPlan` (default `STARTER`) + `subscriptionOverrideNotes` (free text ≤500 chars; nullable). No price field — pricing lives in Stripe (Unit 09's stripeCustomerId is the source of truth; plan is owner-facing metadata for at-a-glance triage). |
| 4 | Subscription audit | `ORG_SUBSCRIPTION_UPDATED` with `{ before: {plan, notesLength}, after: {plan, notesLength} }`. Notes content excluded from audit metadata (record length only — override notes might contain sensitive sales context like rep names; safe default). |
| 5 | Usage rollup storage | New `OrgUsageDaily` table — `{orgId, day(date), notesSigned, transcriptionMinutes, copilotAsks, draftsAccepted, computedAt, computedAtSourceCount}`. Compound `@@unique([orgId, day])` so refresh = upsert. Computed on-demand; if `computedAt > 60 min ago`, owner page recomputes synchronously before render. |
| 6 | Usage rollup compute scope | 30-day window. Hard cap of 30 days/request keeps the cold-cache compute bounded (Notes table scan with WHERE signedAt >= NOW - 30d is the only query). Daily window = midnight UTC bucket; no per-tz handling in v1 — customer success doesn't need it. |
| 7 | Transactions view filter | Curated allowlist of actions: ORG_*, USER_INVITED, USER_DEACTIVATED, USER_ROLE_CHANGED, SEAT_*, IMPERSONATION_*, SUBSCRIPTION_*, ANNOUNCEMENT_*, PLATFORM_ORG_CREATED, PLATFORM_BAA_UPDATED. Excludes high-volume operational events (NOTE_*, PATIENT_*, FHIR_*, COPILOT_*). The view is for **org-level governance**, not per-encounter audit. |
| 8 | Transactions limit | 100 rows on initial page load, sorted DESC. No pagination in v1 — customer success uses the full audit table for deep dives; this view is the at-a-glance. |
| 9 | BAA acceptance workflow | No new audit action. Reuse existing `ORG_BAA_UPDATED`. The "workflow" SURFACES in TransactionsTimeline (which renders BAA updates chronologically alongside other org events). |
| 10 | Impersonation duration cap | 60 minutes from `beganAt`. After expiry the impersonation field is treated as null; owner sees a banner "Impersonation session expired — begin again to continue." Prevents a forgotten impersonation from running indefinitely. |
| 11 | Impersonation audit | Two new actions: `IMPERSONATION_BEGAN` (metadata: targetUserId, targetOrgId, reasonLength) + `IMPERSONATION_ENDED` (metadata: targetUserId, durationSeconds, mutationsBlocked). Both written via `writePlatformAuditLog` so they appear in the platform audit table AS WELL AS the org's transactions view (cross-anchored). Reason ≥10 chars required at begin (forces explicit purpose). |
| 12 | Stub-mode | Usage rollups in dev work fine against the seeded notes; no stub-mode fork needed. Impersonation works against the seeded clinician user. |

## Design

### Schema additions

```prisma
// New enum + Organization fields
enum SubscriptionPlan {
  STARTER
  PROFESSIONAL
  ENTERPRISE
  CUSTOM
}

model Organization {
  // ...existing fields
  subscriptionPlan          SubscriptionPlan @default(STARTER)
  subscriptionOverrideNotes String? // ≤500 chars, owner-facing free text

  // ...existing relations
  usageDaily   OrgUsageDaily[]
}

// New table — cached per-org daily rollup
model OrgUsageDaily {
  id                    String   @id @default(cuid())
  orgId                 String
  organization          Organization @relation(fields: [orgId], references: [id])
  day                   DateTime // midnight UTC of the calendar day
  notesSigned           Int      @default(0)
  transcriptionMinutes  Int      @default(0)
  copilotAsks           Int      @default(0)
  draftsAccepted        Int      @default(0)
  computedAt            DateTime
  computedAtSourceCount Int      @default(0) // for debugging "did we count zero?"

  @@unique([orgId, day])
  @@index([orgId, day])
}
```

### Impersonation session shape

The NextAuth JWT gains a new optional field:

```ts
type ImpersonationContext = {
  targetUserId: string;
  targetOrgId: string;
  beganAt: number; // epoch ms
  reason: string; // first 20 chars only, for the banner; full reason in audit
};

// session.impersonation: ImpersonationContext | null
```

Begin endpoint (`POST /api/owner/orgs/[id]/impersonate`):
1. Verify `requirePlatformOwner()` + MFA.
2. Body: `{ targetUserId: string, reason: string (≥10 chars) }`.
3. Verify targetUserId is an active OrgUser of the org.
4. Write `IMPERSONATION_BEGAN` to PlatformAuditLog.
5. Update the JWT via NextAuth's `update()` mechanism — set `impersonation` field.
6. Response: `{ ok: true }` — client triggers `session.update()` then navigates to `/home`.

End endpoint (`DELETE /api/owner/orgs/[id]/impersonate`):
1. Read current impersonation from session.
2. Write `IMPERSONATION_ENDED` with durationSeconds + mutationsBlocked counter (server-side counter not implemented in v1 — set to 0 placeholder for future).
3. Update JWT — unset `impersonation`.
4. Response: `{ ok: true }`.

### Mutation guard

`requireFeatureAccess` (existing) gains a new check:

```ts
// In requireFeatureAccess, after the auth gate:
if (session.impersonation && req.method !== 'GET' && req.method !== 'HEAD') {
  return {
    error: NextResponse.json(
      { error: { code: 'impersonation_read_only' } },
      { status: 403 },
    ),
  };
}
```

This catches mutations across EVERY gated route. Server actions that
write without going through requireFeatureAccess get a sibling helper
`assertNotImpersonating()` they call explicitly.

### Audit threading during impersonation

`writeAuditLog` (existing) gains optional `actingUserId` + `onBehalfOfUserId`
parameters — actually the columns already exist (Unit 01 schema). The
wrapper `writeImpersonatableAudit` helper threads the active session:

```ts
// src/lib/audit/impersonation.ts
export async function writeImpersonatableAudit(input: AuditInput) {
  const session = await auth();
  const imp = session?.impersonation;
  return writeAuditLog({
    ...input,
    userId: imp?.targetUserId ?? input.userId,
    actingUserId: imp?.targetUserId ? session!.user.id : undefined,
    onBehalfOfUserId: imp?.targetUserId,
  });
}
```

Note: in v1 impersonation is read-only so this helper isn't heavily
exercised yet — but plumbed in so READ audit rows that DO fire during
impersonation (e.g. PATIENT_VIEWED) carry the actor pair.

### Transactions view

`GET /api/owner/orgs/[id]/transactions?limit=100` returns:

```ts
{
  data: {
    transactions: Array<{
      id: string;
      occurredAt: string; // ISO
      source: 'audit' | 'platform-audit';
      action: string; // AuditAction string
      actingUserId: string | null;
      actingUserEmail: string | null; // hydrated
      onBehalfOfUserId: string | null;
      onBehalfOfUserEmail: string | null; // hydrated
      resourceType: string | null;
      resourceId: string | null;
      metadata: Record<string, unknown>; // PHI-free by construction
    }>;
  };
}
```

Server queries both tables in parallel, filters via the locked action
allowlist (decision 7), interleaves by createdAt DESC, takes top 100,
then hydrates user emails in one batched lookup.

### Usage rollup

`GET /api/owner/orgs/[id]/usage?days=30`:
1. Compute the 30 expected day buckets (UTC midnight).
2. Fetch existing OrgUsageDaily rows for the org × range.
3. For each bucket where the row is missing OR `computedAt > 60 min ago`:
   - Run 4 aggregation queries (`Note.count where status='SIGNED' and signedAt range`, `Note transcription duration sum`, `AuditLog.count where action='COPILOT_ASK_QUERY'`, `AuditLog.count where action='COPILOT_DRAFT_CONFIRMED'`).
   - Upsert the row.
4. Return all 30 rows sorted ASC.

Cold compute cost: 4 queries × N stale buckets. Worst case (empty
cache, 30 days stale): 120 queries on a single page load. Acceptable
for a tool that's used a few times a day by ops. The 60-min cache
amortizes repeat loads to ~zero queries.

### UI surface

New components:
- `src/app/(owner)/owner/orgs/[id]/_components/subscription-form.tsx` — plan dropdown + override notes textarea + Save button (audit before/after).
- `src/app/(owner)/owner/orgs/[id]/_components/usage-chart.tsx` — client component; fetches `/api/owner/orgs/[id]/usage`; renders a bar chart per metric in a small grid (4 sparklines: notes / minutes / asks / drafts).
- `src/app/(owner)/owner/orgs/[id]/_components/transactions-timeline.tsx` — client component; fetches `/api/owner/orgs/[id]/transactions`; renders a list of cards with action chip + actor email + relative time.
- `src/app/(owner)/owner/orgs/[id]/_components/impersonate-control.tsx` — "Begin Impersonation" button → AlertDialog (target user select + reason textarea) → POST → toast → navigate `/home`.
- `src/components/impersonation-banner.tsx` — global banner mounted in `(clinical)`, `(admin)`, `(owner)` layouts; reads session.impersonation; renders "Acting as X — End impersonation" with a danger tint; click "End" → DELETE call → `signOut({ redirect: false })` then refresh.

### Permission posture

Subscription form + impersonation controls are visible to PLATFORM_OWNER
only. Existing `(owner)/layout.tsx` enforces this gate; the new
endpoints repeat it via `requirePlatformOwner()`.

## Implementation order

1. Spec + 4 new audit actions + schema + migration + Prisma generate (this commit)
2. Impersonation core: session shape extension, `assertNotImpersonating`, `writeImpersonatableAudit`, `requireFeatureAccess` method-level guard, tests
3. API endpoints: `/subscription` PATCH, `/impersonate` POST + DELETE, `/usage` GET, `/transactions` GET
4. UI: SubscriptionForm, UsageChart, TransactionsTimeline, ImpersonateControl, ImpersonationBanner
5. Tracker + PR #33

## Out of scope (Unit 32)

- True scoped mutations during impersonation (v1 is read-only; v2 polish iteration)
- Background BullMQ rollup job (on-demand cache is fine for v1; promotes to background when usage page becomes hot)
- Plan-tier feature flags (subscriptionPlan is metadata; FEATURE_FLAG_USAGE_BASED_BILLING etc. lives in Wave 7)
- Stripe webhook integration (Unit 09 stubbed STRIPE_SUBSCRIPTION_UPDATED already; live Stripe integration is its own unit)
- Per-tz day buckets (UTC only in v1)
- Transactions pagination (100 cap; full audit table covers deep dives)
- Multi-org impersonation queue (one target at a time per owner)

## Verify when done

- Migration applied; `subscriptionPlan` + `subscriptionOverrideNotes` on Organization; OrgUsageDaily table present.
- 4 new audit actions in `AuditAction` union: `ORG_SUBSCRIPTION_UPDATED`, `IMPERSONATION_BEGAN`, `IMPERSONATION_ENDED`, `IMPERSONATION_BLOCKED_MUTATION`.
- Subscription form on `/owner/orgs/[id]` saves → audit row carries before/after plan + notesLength.
- 30-day usage chart renders against the cached rollup; second render in <60 min uses cache (no fresh aggregation queries).
- Transactions timeline renders top 100 ORG-level events with actor email + relative time.
- Begin Impersonation flow: select target user → enter reason ≥10 chars → POST → JWT impersonation set → navigate `/home` → banner visible → all mutation routes return `impersonation_read_only`.
- End Impersonation: click banner button → DELETE → JWT cleared → page refreshes; `IMPERSONATION_ENDED` audit row written.
- 60-min impersonation TTL enforced (server-side check on each gated request).
- `npm run build`, `npm run lint`, `npm test` all green; full suite still passes (no regression).
- progress-tracker.md updated; PR #33 stacked on Unit 31.
