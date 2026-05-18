# Unit 35: Per-Org LLM Cost Rollup

## Goal

Wave 6 continuation. The platform makes 1000s of LLM calls/day across
note generation, brief precompute, copilot ask, copilot research, and
3 draft tools. Today every call returns `{ model, tokensIn, tokensOut,
latencyMs }` but nothing aggregates that data. Customer-success can't
answer "how much is org X costing us per month?"; ops can't see "is
org Y about to blow our Bedrock budget?"; sales can't price upmarket
tiers without per-tenant cost truth.

Unit 35 ships the cost-truth infrastructure:

1. **`LlmCallLog` table** — one row per LLM generate call. Captures
   model + tokens + cost + orgId + caller-supplied surface tag
   (`brief`, `ask`, `draft.patientMessage`, etc.). High-volume table;
   not subject to PHI denylist (no PHI in any column).
2. **`OrgLlmCostDaily` rollup cache** — per-org daily aggregation
   (mirror of Unit 32's `OrgUsageDaily`); recomputed on-demand with a
   60-min freshness window.
3. **`MODEL_PRICING` map + `computeCostUsd`** — Sonnet 4.5: $3/MTok in,
   $15/MTok out; Haiku 4.5: $1/MTok in, $5/MTok out. Other models map
   to a conservative fallback. Centralized so price changes are one
   edit.
4. **Metering instrumentation** — extend `GenerateOptions` with an
   optional `meter: { orgId, noteId?, surface }`; the LLM service
   writes one `LlmCallLog` row per call when meter is present. 5
   highest-volume surfaces wired in v1: copilot ASK + RESEARCH agent,
   3 copilot draft tools, brief precompute worker, note-generation
   worker. Workers that don't pass meter (test stubs, untagged calls)
   simply don't log — fail-safe; cost rollup undercounts rather than
   throws.
5. **Owner UI** — `LlmCostCard` on `/owner/orgs/[id]`: 30-day
   cost chart, per-model breakdown, cost-per-signed-note KPI, optional
   monthly budget threshold with "over budget" warning state.
6. **Budget endpoint** — `PATCH /api/owner/orgs/[id]/llm-budget` with
   nullable `monthlyLlmBudgetUsd` (Decimal). 1 new audit action:
   `LLM_BUDGET_UPDATED` (org + platform pair, before/after via
   singleFieldChange).

> **Unit 35 ships when** an owner opens `/owner/orgs/[id]` → new "LLM
> cost" card renders the org's 30-day cost chart (totaled + per-model)
> + the cost-per-note metric; the owner can set a monthly budget via
> a form; the card shows an over-budget warning when current-month
> spend exceeds the budget. Behind the scenes: 5 instrumented call
> sites write `LlmCallLog` rows on every generate; `getOrgLlmCost`
> aggregates those rows into the 30-day window with a 60-min cache.

## Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | Per-call log granularity | `LlmCallLog` row per generate call. Captures `orgId, noteId?, surface, model, tokensIn, tokensOut, costUsd, latencyMs, stub, createdAt`. High-volume but bounded by tokens-per-call (most calls < 2k output tokens; volume scales with active clinician minutes, not patient minutes). |
| 2 | Cost computation | Stored on the row (NOT computed on read). Reasoning: if MODEL_PRICING changes, historical rows reflect the price AT THE TIME of the call (matches accounting reality). Recomputing on read would silently revise history. |
| 3 | Pricing map | `src/lib/llm/pricing.ts`: `MODEL_PRICING = { 'us.anthropic.claude-sonnet-4-5-...': {inUsdPerMTok: 3, outUsdPerMTok: 15}, ... }` keyed on the cross-region model id Bedrock returns. Unknown models map to a conservative `{in: 10, out: 30}` fallback so untracked model bumps surface as overcharges (better fail-loud than fail-silent). |
| 4 | Metering opt-in | `GenerateOptions.meter` is OPTIONAL. Callers that pass it get logged; callers that don't (test stubs, ad-hoc scripts) don't. Fail-safe: missing meter = rollup undercounts, never throws. |
| 5 | Surface tags | Caller-supplied string for `LlmCallLog.surface`. Lowercase, dot-separated (`copilot.ask`, `copilot.draft.patientMessage`, `worker.brief`, `worker.note-generation`). Locked at the call site so the surface name is stable across versions; rollup groups by exact match. |
| 6 | Rollup cache | New `OrgLlmCostDaily` table parallel to `OrgUsageDaily` from Unit 32. `(orgId, day)` unique. Fields: `totalTokensIn, totalTokensOut, totalCostUsd (Decimal), callCount, computedAt`. Per-model breakdown lives at the LlmCallLog level — when the UI needs it, the route does a fresh aggregation by model (small enough scan). |
| 7 | Rollup TTL | 60-minute freshness mirror of OrgUsageDaily. Cost rollups don't need real-time precision; the owner's "what did this org cost yesterday?" query tolerates a 60-min staleness budget. |
| 8 | Budget threshold | `Organization.monthlyLlmBudgetUsd Decimal?` (nullable). Owner-only settable. When set, the LlmCostCard renders an "over budget" warning when current-calendar-month spend exceeds the threshold. NO automated alert in v1 — surface-only. (Audit-row-based alert deferred to a polish iteration; it requires state to avoid duplicate alerts per month.) |
| 9 | Budget audit | `LLM_BUDGET_UPDATED` with `singleFieldChange('monthlyLlmBudgetUsd', before, after)`. Two-row pattern (org + platform) mirrors ORG_SUBSCRIPTION_UPDATED + AUDIT_RETENTION_UPDATED. |
| 10 | Decimal precision | Postgres `Decimal(12, 4)` on `LlmCallLog.costUsd` (4 decimal places = sub-cent precision); `OrgLlmCostDaily.totalCostUsd` same; `Organization.monthlyLlmBudgetUsd` `Decimal(10, 2)` (cents). Chosen so a single org could spend up to $99,999,999.99 with sub-cent per-call resolution before overflow. |
| 11 | Stub-mode | Stub LLM calls (`stub: true` result) still get logged with their reported tokens (usually 0 in stub mode) + costUsd=0. Lets the dev page render with realistic structure; stub-mode rows are distinguishable via the `stub` column. |
| 12 | Cost-per-note metric | `totalCostUsd / notesSigned` over the 30-day window. `notesSigned` reuses the same metric the UsageChart already computes (from `Note.count` with `status='SIGNED'`). Null when zero notes — UI renders "n/a" instead of dividing by zero. |

## Design

### Schema additions

```prisma
model Organization {
  // ...existing
  /// Unit 35 — Per-org LLM monthly budget threshold in USD. null =
  /// no threshold (warning never shown). Owner-only settable via
  /// /api/owner/orgs/[id]/llm-budget.
  monthlyLlmBudgetUsd Decimal? @db.Decimal(10, 2)

  llmCalls    LlmCallLog[]
  llmCostDaily OrgLlmCostDaily[]
}

/// Unit 35 — Per-call LLM usage log. One row per generate call when
/// the caller passes a `meter` option. PHI-free by construction:
/// columns are model id + token counts + cost + caller-supplied
/// surface tag. NEVER stores prompts or responses.
model LlmCallLog {
  id           String       @id @default(cuid())
  orgId        String
  organization Organization @relation(fields: [orgId], references: [id])
  noteId       String?      // optional, when call is anchored to a note
  surface      String       // 'copilot.ask', 'worker.brief', etc.
  model        String       // Bedrock model id (cross-region prefix included)
  tokensIn     Int
  tokensOut    Int
  /// Cost AT THE TIME of the call (NOT recomputed on read). Decimal(12,4).
  costUsd      Decimal      @db.Decimal(12, 4)
  latencyMs    Int
  stub         Boolean      @default(false)
  createdAt    DateTime     @default(now())

  @@index([orgId, createdAt])
  @@index([surface])
}

/// Unit 35 — Per-org per-day rollup cache. Mirrors OrgUsageDaily.
model OrgLlmCostDaily {
  id                    String       @id @default(cuid())
  orgId                 String
  organization          Organization @relation(fields: [orgId], references: [id])
  day                   DateTime     // midnight UTC of the calendar day
  totalTokensIn         Int          @default(0)
  totalTokensOut        Int          @default(0)
  totalCostUsd          Decimal      @default(0) @db.Decimal(12, 4)
  callCount             Int          @default(0)
  computedAt            DateTime

  @@unique([orgId, day])
  @@index([orgId, day])
}
```

### Pricing map

```ts
// src/lib/llm/pricing.ts

export type ModelPricing = {
  /** USD per million input tokens */
  inUsdPerMTok: number;
  /** USD per million output tokens */
  outUsdPerMTok: number;
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'us.anthropic.claude-sonnet-4-5-20250929-v1:0': { inUsdPerMTok: 3, outUsdPerMTok: 15 },
  'us.anthropic.claude-haiku-4-5-20251001-v1:0':  { inUsdPerMTok: 1, outUsdPerMTok: 5 },
  // Fallback when the model isn't in the map — conservative so unknown
  // model bumps surface as overcharges in the rollup, not as zeros.
  'unknown': { inUsdPerMTok: 10, outUsdPerMTok: 30 },
};

export function computeCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const p = MODEL_PRICING[model] ?? MODEL_PRICING.unknown!;
  return (tokensIn * p.inUsdPerMTok + tokensOut * p.outUsdPerMTok) / 1_000_000;
}
```

### LLM service instrumentation

```ts
// src/services/llm/types.ts (extension)
export interface GenerateOptions {
  // ...existing fields
  /** Unit 35 — when present, the service writes one LlmCallLog row
   *  after the call. Optional — missing meter = no log row (rollup
   *  undercounts). */
  meter?: {
    orgId: string;
    noteId?: string;
    surface: string; // 'copilot.ask', 'worker.brief', etc.
  };
}
```

```ts
// src/services/llm/index.ts (wrapper post-call hook)
async generate(sys, user, opts) {
  if (opts?.phi) assertProviderAllowedForPHI(activeProvider);
  const result = await base.generate(sys, user, opts);
  if (opts?.meter) {
    await writeLlmCallLog({
      orgId: opts.meter.orgId,
      noteId: opts.meter.noteId,
      surface: opts.meter.surface,
      result,
    });
  }
  return result;
}
```

`writeLlmCallLog` lives in `src/lib/llm/cost-log.ts` — fail-loud per
Rule 8: if the DB write fails, the caller's request fails (no
swallowed errors).

### Aggregation module

```ts
// src/lib/owner/llm-cost-rollup.ts (parallel to usage-rollup.ts)

export const LLM_COST_CACHE_TTL_MS = 60 * 60 * 1000;
export const LLM_COST_MAX_WINDOW_DAYS = 30;

export type DailyLlmCost = {
  day: string; // YYYY-MM-DD
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  callCount: number;
};

export async function computeOrgLlmCost(
  orgId: string,
  windowDays: number = LLM_COST_MAX_WINDOW_DAYS,
  now: Date = new Date(),
): Promise<DailyLlmCost[]>;
```

### Endpoints

```
GET  /api/owner/orgs/[id]/llm-cost?days=30
   → { rollup: DailyLlmCost[], perModel: Array<{model, totalCostUsd}>,
       currentMonthSpend, monthlyBudgetUsd, isOverBudget,
       costPerSignedNote }

PATCH /api/owner/orgs/[id]/llm-budget
   Body: { monthlyLlmBudgetUsd: number | null }
   Audit: LLM_BUDGET_UPDATED (org + platform pair)
```

### UI

`src/app/(owner)/owner/orgs/[id]/_components/llm-cost-card.tsx`:
- Fetches `/llm-cost?days=30`
- 30-day stacked bar chart (CSS only) with totals
- Per-model breakdown list
- Cost-per-signed-note KPI tile
- Budget input + over-budget warning banner

## Implementation order

1. Spec + schema (LlmCallLog + OrgLlmCostDaily + monthlyLlmBudgetUsd) + LLM_BUDGET_UPDATED action + migration (this commit)
2. MODEL_PRICING + writeLlmCallLog + LLM service `meter` wiring + 5 call sites + tests
3. computeOrgLlmCost aggregation + 2 owner endpoints + tests
4. LlmCostCard UI on owner page
5. Tracker + PR #36

## Out of scope (Unit 35)

- Automated threshold-crossed alerts (LLM_BUDGET_THRESHOLD_CROSSED action) — requires state to avoid duplicate alerts; defer to a polish iteration
- Cost projection/forecasting (next-30-day extrapolation)
- Per-clinician cost rollup (org-level only in v1)
- Wire metering into every LLM call site (v1 covers 5 highest-volume; long-tail callers can opt in later)
- Cost charge-back / Stripe-side reconciliation
- Multi-currency support (USD only)
- Bedrock provisioned-throughput pricing model (on-demand pricing only)

## Verify when done

- Migration applied; LlmCallLog + OrgLlmCostDaily tables present; Organization.monthlyLlmBudgetUsd column present.
- 1 new audit action in `AuditAction` union: `LLM_BUDGET_UPDATED`.
- Sending a copilot ASK question generates an LlmCallLog row with `surface='copilot.ask'`, correct tokensIn/tokensOut/costUsd.
- Owner opens `/owner/orgs/[id]` → new LlmCostCard renders the 30-day chart + cost-per-note + per-model breakdown.
- Setting a monthly budget triggers an over-budget warning when current-month spend exceeds it; LLM_BUDGET_UPDATED audit row carries before/after.
- `npm run build`, `npm run lint`, `npm test` all green.
- progress-tracker.md updated; PR #36 stacked on Unit 34.
