# Late Entry Charting — Spec

**Status:** approved 2026-05-18 (live walkthrough). Implementation: background agent.

## Problem

Clinicians sometimes need to document a visit AFTER it happened — they have the audio/transcript but didn't record into OmniScribe at the time. CMS, Medicare, and all major EHRs (Epic, Athena, eClinicalWorks) allow this as "late entry" charting with explicit labeling, separate from the ExternalContext reference-only path (PR #79).

**Key difference from ExternalContext:**
- ExternalContext = reference only, no billing, fed into next visit's brief
- Late entry = REAL billable note, generates CPT codes, counts for recert windows, requires clinician attestation

## Goals

1. Let a clinician backdate a NEW visit's date-of-service to any day in the past N (default 30, org-configurable later).
2. `signedAt` stays the actual sign date — never backdated. Date-of-service is separate.
3. Sign attestation text changes to explicit late-entry language.
4. UI shows a "LATE ENTRY · N days late" badge on the chart and signed note view.
5. Audit logs capture both dates.
6. Notes still get CPT codes, sections, and full clinical processing.

## Non-goals (v1)

- Per-org configurable backdating window (default hard-coded to 30 days; spec for that later if customers need shorter/longer).
- Required-justification field for very late entries (e.g., > 14 days). Defer; clinician judgment is sufficient for v1.
- Approval workflow for late entries (chief of service sign-off). Defer.
- Productivity-report visibility flags (count late entries separately). Defer to reporting work.

## Schema

```prisma
model Note {
  // ... existing fields ...
  /** When the underlying care was delivered. Same day as encounter.startedAt
   *  for normal visits. Backdated for late entries. Used for date-of-service
   *  on billing surfaces. */
  dateOfService    DateTime  @default(now())
  /** True iff dateOfService < encounter.startedAt by 24+ hours, i.e. the
   *  clinician is documenting a past event. signedAt remains the actual
   *  sign date. */
  isLateEntry      Boolean   @default(false)
  /** Days between dateOfService and the date the note was created. Stamped
   *  at note creation; used for the "LATE ENTRY · N days" badge so callers
   *  don't re-derive on every render. */
  lateEntryDaysGap Int?
}
```

Migration: append-only. Default `dateOfService = createdAt` for existing rows (back-fill in the migration).

## API

### `POST /api/encounters` — accept optional `dateOfService`

```ts
const bodySchema = z.object({
  patientId: z.string().min(1),
  siteId: z.string().optional(),
  roomId: z.string().optional(),
  departmentId: z.string().optional(),
  episodeOfCareId: z.string().optional(),
  /** ISO 8601 (date-only, midnight org-TZ). If unset OR === today, treated
   *  as a normal visit. Must be ≤ today and ≥ today - 30 days. */
  dateOfService: z.string().datetime().optional(),
});
```

In the route handler:
- Validate dateOfService against the 30-day floor + today ceiling
- Compute `isLateEntry = (today - dateOfService).days >= 1`
- Compute `lateEntryDaysGap = days difference if isLateEntry, else null`
- Pass through `startVisit()` → set on the new Note

### `POST /api/notes/[id]/sign` — late-entry attestation text

No API change to the route. The change is **client-side** — when the note `isLateEntry=true`, the sign-client renders different attestation copy.

## Sign attestation copy

Current copy: *"By tapping Sign Note you attest that the content above accurately reflects today's visit and that you take responsibility for the documented care."*

Late-entry copy: *"This is a LATE ENTRY. By tapping Sign Note you attest that the content above accurately reflects the care you delivered on {dateOfService} (documented {today}), and that you take responsibility for that care. Late entries are subject to audit scrutiny."*

## UI

### Start visit dialog (PR #80) — add a "Visit date" date picker

Three states:
1. **Today (default)** — normal visit, no special UI
2. **Backdated 1-30 days** — show inline warning: "This will be saved as a late entry — your sign attestation will reflect the actual visit date."
3. **More than 30 days back or in the future** — disable submit + show error

In the dialog body, between the episode picker and the Start button:
```
┌─────────────────────────────────────────────────────────────┐
│ Visit date    [📅 Today, May 18, 2026     ▼]               │
│                                                             │
│ (If backdated:)                                             │
│ ⚠ Late entry — sign attestation will reflect this date.    │
└─────────────────────────────────────────────────────────────┘
```

### Patient chart — "LATE ENTRY" badge

On the Visit history list, late-entry rows show a yellow `LATE ENTRY · 14d` chip next to the date.

On the /review and /sign screens, a banner across the top: "Late entry — care delivered May 4, 2026 · documented May 18, 2026 (14 days late)."

### /sign screen — banner above the section list (in addition to the attestation copy change)

## Brief integration

Notes with isLateEntry=true are still considered prior-visit context for future briefs. No change to brief logic; the projector reads `dateOfService` (not `createdAt`) for sequencing.

## Audit additions

Add to `src/lib/audit/actions.ts`:
- `NOTE_LATE_ENTRY_CREATED` with `{ noteId, dateOfService, lateEntryDaysGap }`
- `NOTE_SIGNED` metadata gains `isLateEntry` + `lateEntryDaysGap` (extend the existing metadata; no new action needed for sign).

## Verification

- [ ] Migration applies cleanly; existing notes get `dateOfService = createdAt`, `isLateEntry = false`, `lateEntryDaysGap = null`
- [ ] Start visit with `dateOfService = today` → normal flow, no banner
- [ ] Start visit with `dateOfService = today - 14 days` → late-entry banner appears on /capture, /review, /sign; sign attestation copy is the late-entry variant
- [ ] Start visit with `dateOfService = today - 60 days` → rejected (validation error)
- [ ] Start visit with `dateOfService = today + 1` → rejected (future date)
- [ ] Patient chart visit history shows the "LATE ENTRY · 14d" chip on the backdated note row
- [ ] Signing the late-entry note succeeds; audit log row `NOTE_SIGNED` has `isLateEntry: true` in metadata
- [ ] Tests cover: validation edge cases (boundary days), badge rendering at 0/1/14/30 days, attestation copy switch
- [ ] CI green
- [ ] Three-lens evaluation in PR description (Clinician / Compliance / Auditor)

## Out of scope (v2 or later)

- Per-org backdating window
- Required justification text for entries > N days late
- Late-entry-specific approval workflow
- Counting late entries in productivity dashboards
- Provider performance metrics tied to late-entry rate
- Different attestation text per organization
