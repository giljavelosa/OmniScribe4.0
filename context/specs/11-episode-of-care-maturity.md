# Unit 11: Episode-of-Care Maturity

## Goal

Episode-of-Care is currently a thin shell from Unit 02 (orgId / patientId / clinician / department / division / diagnosis / status / recertDueAt / visitsAuthorized / visitsCompleted). Unit 11 fills in the lifecycle behavior:

1. **Recert cycles** — 90-day default cadence (configurable per episode); `EpisodeStatus.RECERT_DUE` flips automatically when `recertDueAt < now`; nightly sweep job; UI surfaces the next due date + "recertify now" action that resets the cycle.
2. **Visit counters + auth limits** — increment `visitsCompleted` on encounter completion; warn when within `VISITS_AUTH_WARN_THRESHOLD` of the cap; block new schedule creation when at the cap (override available with reason).
3. **Goal progression** — clinician marks goals Met / Modified / Discontinued / Partially-met from the patient detail; each transition writes a `GoalProgressEntry` so the trail reconstructs.
4. **Episode close + reopen** — `DISCHARGED` close path (with optional reason + discharge summary); reopen back to `ACTIVE` with reason capture.
5. **Per-episode division override** — `EpisodeOfCare.division` already exists; surface it clearly on the patient detail so a clinician can see "this episode is REHAB even though patient's primary division is MEDICAL."

## Design

All UI lives on `/patients/[id]` (the existing patient detail surface). No schema changes — the existing fields cover every behavior.

## Implementation

### A. Audit actions (`src/lib/audit/actions.ts`)

- `EPISODE_RECERT_TRIGGERED` (sweep job sets status RECERT_DUE)
- `EPISODE_RECERTIFIED` (clinician resets the cycle)
- `EPISODE_DISCHARGED`
- `EPISODE_REOPENED`
- `EPISODE_VISIT_COUNT_INCREMENTED` (encounter close hook)
- `EPISODE_VISIT_LIMIT_OVERRIDE` (clinician scheduled past the auth cap with reason)
- `GOAL_STATUS_CHANGED`
- `GOAL_PROGRESS_ENTRY_ADDED`

### B. Episode lifecycle APIs

- `PATCH /api/episodes/[id]` — accepts `{ recertIntervalDays?, visitsAuthorized?, diagnosis?, bodyPart? }`. Recert interval default 90; min 7, max 365.
- `POST /api/episodes/[id]/recertify` — sets new recertDueAt = now + interval; status → ACTIVE; audits.
- `POST /api/episodes/[id]/close` — sets status DISCHARGED + endedAt; closes open follow-ups via cascading `CLOSED_BY_DISCHARGE`; audits.
- `POST /api/episodes/[id]/reopen` — DISCHARGED → ACTIVE; reason required (≥10 chars).

### C. Visit-counter hook

Already wired: encounter completion (Unit 02) flips Encounter.status → COMPLETED. Hook: when an encounter for a noteId that has an episode flips COMPLETED (or when a Note signs while its encounter is COMPLETED), increment `EpisodeOfCare.visitsCompleted` once. The cleanest place is the sign route's post-tx block — it's the moment the visit "counts." Idempotent via a check on signed=true so multi-sign isn't possible (rule 3 already enforces).

### D. Goal-progression APIs

- `PATCH /api/episodes/[id]/goals/[goalId]` — accepts `{ status, currentMeasure?, deltaNote? }`. Status transitions audited; each transition writes a `GoalProgressEntry` row.

### E. Patient detail UI

`EpisodesPanel` already exists in skeleton form (Unit 02). Extend:
- Per-episode row shows: diagnosis + body part + division badge + recert chip (with days-until-due color: success ≥30d, warning 7-29d, danger <7d or past), visit progress chip (`3 / 12` with bar; warning when ≥80%; danger when at cap).
- "Recertify" button → resets cycle; "Close" button → AlertDialog with optional reason; "Reopen" button on DISCHARGED rows → AlertDialog with required reason.
- "Edit details" sheet → recert interval days, visits authorized, diagnosis, body part.
- Goals subsection per episode: list with status chip + "Update status" inline (drop-down: Active / Met / Partially met / Modified / Discontinued); modified status opens a small reason input.

### F. Recert sweep worker

`src/workers/episode-recert/handler.ts` — nightly job (or call-every-X-min via cron). Scans episodes where `status = 'ACTIVE'` AND `recertDueAt < now()`; flips to RECERT_DUE; audits per-episode.

In v1 we ship this as a one-shot endpoint (`POST /api/admin/episodes/sweep`) that an external cron can call; the bullmq scheduler integration is a Wave 3 ops concern. The endpoint:
- Owner/admin-gated
- Returns `{ scanned, flipped, errors }` summary
- Audited with totals + the sweep run id

## Audit

Every state change goes through `writeAuditLog` with PHI-free metadata. The PHI-denylist already enforces "no patient name / dob / mrn / etc." — episode-level fields are clean.

## Tests

- Visit-counter idempotency (signing twice doesn't double-increment — defense-in-depth against rule 3 violations)
- Recert sweep flips only ACTIVE episodes past their due date
- Goal status transition writes a GoalProgressEntry
- Episode close cascades open FollowUps to CLOSED_BY_DISCHARGE

## Verify when done

- Recert cycles default to 90 days, configurable 7-365.
- Visit counter increments on sign (idempotent).
- Goal status updates audit + write GoalProgressEntry.
- Episode close + reopen workflows audit; close cascades FollowUps.
- Per-episode division override visible on patient detail.
- Nightly sweep endpoint flips ACTIVE → RECERT_DUE when due.
- 8 new audit actions wired.
- `progress-tracker.md` updated.
