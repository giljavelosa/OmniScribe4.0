# Patient detail — Mockup Gap Analysis

## At a glance
- **Mockup file(s):** `design-mockups-2026-05/patient_detail_dashboard_mockup.html` (250 lines)
- **Production file(s):** `src/app/(clinical)/patients/[id]/page.tsx` (728 lines); related navigation: `src/app/(clinical)/patients/[id]/episodes/page.tsx` (272 lines); `src/app/(clinical)/patients/[id]/episodes/[episodeId]/page.tsx` (625 lines)
- **Coverage estimate:** built ~80% / partial ~14% / missing ~6%
- **Top blocking issue:** Remaining gap is now mostly final visual/token polish; right-rail context depth and secondary-rail framing are closer to mockup parity, and episode timeline status chips are now tokenized.

## Mockup summary

**Layout & structure** (`patient_detail_dashboard_mockup.html`)
- **Back:** "← All patients" (L75).
- **Header (`pd-h`, L8–21):** Name + demo string ("68 · Female · Established · Family Medicine", L81); **labeled DOB / MRN / Last visit** blocks with mono values (L83–95); **contact** phone + email (L97); right actions: overflow "⋯" + **primary "Start visit →"** (L99–102).
- **Snapshot strip (`pd-snapshot`, L23–28, L105–128):** Horizontally scrolling-friendly row: **BP, HR, BMI, A1C, Tdap** with dates; uppercase micro-labels.
- **Body grid (`pd-grid`, L30–31):** `1.3fr / 1fr`; **left:** "Recent visits" cards with datetime, mode, provider, **status pill** (unsigned vs signed, L46–48), **Assessment snippet** (L139–179); "View all (12) →".
- **Right column (`pd-col-r`, L32):** On **secondary background**: **Active conditions** (bullets + "Since" meta, L184–194), **Allergies** (severity dots, L196–204), **Medications** (L206–215), **Active goals** (L217–225), **Episodes of care** card with ICD, day x of y, visit count, **progress bar**, foot ("Last visit … / N days remaining", L227–245).
- **Tokens:** Same pattern as home mocks — CSS vars + `#0F6E56` primary button (L21), callout green (L69).
- **Callouts:** Numbered circles on Snapshot, Recent visits, conditions, allergies, goals (through L219).

## Production summary

**`/patients/[id]/page.tsx`** — wide two-column dashboard with identity header, snapshot strip, start/resume actions, episodes, visit history, and right-rail clinical context cards.

```293:320:src/app/(clinical)/patients/[id]/page.tsx
    <div className="mx-auto w-full max-w-[800px] px-5 py-8 md:px-8">
      {/* Back link */}
      <Link href="/patients" className="inline-flex items-center gap-1.5 text-[14px] leading-[1.7] text-muted-foreground/70 ...">
        <ArrowLeft className="h-4 w-4" />
        All patients
      </Link>

      {/* Header */}
      <header className="mt-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[24px] font-medium leading-tight tracking-tight text-foreground/95">
            {patient.firstName} {patient.lastName}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] leading-[1.7]">
            {patient.dob && <span className="text-foreground/85">DOB {formatPatientDob(patient.dob)}</span>}
            {patient.mrn && <span className="text-foreground/85">&middot; MRN {patient.mrn}</span>}
            {patient.phone && <span className="text-muted-foreground/70">&middot; {patient.phone}</span>}
          </div>
        </div>
        {!editing && (
          <Button variant="outline" size="sm" ... onClick={startEditing}>
            <Pencil className="h-3 w-3" /> Edit
          </Button>
        )}
      </header>
```

**Primary actions & drafts**

```419:474:src/app/(clinical)/patients/[id]/page.tsx
      <section className="rounded-lg border border-border/50 bg-card p-5 space-y-3">
        {activeDraft ? (
          <>
            ...
            <div className="flex gap-2">
              <Button className="h-11 flex-1 text-[15px]" onClick={() => router.push(linkForNote(activeDraft))}>
                Resume Draft
              </Button>
              <Button variant="outline" className="h-11 flex-1 border-border/50 text-[15px]" onClick={startVisit} disabled={starting}>
                <Play className="mr-1.5 h-3 w-3" />
                {starting ? "Starting…" : "Start New Visit"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Button className="h-12 w-full text-[15px]" onClick={startVisit} disabled={starting}>
              <Play className="mr-2 h-4 w-4" />
              {starting ? "Starting…" : "Start New Visit"}
            </Button>
```

**Episodes — `EFFECTIVE_STATUS_PILL` (Task #4 site)**

```84:94:src/app/(clinical)/patients/[id]/page.tsx
const EFFECTIVE_STATUS_PILL: Record<
  EffectiveEpisodeStatus,
  { label: string; variant: EpisodeStatusPillVariant; Icon: typeof Activity }
> = {
  ACTIVE: { label: "Active", variant: "info", Icon: Activity },
  ON_HOLD: { label: "On hold", variant: "warning", Icon: Clock },
  RECERT_DUE: { label: "Recert due", variant: "warning", Icon: AlertTriangle },
  EXPIRED_CERT: { label: "Cert expired", variant: "danger", Icon: AlertTriangle },
  DISCHARGED: { label: "Discharged", variant: "neutral", Icon: Check },
  CANCELLED: { label: "Cancelled", variant: "neutral", Icon: X },
};
```

Rendered with **`<StatusBadge variant={pill.variant} icon={...}>`** (L527–533) — **already** Phase-0-aligned; map is **semantic**, not `bg-amber-100`.

**Visit history scope**

```287:290:src/app/(clinical)/patients/[id]/page.tsx
  const activeDraft = patient.notes.find((n) =>
    isClinicalDraftWorkflowStatus(n.status),
  );
  const completedNotes = patient.notes.filter((n) => ["SIGNED", "TRANSFERRED"].includes(n.status));
```

```679:707:src/app/(clinical)/patients/[id]/page.tsx
      {completedNotes.length > 0 && (
        <section>
          <h2 className="text-base font-medium uppercase tracking-[0.08em] text-muted-foreground/65">
            Visit History ({completedNotes.length})
          </h2>
          <div className="mt-4 space-y-3">
            {completedNotes.map((note) => (
              <Link key={note.id} href={`/sign/${note.id}`} ...>
```

**Episode list / detail** (for cross-route completeness)
- **`episodes/page.goals`:** Goal **previews** + progress bar by certification timeline (e.g. L226–236).
- **`[episodeId]/page.tsx`:** **Goal progress entries**, Medicare report generation, visit timeline (`GoalDetailCard`, L117–243; timeline L582–619). Hardcoded **`Badge` emerald** for signed notes (L608–617) — **separate** from patient dashboard mockup but relevant to **token consistency**.

## Element-by-element diff

**Header**
- **Mockup:** Demo string; **Last visit** in header ID row; **email**; overflow + **Start visit** (`patient_detail_dashboard_mockup.html` L79–102).
- **Production:** Header now includes contact + last-visit context line; `Start visit` copy is aligned in the action panel. Demo/Established string and overflow-menu chrome remain different.
- **Task #3:** DOB/MRN remain high-contrast on the header surface and now sit alongside read-only contact/last-visit context for quicker verification.

**Snapshot strip**
- **Mockup:** Full vitals/labs immunization snapshot (`patient_detail_dashboard_mockup.html` L105–128).
- **Production:** Present via `PatientSnapshotStrip` (division-aware registry + override support).

**Body — recent visits**
- **Mockup:** **Chronological cards** for multiple visits including **unsigned** with **Assessment excerpt** (`patient_detail_dashboard_mockup.html` L131–179).
- **Production:** Dedicated visit-history lane exists with snippets and mixed status handling via row routing; in-flight context is also surfaced by the start/resume action panel.

**Body — right rail (clinical context)**
- **Mockup:** Conditions, allergies, medications, goals, episode summary **on patient root** (`patient_detail_dashboard_mockup.html` L183–246).
- **Production:** Right rail ships with `ActiveGoalsCard`, `WatchCard`, and `OpenFollowUpsCard`, plus explicit semantic labeling (`Clinical context (conditions, allergies, meds, goals)` and `Conditions / allergies / meds` card heading) and per-category summary chips for richer quick-glance context. Episode summaries remain visible on patient root.

**Footer**
- **Neither** mock nor production adds a persistent app footer; episode pages use sticky headers (`episodes/page.tsx` L127–141).

**Interactions**
- **Mockup:** "Edit" on conditions (`patient_detail_dashboard_mockup.html` L186); "View all →" on episodes (L229).
- **Production:** Episode **recert/reopen** justification modal (`page.tsx` L607–676); **StartDocumentingModal** for visits (`page.tsx` L719–724); no inline edit for clinical lists (non-demographics).

## Copy diff

| Mockup | Production |
|--------|------------|
| "Start visit →" (header) | "Start visit" in action panel; wizard-driven |
| "← All patients" (text glyph) | `<ArrowLeft /> All patients` (`page.tsx` L295–300) |
| "Recent visits" + assessment snippets | "Visit History" with snippets is now present via row components and patient API payload |
| "Active conditions", "Allergies", … | Represented via `Clinical context` + `Conditions / allergies / meds` + goals/follow-ups cards; data depth still differs from mockup bullets |
| Episode foot: "30 days remaining" | Episode meta uses cert days + `daysUntilExpiry` (`page.tsx` L541–548, L588–590) — **similar semantics**, different presentation |

## Token / styling diff

- **Layout:** Production now uses wide shell (`max-w-[1400px]`) with desktop two-column grid, aligned to mockup intent.
- **Right column surface:** Mockup **`background: var(--color-background-secondary)`** on `pd-col-r` (`patient_detail_dashboard_mockup.html` L32); production stacks **white cards** on default background — **no** contrasting context rail.
- **Status on visits:** Mockup pills use semantic success/warning `var`s (L46–48); production uses `StatusBadge` + `noteStatusVariant` in visit history (`page.tsx` L703–705).
- **Episode detail page:** timeline status chips use semantic `StatusBadge` variants (`success` / `neutral`) — token parity is aligned with patient root status surfaces.

## Refactor recommendations

1. ~~**`src/app/(clinical)/patients/[id]/page.tsx` — two-column dashboard shell**~~ **DONE** — two-column shell, snapshot strip, visit history, and context rail are live.
2. ~~**New API + read-only widgets — snapshot strip**~~ **DONE** — snapshot strip + snippets APIs are implemented and consumed by the page.
3. ~~**`src/app/(clinical)/patients/[id]/page.tsx` — visit list semantics**~~ **DONE (baseline)** — visit-history lane and in-flight resume/start context now coexist on patient root.
4. ~~**Copy + CTA alignment**~~ **DONE** [effort: **XS**] [risk: **low**]
   `Start visit` copy is now harmonized with home and patient root action surfaces.
5. ~~**`src/app/(clinical)/patients/[id]/episodes/[episodeId]/page.tsx` — replace emerald `Badge` with `StatusBadge`**~~ **DONE**
   Episode timeline chips now use `StatusBadge` token variants; no hardcoded emerald badge palette remains.

## Cross-reference to `cursor-tasks/01-quick-wins.md`

- **Task #3:** Patient header DOB/MRN at **`text-foreground/85`** (`page.tsx` L310–311) — **aligns** with quick-win intent; phone still **muted `/70`** (L312).
- **Task #4:** **`EFFECTIVE_STATUS_PILL`** (`page.tsx` L84–94) **already** feeds `<StatusBadge>` (L527–533) — **patient page map is not the leftover hardcoded badge problem**; episode detail **timeline `Badge`** still is (see recommendation #5).
- **Task #5:** Various `size="sm"` controls — audit if this page is tapped on tablets.
- **Task #6–7:** Not specific to patient detail.

**Phase 2+ candidates:** Patient-level **clinical summaries** (conditions/allergies/meds/goals) if they become first-class data; **unsigned visit** preview with **clinician-verified** snippet policy per `.cursorrules` (no fabricated assessments); integrate **episode + goal progress** summaries upward from `[episodeId]` into patient root for continuity.

## Three-lens check (`.cursorrules`)

- **Clinician lens:** Production **excels** at **"what do I do next"** (resume draft, start visit, open episode). It **under-delivers** on **at-a-glance longitudinal context** mocked in the right rail (problems, meds, allergies, active goals on one screen) — clinicians must **navigate episodes** for goal/trace detail (`/episodes/[episodeId]`).
- **Medicare compliance lens:** **Episodes** on patient page surface cert timing, visit counts, recert/reopen with **auditable justification** (`page.tsx` L186–202, L628–631) — **strong** vs mockup's simplified episode card. **Progress-report cadence** is **explicit** on episode detail (`.../[episodeId]/page.tsx` L362–371, L484–491).
- **Insurance auditor lens:** **Visit History** emphasizes **immutable signed** artifacts (`page.tsx` L290, L689) — good for **final record** audit, but **no** patient-page thread from **diagnosis → goals → visit note snippet** as in mockup; traceability is **distributed** (episode detail + signed note).

## Cross-route note

Rich **goal progress / AI evidence** exists on **`/patients/[id]/episodes/[episodeId]`** (`GoalDetailCard` shows `aiExtractedEvidence`, `clinicianOverride`, L225–228) — **strong** compliance-adjacent UX **not** surfaced on the **patient dashboard** mockup's parent page. Closing the mockup gap is partly **elevation of existing episode data** into `/patients/[id]`, not only net-new UI.
