# Drafts list — Mockup Gap Analysis

## At a glance
- **Mockup file(s):** `design-mockups-2026-05/drafts_screen_mobile_and_desktop_mockup.html` (278 lines)
- **Production file(s):** `src/app/(clinical)/drafts/page.tsx` (170 lines)
- **Coverage estimate:** built ~92% / partial ~6% / missing ~2%
- **Top blocking issue:** Remaining deltas are now mostly strict visual/table fidelity polish; optional one-shot sign-all semantics are now available behind explicit clinician confirmation, and filter/action control rhythm is closer to mockup touch density.

## Mockup summary
- **Mobile:** `.h1` "Drafts"; `.h1-sub` counts [`64–65`]; search/settings icon buttons [`67–70`]; chips Today/Week/All [`74–77`]; bucket **Ready to sign** first with **Sign all** [`80–84`]; cards: checkbox, `.age-chip` (green/amber/red), `.pmeta` DOB·MRN [`95`], `.mini-tag` row; CTA **Review & sign** [`105`]; buckets In progress, Processing [`133–166`].
- **Desktop:** title + counts [`175–176`]; `.search-box`; **Sign 3 reviewed** [`179–181`]; filter chips + modality + clinician [`184–193`]; **table** `.list-row` with checkbox, time, template, overflow [`199–265`]; **Select all** [`197`].
- **Legend:** summary headline, ready-first bulk triage, DOB/MRN without tap, **Review & sign** wording, aging chips for late signing [`272–277`].

## Production summary
Drafts now ships ready-first buckets, time-filter chips (Today/Week/All), row-level and select-all checkbox queue selection, age chips, DOB/MRN identity metadata, BH sensitivity marker, and queue handoff to review/sign.

```33:54:src/app/(clinical)/drafts/page.tsx
const BUCKETS: DraftBucket[] = [
  { title: "Preparing", match: PREPARING_NOTE_STATUSES, action: "Continue Setup" },
  { title: "In Progress", match: RESUME_NOTE_STATUSES, action: "Resume" },
  { title: "Processing", match: PROCESSING_NOTE_STATUSES, action: "View" },
  { title: "Ready for Review", match: REVIEW_NOTE_STATUSES, action: "Review" },
];
```

```102:159:src/app/(clinical)/drafts/page.tsx
          {BUCKETS.map((bucket) => {
            ...
                <h2 className="text-base font-medium uppercase tracking-[0.08em] text-muted-foreground/65">
                  {bucket.title} ({items.length})
                </h2>
                ...
                            <p className="mt-0.5 text-[14px] leading-[1.7] text-muted-foreground/70">
                              {new Date(n.updatedAt).toLocaleString("en-US", { ... })}
                            </p>
                            ...
                            <StatusBadge variant={noteStatusVariant(n.status)}>
                              {noteStatusLabel(n.status)}
                            </StatusBadge>
                            <Link href={requireClinicalNoteHref(n)}>
                              <Button size="sm" variant="outline">{bucket.action}</Button>
                            </Link>
```

```11:19:src/components/ui/status-badge.tsx
        success: "bg-[var(--status-success-bg)] text-[var(--status-success)] border-[var(--status-success-border)]",
        warning: "...",
        danger: "...",
        info: "bg-[var(--status-info-bg)] text-[var(--status-info)] ...",
```

## Element-by-element diff

### Header
- Mockup [L64–71, L173–181] **counts subtitle**, search, bulk **Sign N**; prod now has subtitle counts, search, and persistent desktop **Review & sign N reviewed** action.

### Filters
- Mockup chips [L74–77, L184–193]; prod now includes:
  - time chips (Today / This week / All),
  - queue-scope chips (All / Ready / In progress / Processing / Preparing),
  - modality chips (All modalities / In-person / Telehealth).

### Buckets
- Mockup **Ready first** [L80–84, legend L273–274]; prod now matches ready-first triage.

### Cards / rows
- Mockup checkboxes + **Select all** [L89–90, L197–198]; prod now supports ready-row selection + select-all-in-view.
- Mockup **aging chips** [L93–94, L116]; prod now includes age chips (today / warning / stale danger).
- Mockup DOB·MRN [L95, L203]; prod now surfaces identity metadata via `buildPatientIdentityMeta`.
- Mockup duration/modality/template tags [L96–100]; prod now shows visit type + template labels.

### Actions
- Mockup **Review & sign** primary green [L105]; prod now uses Review & sign queue actions for selected ready drafts, including persistent desktop CTA copy parity ("Review & sign N reviewed").
- Mockup **Sign all** / **Sign 3 reviewed**; prod now has **server-backed** review-sign queue orchestration but still does not offer irreversible one-click sign-all commit from Drafts (by design, each note still routes through review + attestation).

### Delete / overflow
- Prod delete + confirm [`114–126`,`150–155`]; mockup shows **⋯** not delete — extra prod behavior.

### Layout
- Mockup desktop wide grid; prod single column [`82`] — no responsive table.

## Copy diff
| Mockup | Production |
|--------|------------|
| 3 to sign · 2 in progress | (none) |
| Ready to sign | Ready for Review [`50`] |
| Review & sign | Review [`51`] |
| Sign all / Sign 3 reviewed | (none) |

## Token / styling diff
- Mockup: `.age-today` `#EAF3DE`/`#3B6D11`, `.age-2d`/`age-stale` amber/red families [`mockup:29-31`]; CTA `#0F6E56` [`mockup:15-16`].
- Prod: badges via `StatusBadge` + CSS vars [`status-badge.tsx:11-19`]; cards `border-border/50` [`114`]; no aging so no mockup urgency colors. `Button` `size="sm"` is `h-7` [`button.tsx:28`] — below mockup's emphasized primary height on mobile.

## Refactor recommendations
1. ~~**[page.tsx] [M] [risk: low] — Desktop table/search parity pass for high-density queue scanning.**~~ **DONE** (desktop search + persistent bulk action + queue-scope/modality filters shipped).
2. ~~**[API + sign flow] [L] [risk: high]**~~ **DONE (guarded UX)** — Added optional “Sign all now” queue start from Drafts with explicit confirmation copy; each note still routes through individual sign+attestation screens.
3. ~~**[sensitivity UX] [M] [risk: med] — Extend beyond BH marker to explicit Part 2/restricted-chart indicators when intake-level sensitivity is available on queue rows.**~~ **DONE** (Part 2 + BH signaling from intake-backed sensitivity).

## Cross-reference to cursor-tasks/01-quick-wins.md
- **Task #4 (drafts hardcoded `bg-blue-100` etc.):** **N/A / COVERED in prod** — `drafts/page.tsx` has **no** `bg-blue-100`, `bg-amber-100`, or `bg-green-100` (verified grep: zero matches). List uses `<StatusBadge variant={noteStatusVariant(n.status)}>` [`144–146`] backed by tokens [`status-badge.tsx:11-19`]. The **quick-wins** cite [`92`] is **stale** relative to current `drafts/page.tsx`.
- **#3:** Now covered on drafts rows (DOB/MRN metadata rendered with stronger contrast treatment).
- **#5:** PARTIAL — primary row CTA `size="sm"`/`h-7` [`148`,`button.tsx:28`] vs mockup taller mobile CTAs.
- **#1, #2, #6, #7:** N/A.

**Phase 2+ candidates:** Optional one-click batch-sign commit UX only (if product/legal approves bypassing per-note review-step friction).

### HIPAA / 42 CFR Part 2 note
- Mockup stresses **DOB·MRN** in list to prevent wrong-patient selection; prod now includes these identifiers and BH sensitivity cues. Remaining gap is explicit Part 2/restricted signaling when underlying intake data is available.
