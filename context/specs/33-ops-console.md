# Unit 33: Ops Console

## Goal

Wave 6 continuation. Unit 09 shipped owner-only surfaces: `/owner/orgs`,
`/owner/users`, `/owner/audit`, `/owner/health`, `/owner/announcements`.
That's the right shape for sales + customer-success roles, but
operations engineers (SRE / on-call / incident response) need a
separate console with different scope:

- **No org provisioning, no BAA, no impersonation, no subscription changes** —
  ops shouldn't accidentally bill a customer or browse PHI.
- **Deeper at-a-glance health** beyond per-provider checks — error
  rate, queue depths, worker liveness, recent failures across all orgs.
- **Cross-org audit search** — same filter shape as `/owner/audit` but
  available to ops without granting the broader PLATFORM_OWNER role.

> **Unit 33 ships when** a platform user with the new `PLATFORM_OPS`
> role can sign in and reach `/ops` → dashboard renders aggregate
> metrics (org count, active users, notes 24h/7d, error rate, queue
> depths), `/ops/health` renders the existing 6-provider check + the
> per-queue depth panel, `/ops/audit` renders the same cross-org
> search UI as `/owner/audit`, AND the same user is denied access to
> `/owner/*` routes (which remain PLATFORM_OWNER-only).

## Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | New PlatformRole | Add `PLATFORM_OPS` to the enum. NONE / PLATFORM_OPS / PLATFORM_OWNER (owner is the strict superset — ops sees fewer things). |
| 2 | Authz helper split | `requirePlatformOwner` (existing) stays OWNER-only — gates `/owner/*`. New `requirePlatformStaff` allows OPS OR OWNER — gates `/ops/*`. MFA-required for both. |
| 3 | Route group | New `(ops)` route group at `src/app/(ops)/`. Layout enforces `requirePlatformStaff` at the page level. `/ops` (dashboard), `/ops/health`, `/ops/queues`, `/ops/audit`. |
| 4 | Dashboard metrics | Computed on-demand with a 60-second in-memory cache. No new DB table for v1 (metrics are quick aggregations; promotes to a cache table when the page becomes hot). Cache lives inside the metrics module (module-level Map keyed by metric name). |
| 5 | Dashboard scope | (1) Total orgs + active orgs (orgs with ≥1 SIGNED note in last 30 days); (2) Total active users (signed in last 30 days); (3) Notes signed last 24h + 7d + 30d; (4) Failed transcription jobs last 24h; (5) Failed AI generation jobs last 24h; (6) Stuck/interrupted notes count (status='INTERRUPTED'); (7) Per-action error rate last 1h (actions ending in `_FAILED`). |
| 6 | Queue depths | New `/api/ops/queues` endpoint reads BullMQ queue counts via `redis` directly (LLEN on the BullMQ keys). One row per queue: queue name, waiting count, active count, failed count, completed count. NO worker-level introspection in v1 (would need BullMQ Queue handles per queue). |
| 7 | Audit search | New `/api/ops/audit-search` endpoint = thin wrapper around the existing `/api/owner/audit` query shape but gated by `requirePlatformStaff`. Audits via `OPS_AUDIT_SEARCHED` (separate action so the auditor can distinguish owner vs ops who looked at what). |
| 8 | Audit export | New `/api/ops/audit-search/export` returns CSV; same filters as search. Caps at 5,000 rows per export (vs `/owner/audit/export` cap so ops can't accidentally pull a full year). Audits via `OPS_AUDIT_EXPORTED`. |
| 9 | Health endpoint sharing | `/ops/health` UI calls EXISTING `/api/owner/health` endpoint — but the endpoint is migrated to use `requirePlatformStaff` (was OWNER-only) so OPS can call it too. PLATFORM_HEALTH_CHECKED audit action reused. |
| 10 | Audit action naming | New actions are `OPS_*` prefix (OPS_DASHBOARD_VIEWED, OPS_AUDIT_SEARCHED, OPS_AUDIT_EXPORTED, OPS_QUEUE_DEPTH_CHECKED). Distinct from PLATFORM_* (owner-only actions) so the auditor lens can split "what did ops do" vs "what did the owner do" trivially. |
| 11 | Error-rate metric scope | Counts AuditLog rows with `action LIKE '%_FAILED'` AND createdAt within the last hour. Not exhaustive (some failures are silent — e.g., a worker that crashed before writing) but a useful proxy + bounded by audit action shape. |
| 12 | Stub-mode | Dashboard works against the seeded DB. Queue depths in stub-mode (no Redis): metric returns `null` per queue with a `stub: true` flag the UI surfaces as "Redis unavailable." Health checks already stub-mode-aware. |

## Design

### Schema addition

```prisma
enum PlatformRole {
  PLATFORM_OWNER
  PLATFORM_OPS  // NEW — Unit 33
  NONE
}
```

Migration: enum value addition (Postgres `ALTER TYPE ... ADD VALUE`).

### Authz helper

```ts
// src/lib/authz/platform.ts

const STAFF_ROLES: PlatformRole[] = ['PLATFORM_OWNER', 'PLATFORM_OPS'];

export async function requirePlatformStaff(): Promise<RequirePlatformStaffResult> {
  const session = await auth();
  if (!session?.user) return { error: 401 };
  if (!STAFF_ROLES.includes(session.user.platformRole)) return { error: 403 };
  if (!session.user.mfaEnabled) return { error: 403, code: 'mfa_required' };
  return { user: session.user };
}
```

`requirePlatformOwner` keeps its existing OWNER-only behavior — DO NOT
weaken to allow OPS. Owner has a strict superset of ops capabilities.

### Metrics aggregation module

```ts
// src/lib/ops/platform-metrics.ts

export type PlatformMetrics = {
  computedAt: string; // ISO
  orgs: { total: number; activeLast30d: number };
  users: { activeLast30d: number };
  notes: { signedLast24h: number; signedLast7d: number; signedLast30d: number; interrupted: number };
  workers: { transcriptionFailedLast24h: number; aiGenerationFailedLast24h: number };
  errorRateLastHour: number; // count of *_FAILED audit rows in last hour
};

const CACHE_TTL_MS = 60_000;
let cached: { value: PlatformMetrics; expiresAt: number } | null = null;

export async function getPlatformMetrics(now: Date = new Date()): Promise<PlatformMetrics> {
  if (cached && cached.expiresAt > now.getTime()) return cached.value;
  // Compute all metrics in parallel...
  // Cache + return.
}
```

In-memory cache survives only for the lifetime of the Node process —
fine for v1; multi-instance deployments will see staggered refreshes
(acceptable jitter for ops metrics).

### Queue depths

```ts
// src/lib/ops/queue-depths.ts

const KNOWN_QUEUES = [
  'transcription-finalize',
  'ai-generation',
  'voice-id',
  'note-finalize',
  'flags-analyzer',
  'fhir-sync',
];

export type QueueDepth = {
  name: string;
  waiting: number | null;
  active: number | null;
  failed: number | null;
  stub: boolean; // true when Redis unavailable
};

export async function getQueueDepths(): Promise<QueueDepth[]> {
  if (!redis) return KNOWN_QUEUES.map((n) => ({ name: n, waiting: null, active: null, failed: null, stub: true }));
  // BullMQ stores per-queue state under `bull:<queue>:wait` etc.
  // Use redis.llen for waiting, scard for active+failed sets.
}
```

### UI

- `src/app/(ops)/layout.tsx` — auth gate via `requirePlatformStaff` server-side.
- `src/app/(ops)/ops/page.tsx` — dashboard with metric tiles.
- `src/app/(ops)/ops/queues/page.tsx` — queue depths table.
- `src/app/(ops)/ops/health/page.tsx` — health check table (reuses `/api/owner/health`).
- `src/app/(ops)/ops/audit/page.tsx` — cross-org audit search (reuses `PlatformAuditTable` style).

### Permission posture

- `/owner/*` — `requirePlatformOwner` (OWNER only). Unchanged.
- `/ops/*` — `requirePlatformStaff` (OWNER or OPS). New.
- `/api/owner/health` — migrated to `requirePlatformStaff` (was OWNER). Endpoint shape unchanged.
- All other `/api/owner/*` endpoints — UNCHANGED (still OWNER-only).
- `/api/ops/*` — `requirePlatformStaff`.

## Implementation order

1. Spec + PLATFORM_OPS enum + 4 new audit actions + migration (this commit)
2. `requirePlatformStaff` helper + platform-metrics module + queue-depths module + tests
3. API endpoints: `/api/ops/dashboard`, `/api/ops/queues`, `/api/ops/audit-search`, `/api/ops/audit-search/export`; migrate `/api/owner/health` to staff gate
4. UI: `/ops` layout + dashboard + queues + health + audit pages
5. Tracker + PR #34

## Out of scope (Unit 33)

- Worker introspection (in-flight job details, per-worker logs)
- Cross-org cost rollup (Unit 35)
- Real-time push for queue depths (poll-based 30s refresh in v1)
- Background metric aggregation (in-memory cache only)
- Per-action audit dashboard charts (raw counts in v1; charts are polish)
- Migrating `/owner/audit`, `/owner/users`, `/owner/orgs`, `/owner/announcements` to PLATFORM_STAFF (owner-only for v1; if ops needs visibility into a specific surface we add it case-by-case)
- IP allowlist for ops console access (would need geofencing decision; defer)

## Verify when done

- Migration applied; `PLATFORM_OPS` value present in enum; `npx prisma migrate status` clean.
- 4 new audit actions in `AuditAction` union.
- `requirePlatformStaff` returns OK for both PLATFORM_OWNER + PLATFORM_OPS; rejects NONE.
- Dashboard renders against seeded DB; all 7 metric tiles populated.
- Queue depths page renders 6 queue rows; in stub mode (no Redis) renders "Redis unavailable" per row.
- Health page renders the existing 6-provider check via the migrated endpoint.
- Audit search page returns rows + supports cursor pagination + CSV export caps at 5000.
- A user with PLATFORM_OPS role can reach `/ops` but NOT `/owner` (403).
- `npm run build`, `npm run lint`, `npm test` all green; no regression.
- progress-tracker.md updated; PR #34 stacked on Unit 32.
