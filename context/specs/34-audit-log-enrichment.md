# Unit 34: Audit Log Enrichment Depth

## Goal

Wave 6 continuation. Unit 08 established the audit-log skeleton +
introduced `diffForAudit` for before/after capture; Unit 09 + 32 + 33
extended action coverage. The current state:

- ✅ Audit writer fail-loud (Rule 8) + PHI-denylist
- ✅ `diffForAudit` helper available
- ✅ Per-org `/admin/audit` search + CSV export
- ✅ Cross-org `/owner/audit` + `/ops/audit`
- ✅ Some mutations capture before/after via diffForAudit (admin sites,
  rooms, users, org-settings, templates; owner BAA + subscription;
  episodes)
- ❌ Several high-value mutation routes write opaque metadata
  (PATIENT_UPDATED, GOAL_STATUS_CHANGED, SNAPSHOT_OVERRIDE_CREATED,
  EPISODE_RECERTIFIED) — no before/after
- ❌ No retention policy infrastructure — audit rows accumulate
  indefinitely; compliance / cost both demand a configurable retention
- ❌ `/admin/audit` table renders raw JSON metadata; rows with structured
  `changes` are unreadable without manual JSON parsing

Unit 34 closes those three gaps:

1. **Diff coverage sweep** — migrate 3-4 high-value mutation routes to
   use `diffForAudit` so the audit row carries `{ changes: { field: {
   before, after } } }`.
2. **Per-org retention policy** — new `Organization.auditRetentionDays`
   (default 730 = 2 years; nullable for "forever"). Owner can adjust
   per-org. New manual-trigger endpoint + CLI script to purge older
   rows; background BullMQ job deferred to a polish iteration.
3. **Diff renderer** — when an audit row's metadata carries
   `{ changes }`, the per-org + per-platform audit tables render
   field-by-field "X: before → after" instead of the raw JSON blob.

> **Unit 34 ships when** an admin can edit a patient's demographics →
> the AuditLog row carries `{ changes: { firstName: { before: "A",
> after: "B" } } }`; the owner can set `Demo Clinic` retention to 90
> days via a new card on `/owner/orgs/[id]`; the owner can click "Run
> purge now" → audit rows older than 90 days are deleted + an
> `AUDIT_PURGE_RUN` row records the deletion count; the `/admin/audit`
> table renders the patient-update row as a readable diff instead of
> raw JSON.

## Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | Retention storage | `Organization.auditRetentionDays Int?` (nullable). null = retain forever; ≥30 = enforce. Default 730 (2 years) for new orgs; existing orgs migrate to null (forever) so behavior doesn't change retroactively. |
| 2 | Retention min | Hard floor at 30 days. Owner-side validation rejects <30. Compliance posture: too-aggressive purging is the bigger risk than a too-large audit log. Beyond 30d, the org's compliance team can tune. |
| 3 | Purge mechanism | New `src/lib/audit/retention.ts` module with `purgeAuditForOrg(orgId, now)` + `purgeAuditAllOrgs(now)`. Two new endpoints: `POST /api/owner/orgs/[id]/audit-purge` (per-org manual trigger, OWNER-gated) + CLI `scripts/audit-purge.mjs` (cron-friendly for prod). NO automatic background job in v1 — deferred to BullMQ once we know prod hot/cold patterns. |
| 4 | Purge scope | Only `AuditLog` rows (per-org). `PlatformAuditLog` is owner-action records — retain forever in v1 (governance trail). `OrgUsageDaily` cache rows: keep last 90 days (independent of audit retention; they're regenerable). |
| 5 | Purge audit | Each purge run writes one `AUDIT_PURGE_RUN` row (action ironically NOT itself purgeable — guard in retention module skips the most recent AUDIT_PURGE_RUN per org). Metadata: `{ orgId, retentionDays, cutoffDate, rowsDeleted, durationMs }`. PHI-free by construction. |
| 6 | Retention change audit | `AUDIT_RETENTION_UPDATED` written on every change to `Organization.auditRetentionDays`. Metadata captures `{ before: number\|null, after: number\|null }`. Two-row pattern: org-scope + platform-scope (mirrors ORG_SUBSCRIPTION_UPDATED). |
| 7 | Diff coverage sweep targets | Four routes get diffForAudit treatment: PATIENT_UPDATED (`/api/patients/[id]`), GOAL_STATUS_CHANGED (`/api/episodes/[id]/goals/[goalId]`), PATIENT_DEMOGRAPHICS_EDITED (Unit 12 surface), EPISODE_RECERTIFIED (`/api/episodes/[id]/recertify`). Each route gets a curated allowlist of non-PHI fields to include in the diff. PHI-bearing fields (firstName, lastName, dob, mrn) included for PATIENT_UPDATED because the diff IS the value (admin needs to see what was changed); writeAuditLog's denylist intercepts if anyone tries to slip these into other action's metadata. |
| 8 | Diff PHI exception (PATIENT_UPDATED) | Patient demographic field changes are an explicit allowed exception — the audit record's purpose IS to capture "X changed firstName from A to B." The denylist's `firstName/lastName/dob/mrn` keys are checked at the top level of metadata; nesting under `changes.firstName.before` does NOT trigger because the denylist is shallow. This is intentional + documented in `phi-free-check.ts`. Compliance accepts this because the audit row's whole point is to surface the change. |
| 9 | Diff renderer | New `<AuditMetadataDiff metadata={row.metadata} />` component renders `{ changes: { field: { before, after } } }` as a 2-column field-by-field table (mono font). Falls back to existing JSON dump for rows without `changes` key. Live in `/admin/audit` + `/owner/audit` + `/ops/audit`. |
| 10 | Stub-mode | Purge works against real DB. No stub fork needed. |

## Design

### Schema addition

```prisma
model Organization {
  // ...existing fields
  /// Unit 34 — Per-org audit retention. null = retain forever; ≥30
  /// triggers purge of AuditLog rows older than N days. Owner-only
  /// settable via /api/owner/orgs/[id]/audit-retention.
  auditRetentionDays Int?
}
```

Migration: add column with no default (existing rows = null = forever
retention). New orgs default to 730 at the route layer (`/owner/orgs/new`).

### New audit actions

```ts
| 'AUDIT_RETENTION_UPDATED' // { before: number|null, after: number|null }
| 'AUDIT_PURGE_RUN' // { orgId, retentionDays, cutoffDate, rowsDeleted, durationMs }
```

Both PHI-free by construction.

### Retention module

```ts
// src/lib/audit/retention.ts

export type PurgeResult = {
  orgId: string;
  retentionDays: number;
  cutoffDate: string; // ISO
  rowsDeleted: number;
  durationMs: number;
  skipped: 'no_retention' | 'no_rows_to_delete' | null;
};

export async function purgeAuditForOrg(orgId: string, now: Date): Promise<PurgeResult>;

export async function purgeAuditAllOrgs(now: Date): Promise<{
  orgsProcessed: number;
  totalRowsDeleted: number;
  perOrg: PurgeResult[];
}>;
```

Both delete in batches (5,000 rows / pass) to avoid long-running
transactions. Each batch runs in a transaction; the function loops
until no more rows match.

### Endpoints

```
PATCH /api/owner/orgs/[id]/audit-retention
  Body: { auditRetentionDays: number | null }
  Validates: null OR (≥30 AND ≤3650)
  Audit: AUDIT_RETENTION_UPDATED (org + platform)

POST /api/owner/orgs/[id]/audit-purge
  Triggers per-org purge synchronously.
  Returns: PurgeResult
  Audit: AUDIT_PURGE_RUN
```

### CLI

```
scripts/audit-purge.mjs
  Loads all orgs with auditRetentionDays set.
  Calls purgeAuditAllOrgs(now).
  Logs PurgeResult per org. Exit 0 even on per-org failures so cron
  doesn't bail on one org's transient error.
```

### Diff renderer

```tsx
// src/components/audit/audit-metadata-diff.tsx

export function AuditMetadataDiff({ metadata }: { metadata: unknown }) {
  // If metadata.changes is an object with { field: { before, after } } shape,
  // render a 2-col table.
  // Otherwise, render the existing JSON dump.
}
```

Mount in `/admin/audit/_components/audit-table.tsx` +
`/owner/audit/_components/platform-audit-table.tsx`.

### Diff coverage sweep

Audit the 4 named routes' current writeAuditLog calls; replace
opaque-metadata-only patterns with `diffForAudit(before, after,
ALLOWED_FIELDS)`. Each gets a per-route allowlist constant.

## Implementation order

1. Spec + schema (auditRetentionDays) + 2 audit actions + migration (this commit)
2. Retention module + endpoints + CLI + integration tests
3. Diff coverage sweep on 4 routes
4. UI: retention card on owner page + AuditMetadataDiff component + integration into both audit tables
5. Tracker + PR #35

## Out of scope (Unit 34)

- Background BullMQ purge job (manual + CLI in v1)
- Per-action retention (e.g., NOTE_SIGNED rows kept longer than COPILOT_ASK rows)
- PlatformAuditLog purging (governance trail kept forever in v1)
- Full-text search across metadata (Unit 09 audit table already supports filter by action/user/org/date)
- Retention applied to AuditLog rows that have a legal hold (no legal-hold model in v1)
- Notification when retention would delete recent rows (CLI is silent; cron-managed)

## Verify when done

- Migration applied; `Organization.auditRetentionDays` field present.
- 2 new audit actions in `AuditAction` union.
- Owner can edit retention on `/owner/orgs/[id]` (new card); save writes `AUDIT_RETENTION_UPDATED` with before/after.
- Owner clicks "Run purge now" on an org with retention=30d → AuditLog rows older than 30d are deleted → `AUDIT_PURGE_RUN` row written with `rowsDeleted` count.
- CLI `node scripts/audit-purge.mjs` processes all orgs with retention set + logs per-org results.
- PATIENT_UPDATED + GOAL_STATUS_CHANGED + EPISODE_RECERTIFIED + PATIENT_DEMOGRAPHICS_EDITED rows now carry `{ changes }` structure.
- `/admin/audit` and `/owner/audit` render rows with `changes` as a readable diff (mono font 2-col).
- `npm run build`, `npm run lint`, `npm test` all green.
- progress-tracker.md updated; PR #35 stacked on Unit 33.
