# Unit 10: Section-Regenerate UX Maturity

## Goal

Polish the section-regenerate surface that landed in Unit 05 + Unit 06. Five concrete improvements: (1) SSE reconnect handling so the strip never silently goes stale, (2) per-section diff view so a clinician can confirm "what changed" before accepting a regenerated section, (3) failure-recovery banner with retry-all-failed when multiple sections error in the same pass, (4) regeneration observability captured in `Note.inferenceLog._sectionStats`, (5) audit actions for the polish behaviors.

No new schema. No new BullMQ queue. No new LLM call path. All polish lands inside `/review/[noteId]` (where Unit 05 put the section accordion) and the existing `ai-generation` worker.

## Design

### Mental model — what's missing today

After Unit 05+06 the clinician can:
- See section status in the strip
- Edit each section inline
- Regenerate one section (with overwrite confirmation when edited)
- Sign when all required sections are ready

What's missing:
- The SSE channel just closes on transient network error — no reconnect, no visible "stale" indicator
- After a regenerate, the clinician has no way to compare the new content to what they had before (the old content is lost)
- When multiple sections fail (e.g. Bedrock outage), the clinician has to retry each one individually — no batch retry
- Worker timing + failure rates aren't surfaced anywhere

### Surfaces

- `/review/[noteId]` review-client SSE reconnect with backoff + visible connection status
- `/review/[noteId]` per-section "show what changed" affordance opening a diff dialog
- `/review/[noteId]` failure-recovery banner at the top when ≥1 section is `failed`, with "Retry all failed"
- `Note.inferenceLog._sectionStats` aggregated stats (count + p50/p95 latency + failure rate) — surfaced via `GET /api/notes/[id]/regen-stats` for the admin observability surface

### Audit actions

- `SECTION_DIFF_VIEWED` — clinician opened the diff dialog
- `SECTION_REGEN_RETRY_BATCH` — clinician triggered retry-all-failed (metadata captures count + list of section ids)

## Implementation

### A. SSE reconnect

The `ReviewClient` currently creates an `EventSource` in `useEffect` and closes it on unmount. Add:

- **Connection status state** (`'connecting' | 'live' | 'reconnecting' | 'offline'`).
- **Reconnect loop**: on `EventSource.onerror`, close + recreate after exponential backoff (1s → 2s → 4s → 8s → 16s cap). Cap reconnect attempts at 6 before falling back to `'offline'`.
- **Connection chip** in the review surface header so the clinician knows when the live view is stale (`StatusBadge` variant: live → success / reconnecting → warning / offline → danger).

### B. Per-section diff

When a regenerate completes, capture the PREVIOUS content (the one that was just replaced) in `_regenerations[].previousContent` for the most recent N entries (N=10) per section. Cap at 10 to bound memory growth.

- `GET /api/notes/[id]/sections/[sectionId]/diff?regenIndex=...` — returns `{ previous, current, regeneratedAt, model, overwroteEdited }`
- `<SectionDiffDialog>` component — shadcn Dialog with a 2-pane diff (line-level, hand-rolled — no `diff` package dep). Shows previous left / current right, additions highlighted green, removals strikethrough red (token colors).
- New "Show what changed" link on each SectionAccordion, visible only when `_regenerations` has an entry for that section.
- Audits `SECTION_DIFF_VIEWED` on dialog open.

### C. Failure-recovery banner

At the top of `/review`, when any section status is `failed`:
- Banner lists the failed section labels + a "Retry all failed" button.
- Click → POST `/api/notes/[id]/regenerate-section` once per failed section (sequential or parallel; sequential is safer for rate-limiting).
- Optimistic UI: each section flips to `generating` on retry, with rollback on error.
- Audits `SECTION_REGEN_RETRY_BATCH` once per click with `{ count, sectionIds }`.

### D. Regeneration observability

The ai-generation worker handler already writes `_sectionStatus[sectionId].{model, latencyMs, tokensIn, tokensOut}` per success. Extend the worker to ALSO write an aggregate `_sectionStats` shape:

```ts
_sectionStats: {
  totalAttempts: number;
  successCount: number;
  failureCount: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  lastUpdatedAt: ISO;
  // Keep the last 50 per-attempt latencies as a window for online p50/p95.
  recentLatenciesMs: number[];
}
```

Surfaced via:
- `GET /api/notes/[id]/regen-stats` — owner-scoped (or admin-scoped via `requireFeatureAccess('TEAM_MEMBERS_MANAGE')`). For Unit 10 we don't add a dedicated UI surface — the data is queryable via the audit log surface or via Prisma Studio. A future ops console can pin a real chart.

### E. Audit actions

Append to `src/lib/audit/actions.ts`:
- `SECTION_DIFF_VIEWED`
- `SECTION_REGEN_RETRY_BATCH`

## Dependencies

- No new packages. Hand-rolled diff (line-level LCS) keeps the bundle clean.

## Verify when done

- [ ] SSE reconnects after a forced disconnect (kill the request in DevTools) with visible reconnecting state.
- [ ] Each regenerated section shows a "Show what changed" link; tapping opens a 2-pane diff dialog with token-colored additions/removals.
- [ ] Failure-recovery banner appears at the top of /review when ≥1 section is `failed`; "Retry all failed" triggers individual regenerate POSTs and audits a single SECTION_REGEN_RETRY_BATCH.
- [ ] `Note.inferenceLog._sectionStats` populates with p50/p95 latency + counts after a generate-note pass.
- [ ] `GET /api/notes/[id]/regen-stats` returns the stats for admins.
- [ ] Three-lens evaluation: Clinician (diff + retry-all closes the trust gap; reconnect indicator prevents silent staleness), Compliance (diff views audit; retry-all audits as a batch), Auditor (observability lays groundwork for ops dashboards).
- [ ] `progress-tracker.md` updated.
