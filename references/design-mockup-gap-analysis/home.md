# Home (clinician) — Mockup Gap Analysis

## At a glance
- **Mockup file(s):** `design-mockups-2026-05/home_screen_mobile_and_desktop_mockup.html` (267 lines); `design-mockups-2026-05/home_desktop_patient_row_refined.html` (270 lines); `design-mockups-2026-05/home_desktop_patient_row_v3.html` (216 lines); `design-mockups-2026-05/home_desktop_full_width_patient_list.html` (206 lines)
- **Production file(s):** `src/app/(clinical)/home/page.tsx` (575 lines)
- **Coverage estimate:** built ~72% / partial ~18% / missing ~10%
- **Top blocking issue:** Remaining deltas are now mostly strict visual/token fidelity polish; row avatar rhythm + schedule-semantics subtitle depth + search shortcut affordance are strengthened.

## Mockup summary

**Canonical vs exploration**
- **`home_screen_mobile_and_desktop_mockup.html`** reads as the **baseline spec + callout legend** (mobile phone + desktop 2-col; legend L262–267 ties design intent to numbered callouts).
- **`home_desktop_patient_row_refined.html`** and **`home_desktop_patient_row_v3.html`** are **two competing desktop treatments** for the same "recent patients" list — not both shippable as-is.
- **`home_desktop_full_width_patient_list.html`** is a **layout variant**: full-width table, **no right column**; "Needs attention" + weekly stat live in a **footer strip** (L188–196) instead of a persistent right rail.

**Per mockup — layout, breakpoints, elements, tokens**

1. **`home_screen_mobile_and_desktop_mockup.html`**
   - **Grid:** Mobile 360px column; desktop `grid-template-columns: 1.4fr 1fr` (L56–58).
   - **Header:** Greeting + date (mobile L77–81; desktop L157–170); optional avatar (`--color-background-info`, L12); desktop embeds **search** in header row (L162–168) with **⌘K** shortcut chip (L18).
   - **Search:** Primary affordance; placeholder "Search patient or start a visit…" (L88–89); design calls it replacement for hero CTA (legend L264).
   - **Resume card:** Danger/surface `var(--color-background-danger)` (L40–45), patient name + elapsed time, CTA "Resume" / "Resume recording →".
   - **Recent patients:** Mobile **cards** with avatar initials, meta "Last visit … · discipline", primary **"Start →"** (L103–140). Desktop **rows** with optional **ghost "View"** + filled **"Start visit →"** (L190–198); meta includes **DOB · MRN · last visit · SOAP** (L194).
   - **Needs attention:** Single warning card, count pill, lines "2 notes ready to sign · 1 draft…", CTA "Go to drafts →" (mobile L143–149; desktop L236–245).
   - **Stats:** "Notes due to sign this week" + subline "2 are overdue" (L248–253).
   - **Tokens:** CSS vars `--color-*`, `--border-radius-*`, `--primary`; hardcoded warning brown `#633806`, `#BA7517` (e.g. L35–37).

2. **`home_desktop_patient_row_refined.html`**
   - **Greeting subline:** "Tuesday, Apr 29 · **5 patients on schedule**" (L81).
   - **Search:** "Search patient by name or MRN…" (L86).
   - **Recent list:** **Multi-line flex rows** (not a table): teal-tint avatar `rgba(15, 110, 86, 0.08)` (L36), **name + age/sex** (L114–116), **labeled DOB/MRN** with `var(--font-mono)` (L118–127), **"Last visit"** uppercase label in visit line (L128–134).
   - **Actions:** **View** (outline) + **Start visit →** (fill `#0F6E56`, L58); optional **status chip** "1 unsigned" with dot (L54–56, L137–138).
   - **Right column:** Needs attention + **stat row** (L68–71 area in CSS; markup continues after L200).

3. **`home_desktop_patient_row_v3.html` vs refined — differences**
   - **v3** uses a **table grid** with explicit column headers: Patient / Identity / Last visit (L107–113); **refined** has no column headers — stacked typography in a row.
   - **v3** adds **3px left accent** for rows needing action (`warn`, L39–40, L115–116); refined relies on a **pill chip** for "unsigned" instead.
   - **v3** patient subline **`v3-pdemo`** includes "Established / New patient" (L119); refined uses **age · sex** on name row.
   - **v3** often shows **only primary "Start visit →"** in the action column (L129–132); refined consistently shows **View + Start** (L138–141).
   - **Spacing:** v3 outer padding **28px** (`v3-h` L7); refined **24px** (`r-desktop-h` L7).

4. **`home_desktop_full_width_patient_list.html`**
   - **Full-width table** grid (L28–31); **footer** `f-footer` two-column: attention + stat card on secondary background (L52–53, L188–196).
   - Slightly **denser** typography (e.g. `f-greet-name` 20px L8 vs 22px in refined/v3).

## Production summary

Home now ships embedded patient search/autocomplete, wider desktop shell, and a two-column desktop IA (`list-first + right rail`) while keeping mobile as a single-column stack.

```355:572:src/app/(clinical)/home/page.tsx
    <div className="mx-auto w-full max-w-[800px] px-5 py-8 md:px-8">
      {/* Greeting */}
      <header className="mb-10">
        <h1 className="text-[28px] font-medium leading-tight tracking-tight text-foreground/95">
          Good {greetingPeriod()}, {greetingName}
        </h1>
        <p className="mt-2 text-[15px] leading-[1.7] text-muted-foreground/70">{todayLine}</p>
      </header>
      // ... no-seat gate, primary action section with Button + Mic ...
      {/* Needs attention */}
      <section className="mb-10">
        <h2 className="text-base font-medium uppercase tracking-[0.08em] text-muted-foreground/65">
          Needs attention
        </h2>
        // ... unsignedNotes, draftsInProgress, flaggedNotes as separate cards ...
      </section>
      {/* Recent patients */}
      <section className="mb-10">
        <h2 className="text-base font-medium uppercase tracking-[0.08em] text-muted-foreground/65">
          Recent patients
        </h2>
        // ... rows: name, formatVisitLine(note), StatusBadge, icon-only Mic ...
        <Link href="/patients" className="mt-4 ...">View all patients →</Link>
      </section>
      {/* Quick stats */}
      {showStats && (
        <section>
          // ... Notes this week, Avg per day, Pending review ...
        </section>
      )}
    </div>
```

Resume/start copy is split between `buildHomeHero` (`home-state.ts`) and inline button labels:

```59:89:src/app/(clinical)/home/home-state.ts
  if (activeRecordingOverride) {
    return {
      mode: "resume",
      title: "Resume Recording",
      description: `Return to ${patientName(activeRecordingOverride.patient)} and continue the encounter.`,
      ctaLabel: "Resume Recording",
      href: `/capture/${activeRecordingOverride.id}`,
```

```383:397:src/app/(clinical)/home/page.tsx
        <Button
          className="mt-6 h-[52px] w-full min-h-[52px] gap-2 text-base font-medium sm:w-auto sm:min-w-[220px]"
          ...
        >
          {hero.mode === "resume" ? (
            <>
              <Mic className="h-5 w-5" />
              {hero.ctaLabel}
            </>
          ) : (
            <>
              <Mic className="h-5 w-5" />
              Start visit
            </>
          )}
        </Button>
```

`statusBadge` maps note status to **semantic variants** consumed by `<StatusBadge>` (not raw `bg-blue-100` classes):

```76:90:src/app/(clinical)/home/page.tsx
function statusBadge(note: ApiNote): {
  label: string;
  variant: "success" | "warning" | "info" | "neutral";
} {
  if (REVIEW_READY_STATUSES.has(note.status)) {
    if (note.status === "REVIEWING" || note.status === "PENDING_REVIEW") {
      return { label: "Review", variant: "warning" };
    }
    return { label: "Draft", variant: "info" };
  }
```

## Element-by-element diff

**Header**
- **Mockups:** Search-in-header (desktop), optional **user avatar**, subline "**N patients on schedule**" (refined/v3/full_width).
- **Production:** Search is now embedded directly under header via `HomePatientSearch`; subtitle now includes a schedule-like count from recent queue rows. Avatar remains absent.

**Body — primary / resume**
- **Mockups:** **Dedicated resume strip** above list (danger surface, patient name, time, arrow CTA).
- **Production:** Resume folded into **hero card** with left border accent (L376–402); no separate strip; `hero.title`/`description` from `buildHomeHero`.

**Body — search**
- **Mockups:** Embedded field + ⌘K; legend says it replaces modal-first flow (mockup L264).
- **Production:** Embedded patient search/autocomplete is now present (`HomePatientSearch`), and row selection starts the visit wizard scoped to the selected patient.

**Body — recent patients**
- **Mockups:** DOB/MRN/last visit/SOAP/**provider**; **View** + **Start visit →**; mobile **labeled** "Start →"; optional **unsigned** accent/chip.
- **Production:** Name + visit meta + DOB/MRN; row includes labeled start action (`Start visit →`) instead of icon-only mic.

**Body — needs attention**
- **Mockups:** **One** card with aggregate copy + one CTA.
- **Production:** now uses a single aggregated attention card in the right rail with unified counts and one CTA (`Go to drafts →`), closer to mockup IA.

**Body — stats**
- **Mockups:** Right column or footer: "**Notes due to sign this week**" + overdue subcopy (mockup L248–253).
- **Production:** Three tiles: **Notes this week**, **Avg per day**, **Pending review** (L551–569) — different framing.

**Footer**
- **Mockups:** Cap/legend only; no app chrome footer.
- **Production:** None beyond content.

**Interactions**
- **Mockups:** ⌘K focus on search; row hover states (refined L34); table hover (v3 L37).
- **Production:** Search now includes shortcut chrome (`⌘K` / `Ctrl+K`) and cmd/ctrl-k focus behavior; Mic `h-9 w-9` (L528) remains a candidate vs mockup **labeled** buttons / 44px+ targets per Task #5 guidance in `01-quick-wins.md` L104–112.

## Copy diff

| Mockup | Production |
|--------|------------|
| "Search patient or start a visit…" / variants | (no home search) |
| "Resume recording →" / "Resume →" | "Resume Recording" (`home-state.ts` L64–L75; button shows `hero.ctaLabel`, `page.tsx` L390–391) |
| "Start visit →" / "Start →" | "Start visit" when starting (`page.tsx` L396); resume mode uses `hero.ctaLabel` |
| "Go to drafts →" | "Review & Sign →" / "Continue →" / "Review →" (`page.tsx` L441–484) |
| "View all →" (recent section) | "View all patients →" (`page.tsx` L537–541) |
| Needs attention: single summary line | Split headlines: "ready to sign", "drafts in progress", "unresolved flags" |
| `buildHomeHero` still returns `ctaLabel: "Start New Visit"` (`home-state.ts` L86) | **Unused** in start mode — UI hardcodes "Start visit" (`page.tsx` L396), so strings **diverge** across layers |

## Token / styling diff

- **Hardcoded / semantic CSS vars in mockups:** `#633806`, `#BA7517`, `#0F6E56`, `rgba(15,110,86,0.08)` (mockup CSS) — **production** leans on **Tailwind + theme vars** (`border-l-primary`, `text-muted-foreground/70`, `var(--status-warning)` in attention cards L428).
- **Layout width:** Production `max-w-[800px]` (`page.tsx` L355) vs mockup **full-bleed** desktop frames; **`home_desktop_full_width_patient_list.html`** explicitly rejects clipping (sr-only L1).
- **Section labels:** Mockups use ~11px caps; production uses `text-base` for section `h2` (`page.tsx` L420–L421) vs Phase 0 **`SectionLabel`** tracking `0.12em` (`src/components/ui/section-label.tsx` L41–42) — **home does not import `SectionLabel`**.
- **Recent row meta:** `text-muted-foreground/70` (`page.tsx` L517) — **still reduced-opacity secondary text**; Task #3 (`01-quick-wins.md` L68–80) targets stronger contrast for **DOB/MRN**, but home **does not render** those identifiers on recent rows (gap is structural, not only contrast).

## Refactor recommendations

1. ~~**`src/app/(clinical)/home/page.tsx` — desktop layout + patient row density**~~ **DONE** — desktop now uses list + right-rail IA with wider shell and labeled row start actions.
2. ~~**`src/app/(clinical)/home/page.tsx` + new search component — embedded patient search / ⌘K**~~ **DONE (search)** — embedded patient search/autocomplete shipped; keyboard shortcut chrome remains optional polish.
3. ~~**`src/app/(clinical)/home/page.tsx` — consolidate Needs attention**~~ **DONE** [effort: **M**] [risk: **low**]
   Single card + unified CTA hierarchy shipped (`Go to drafts →`) with aggregated summary line.
4. ~~**`src/app/(clinical)/home/home-state.ts` + `page.tsx` — copy sync**~~ **DONE** [effort: **XS**] [risk: **low**]
   Start-mode CTA copy is synchronized on `Start visit`; stale `"Start New Visit"` divergence is removed.
5. ~~**`src/app/(clinical)/home/page.tsx` — adopt `<SectionLabel>`~~ **DONE** [effort: **XS**] [risk: **low**]
   Section headings now use `SectionLabel` for normalized tracking/semantics.
6. ~~**Touch targets for row actions**~~ **DONE** [effort: **S**] [risk: **low**]
   Recent-row start action now uses labeled `h-11` control with icon + text across breakpoints.

## Cross-reference to `cursor-tasks/01-quick-wins.md`

- **Task #1–2 (capture):** Not applicable on home.
- **Task #3 (patient identity contrast):** Home **recent list omits DOB/MRN**; secondary line uses `/70` opacity (`page.tsx` L517) — **partially aligned** intent (visit context still muted).
- **Task #4 (`statusBadge` / hardcoded badge colors):** `statusBadge()` is a **variant picker**; rendering uses `<StatusBadge>` (`page.tsx` L519–521). **Quick-win doc is partly stale** — no `bg-blue-100` here; remaining work is **IA/layout**, not badge palette.
- **Task #5 (touch targets):** Mic-only control **`h-9 w-9`** (`page.tsx` L528) — **candidate**.
- **Task #6 (🎙 emoji / "Start New Visit"):** **Verify:** Production uses **`<Mic className="h-5 w-5" />`** and **"Start visit"** in start mode (`page.tsx` L388–397) — **no** `🎙`; **Task #6 appears already done** for the main CTA. Remaining: `buildHomeHero` still says **"Start New Visit"** when `mode==="start"` but UI **overrides** copy (`home-state.ts` L86 vs `page.tsx` L396).
- **Task #7 ("Start free testing" → trial):** **No** matches under `src/app/(clinical)/home` for those strings (grep: none) — **N/A** for clinical home.

**Phase 2+ candidates (from doc + this gap pass):** Desktop/tablet **home information architecture** (search-first, schedule subline, table/list parity), **single attention card**, **patient search on home** (explicitly Phase 8, `01-quick-wins.md` L191), optional **footer stat strip** variant from `home_desktop_full_width_patient_list.html`.
