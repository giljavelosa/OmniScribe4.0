# Capture flow — Mockup Gap Analysis

## At a glance

- **Mockup file(s):** `design-mockups-2026-05/capture_screen_two_stage_mockup.html` (215 lines), `design-mockups-2026-05/capture_mobile_two_stage_mockup.html` (167 lines)
- **Production file(s):** `src/app/(clinical)/capture/[noteId]/page.tsx` (~1175 lines) plus `src/app/(clinical)/capture/[noteId]/_components/` (**19+ modules**, including Phase 04c: `SectionProgressStrip.tsx`, `SectionProgressCell.tsx`, `SectionRegenerateConfirmDialog.tsx`, `SectionRegenerateNotice.tsx`) and `src/hooks/useSectionProgress.ts` (~537 lines). Core modules unchanged from prior inventory: `CaptureHeader.tsx`, `CaptureTrustHeader.tsx`, `MobileCaptureLayout.tsx`, `DesktopCaptureLayout.tsx`, `RecordingControls.tsx`, `TranscriptPanel.tsx`, `LiveNotePanel.tsx`, `PriorContextPanel.tsx`, `DocumentationSetupPanel.tsx`, selectors, banners, resume screen, etc.
- **Coverage estimate:** built **~91%** / partial **~5%** / missing **~4%** *(updated 2026-05-07 after mobile attention-dot + prior-goal accent token pass)*
- **Top blocking issue:** Remaining deltas are now mostly optional deeper setup simplification and minor visual rhythm polish; primary capture status/chrome accents, live-line transcript accent, follow-up action chips, and mobile attention dots are semantic-token aligned.

## Mockup summary

**Desktop (`capture_screen_two_stage_mockup.html`)**

- **Frames:** `.frame` — `background: var(--color-background-primary)`, hairline `var(--color-border-tertiary)`, `border-radius: var(--border-radius-lg)`.
- **Stage 1 — Listening:** `.appbar` (`.back`, `.patient-name`, `.patient-meta`), right cluster `.rec-pill` (`.rec-dot`, `.rec-text` "Recording", `.meter` 4 bars, numbered `.callout`), `.timer` `var(--font-mono)` tabular nums; main grid **65% / 35%** — left "Transcript" (`.section-tag`, `.utterance`, `.speaker.a` / `.speaker.b` hex greens/blues, `.line.live` left border `#5DCAA5`); right column two `.card`s — "Setup" with "Adjust" link + body "SOAP · Hybrid / Family Med template", second card "Prior context" + goal rows (`.goal-dot` `#1D9E75`). Footer `.actions`: `.btn-icon` pause, `.btn-primary-loud` teal `#0F6E56` "Start drafting", `.btn-ghost-quiet` "Finish".
- **Stage 2 — Drafting:** Same app bar; pill copy "Recording · drafting"; grid **16% / 36% / 48%** — narrow "Prior" peek rail (`.peek-label`, `.peek-line`, active goals), middle transcript (speaker line includes "likely clinician" callout **5**), right "Live note" with `.progress-strip` (S, HPI, Exam, Assess., Plan — checks, empty/active dots), stacked `.note-section` with `.note-regen` "↻", `.note-pending` italic; footer "Save draft" outline + "Finish & review →" primary.
- **Design tokens in mockup:** `var(--color-background-primary|secondary)`, `var(--color-border-*)`, `var(--color-text-primary|secondary|tertiary|danger|success|info)`, `var(--border-radius-md|lg)`, `var(--font-mono)`; **hardcoded** accents: `#0F6E56`, `#5DCAA5`, `#1D9E75`, `#185FA5`, speaker greens/blues.

**Mobile (`capture_mobile_two_stage_mockup.html`)**

- **Chrome:** `.phone`, `.phone-statusbar`, `.phone-appbar` with `.rec-pill-mini` + `.meter-mini` + `.timer-mini` (timer in danger color); **tabs** `.tabs` / `.tab` / `.tab.active` underline `#0F6E56`, `.tab-dot` on inactive tab for "new content".
- **Stage 1:** Tabs "Transcript" (active), "Setup" (dot), "More"; body transcript; `.bottom-bar` `||` 40px circle, **single** `.btn-primary-mobile` "Start drafting", `⋯` menu.
- **Stage 2:** Tabs "Live note" (active), "Transcript" (dot), "More"; **sticky** `.progress-mini` section progress; note sections + `.bottom-bar` "Finish & review →".
- **Annotations A–F:** Tabs replace split; auto-switch + 1s toast; tab order by stage; teal dot on tabs with unread updates; one primary CTA per stage (no competing red Finish); sticky progress on Live note.

## Production summary

Orchestration lives in `page.tsx`: recording via `useRecordingStream`, documentation setup via `useDocumentationSetup`, live generation via `useLiveGeneration`, mobile tab state and `noteHasUpdate`, desktop history `Sheet`, trust header + dual layouts.

**Phase 04c (2026-05 — merged):** **`useSectionProgress`** seeds from `GET /api/notes/[id]` → `progressStrip`, subscribes to **`/api/notes/[id]/stream?include=sections`**, and wires **`SectionProgressStrip`** + **`SectionRegenerateNotice`** + **`SectionRegenerateConfirmDialog`** immediately below **`CaptureTrustHeader`** (capture-only; spec forbids prepare/review shells). Per-section **↻** triggers POST regenerate with overwrite confirm when edits exist. This closes the prior gap-analysis bullets “no progress strip / no per-section regen” at the **functional** level; **visual/sticky/tab** parity with HTML comps remains **partial** (see Body — Desktop/Mobile below).

```991:1040:src/app/(clinical)/capture/[noteId]/page.tsx
  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background">
      <CaptureTrustHeader ... />
      <SectionProgressStrip strip={progressStripState} ... />
      <SectionRegenerateNotice notices={regenNotices} ... />
      <DesktopCaptureLayout ... />
      ...
      <MobileCaptureLayout ... />
      ...
      <SectionRegenerateConfirmDialog ... />
    </div>
  );
```

Desktop layout: transcript `flex-1` left; right rail now stage-tuned (`~35%` pre-draft / `~64%` draft-started) with nested prior peek rail at ~25% of the right pane, moving proportion rhythm closer to mockup's 65/35 then 16/36/48 intent while keeping existing component architecture.

```32:77:src/app/(clinical)/capture/[noteId]/_components/DesktopCaptureLayout.tsx
<div className="hidden min-h-0 flex-1 items-stretch overflow-hidden lg:flex">
  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    {/* transcript + controls */}
  </div>
  <div
    className={`flex min-h-0 shrink-0 self-stretch flex-col overflow-hidden border-l border-border/60 bg-card/30 ${
      draftStarted ? "w-[min(46vw,680px)]" : "w-[400px]"
    }`}
  >
    {setupPanel}
    <div className="min-h-0 flex-1 overflow-hidden">{bodyPanel}</div>
  </div>
</div>
```

Trust header implements recording pill tones, pulse, **three-bar** `AudioLevelBars`, and monospaced timer.

```94:147:src/app/(clinical)/capture/[noteId]/_components/CaptureTrustHeader.tsx
      <div className={cn("flex shrink-0 items-center gap-3 rounded-2xl border px-3 py-1.5 ...", sessionTrustToneClasses)}>
        ...
        {isRecording && <AudioLevelBars level={audioLevel} />}
        ...
        <p className="font-mono text-[22px] font-semibold tabular-nums ...">{formatTime(elapsed)}</p>
      </div>
```

Recording controls: pre-draft **filled** "Start drafting" + **ghost** "Finish"; post-draft disabled "Draft Started" chip + peer row actions **outline** "Save Draft" and **default** "Finish & Review →".

```62:109:src/app/(clinical)/capture/[noteId]/_components/RecordingControls.tsx
          <div className="flex items-center gap-3">
            {!draftStarted ? (
              <Button size="lg" onClick={onStartDraft} ... className="h-12 rounded-full px-6">
                {isApplyingSetup ? "Starting..." : "Start drafting"}
              </Button>
            ) : (
              <Button size="lg" disabled className="h-12 rounded-full border-2 border-[var(--status-success-border)] bg-[var(--status-success-bg)] ...">
                <Check ... />
                Draft Started
              </Button>
            )}
            {draftStarted ? (
              <>
                <Button size="lg" variant="outline" onClick={onSaveDraft} ...>
                  <Save className="mr-2 h-3.5 w-3.5" />
                  Save Draft
                </Button>
                <Button size="lg" variant="default" onClick={onFinish} ...>
                  Finish & Review →
                </Button>
              </>
            ) : (
              <Button size="lg" variant="ghost" onClick={onFinish} ...>
                <Square className="mr-2 h-3.5 w-3.5" />
                Finish
              </Button>
            )}
          </div>
```

Mobile tabs are stage-aware **three-tab sets** with **More** overflow:
- pre-draft: `Transcript / Setup / More`
- post-draft: `Live note / Transcript / More`
with unread dots for setup/transcript/note and a 1s “Drafting started” toast when auto-switching to Live note.

```56:71:src/app/(clinical)/capture/[noteId]/_components/MobileCaptureLayout.tsx
        <TabsList className="mx-4 shrink-0">
          {draftStarted ? (
            <>
              <TabsTrigger value="note">Live note</TabsTrigger>
              <TabsTrigger value="transcript">Transcript</TabsTrigger>
              <TabsTrigger value="more">More</TabsTrigger>
            </>
          ) : (
            <>
              <TabsTrigger value="transcript">Transcript</TabsTrigger>
              <TabsTrigger value="setup">Setup</TabsTrigger>
              <TabsTrigger value="more">More</TabsTrigger>
            </>
          )}
        </TabsList>
```

`LiveNotePanel` shows status line, section counts, turn count, and stacked sections — **still no** mockup-style strip **inside** this panel; progress + ↻ live in **`SectionProgressStrip`** on **`page.tsx`** (above the desktop/mobile split). Clinicians see strip + regen at capture scope, not duplicated per mockup’s “inside Live note card” layout.

```51:158:src/app/(clinical)/capture/[noteId]/_components/LiveNotePanel.tsx
      <div className="border-b border-border/40 px-5 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          ...
              {statusLabel}
            ...
                {populatedSectionCount}/{sections.length} sections
            ...
                  ? `${utterancesSentCount} transcript turns`
                  : "Listening"}
```

Transcript uses neutral speaker labels only (clinical safety), teal/sky Tailwind for A/B, live line `border-primary/25`.

```7:24:src/app/(clinical)/capture/[noteId]/_components/TranscriptPanel.tsx
// Diarization clusters are NOT clinical roles — ...
const SPEAKER_LABELS: Record<string, string> = { A: "Speaker A", B: "Speaker B", UNKNOWN: "Speaker" };
function speakerColor(label: string): string {
  if (label === "A") return "text-sky-700/80";
  if (label === "B") return "text-teal-700/80";
```

## Element-by-element diff

### Header

- Mockup [Stage 1 appbar, lines 58–74] back chevron + patient block + **inline** recording pill, meter, **short** timer; prod [`CaptureTrustHeader.tsx`] still uses a separate trust card (intent-aligned, not pixel-identical), but timer now formats to short `MM:SS` while under one hour.
- Mockup patient-meta includes **visit modality** ("In person") with DOB/MRN [`lines 62–63`]; prod header now includes visit type in `captureIdentityMeta` (`page.tsx`) alongside DOB/MRN.
- Mockup Stage 2 pill text "Recording · drafting" [`lines 136–138`]; prod now mirrors this copy via `session-trust.ts` secondary label when drafting is active.
- Mockup callout **1** targets meter-in-pill; prod meters exist in **trust header** [`CaptureTrustHeader.tsx:126`] — **concept covered**, placement differs from mockup composite pill.

### Body — Desktop

- Mockup Stage 1 **65/35** transcript / sidebar [`lines 77–112`]; prod now uses a stage-aware right pane closer to this ratio (`w-[min(35vw,520px)]`) — **much closer**, not exact.
- Mockup right column **compact Setup card** + Prior context card with "Adjust" [`lines 98–111`]; prod now keeps a compact desktop setup summary card (type/style/template + `Edit setup`) before the live body, while deeper setup controls still live in sheet/panel form.
- Mockup Stage 2 **three-column** grid with dedicated **Prior peek rail** [`lines 145–206`]; prod uses draft-stage right-pane expansion (`w-[min(64vw,960px)]`) plus a quarter-width prior rail (`clamp(148px,25%,220px)`), bringing practical rhythm closer to 16/36/48 with minor compactness differences.
- Mockup **progress strip** across note sections **inside** the Live note card [`lines 176–183`]; prod **`SectionProgressStrip`** sits **below the trust header**, full-width above the transcript/live-note split — **behavior shipped**, **placement differs** from comp (and `LiveNotePanel` unchanged for strip).
- Mockup **↻ regenerate** per section in stacked note sections [`lines 186–189`]; prod **↻ on strip cells** + confirm dialog on edited sections — **shipped** (API + SSE + optimistic UI); **not** duplicated inline on each `LiveNotePanel` section row.
- Mockup speaker line "Speaker A · **likely clinician**" [`line 158`]; prod deliberately stays neutral [`TranscriptPanel.tsx:7-9`] — **intentional clinical gap** (mockup assumes role inference UX not approved in code).

### Body — Mobile

- Mockup **3 tabs** + "More" bucket + **stage-dependent order** + **dots** on Setup/Transcript [`lines 68–71, 117–120, 158–165`]; prod now implements stage-dependent three-tab sets with `More`, setup/transcript/note attention dots using semantic status tokens, and stage-safe tab normalization.
- Mockup **auto-switch** tab + **1s "Drafting started" toast** [`annotation B, lines 160-161`]; prod now auto-switches to Live note and shows a one-second success toast.
- Mockup **sticky** section progress **inside** Live note tab [`lines 29, 122-128, 164-165`]; prod now renders the strip **inside the mobile Live note scroll container** with sticky behavior, while desktop keeps the strip under the trust header for scanability.
- Mockup bottom bar **⋯** overflow [`lines 91–95`]; prod now reinforces overflow affordance via iconized **More** tab label (`More` + `…` icon), while controls remain unchanged.

### Footer / actions

- Mockup Stage 1 primary "Start drafting" + ghost "Finish" [`lines 115–120`]; prod matches polarity pattern [`RecordingControls.tsx:63-108`] — **aligned** (Finish adds `Square` icon). **Phase 1 Task #1 already shipped** (see `CHANGES_LOG.md` 2026-05-04 entry).
- Mockup Stage 2 "Save draft" outline + "Finish & review →" primary [`lines 212–213`]; prod now mirrors this as peer row actions during draft-started state.

### Interactions / system

- Pipeline / mic errors: prod **`PipelineStatusBanner`**, **`CaptureErrorBanners`**, resume screen — richer than mockup; **not contradictory**.
- Leave while recording: prod **`ConfirmDialog`** [`page.tsx:948-964`] — **better** than older native `confirm()` called out in `design-critique-capture-flow.md`.
- **Clinician lens:** Neutral speaker labels support safe documentation; section strip + regen **now support** rapid correction during visit (Phase 04).
- **Medicare / insurance lens:** Anything that pushes "Finish" before setup/draft is a chart-quality risk; current ghost Finish + tooltip matches mitigation called out in critique.
- **Rule 16:** Stopping recording triggers `complete-stream` and routing to review/processing — if workers are not running, downstream drafting can appear "stuck"; relevant when validating this flow locally (`CLAUDE.md`).
- **Rule 11:** No direct Soniox usage in these components — abstraction preserved.

## Copy diff

| Mockup | Production | Notes |
|--------|------------|--------|
| "Recording · drafting" | "Recording" + "Recording · drafting" | Now aligned via trust secondary label |
| "Setup" / "Adjust" | "Documentation Setup", "Edit setup", sheet "Edit Note Setup" | Heavier framing [`DocumentationSetupPanel.tsx:451-504, 508-517`] |
| "Prior context" card | "Previous Visit — {date}", "Last Visit Summary", "Prior Context" sheet title | Different headings [`PriorContextPanel.tsx:86-87, 112-114`, `page.tsx:918-921`] |
| "Start drafting" | "Start drafting" | Match [`RecordingControls.tsx:70`] |
| "Finish" | "Finish" + stop icon | Match + icon [`RecordingControls.tsx:101-104`] |
| "Finish & review →" | "Finish & Review →" | Capitalization "Review" [`RecordingControls.tsx:106`] |
| "Save draft" (visible in stage 2 row) | "Save Draft" (outline peer in stage-2 row) | Now aligned at interaction level |
| Offline empty / listening | "Listening for speech" / "Loading transcript..." | [`TranscriptPanel.tsx:86-89`] |
| Section pending "Drafting from transcript…" | "Awaiting more clinical detail" / "Will update as more information is captured" | Different voice [`LiveNotePanel.tsx:136-140`] |
| "Speaker A · likely clinician" | "Speaker A" only | By design [`TranscriptPanel.tsx:7-14`] |

## Token / styling diff

**Mockup CSS variables not present as-named in `globals.css`:** mockup uses `--color-background-primary`, `--color-text-danger`, `--color-text-info`, etc.; repo maps a small subset (e.g. `--color-background` alias, `--font-mono`) — see `globals.css` grep — **most `--color-*` mockup names are nonexistent in prod theme**.

**Hardcoded Tailwind / hex in capture path (representative):**

- `bg-teal-500`, `bg-teal-400` — reduced; primary live-note accents moved to semantic status tokens.
- `text-sky-700/80`, `text-teal-700/80` — replaced in transcript speaker labels with semantic status tokens (`status-info` / `status-success`).
- `emerald-500` — reduced; setup/status indicators and follow-up action chips now use semantic success/info tokens.

**Spacing / sizing vs mockup**

- Mockup primary desktop buttons ~9–18px padding, 12px type; prod uses `Button` `size="lg"` + `h-12` pill shapes — **different silhouette** than mockup rounded rects.
- Mockup live line accent `#5DCAA5`; prod `border-primary/25` [`TranscriptPanel.tsx:125`] — **token mismatch** vs mockup spec green.

## Refactor recommendations

1. ~~**[`LiveNotePanel.tsx`, new small component]**~~ **DONE:** **`SectionProgressStrip`** + **`useSectionProgress`** deliver horizontal progress + ↻ with SSE reconciliation; mobile now mounts this strip inside `LiveNotePanel` scroll model with sticky behavior.
2. ~~**[`MobileCaptureLayout.tsx` + `page.tsx`] [L] [high]**~~ **DONE** — stage-based tab order, `More` overflow, setup/transcript attention dots, and 1s draft-start toast are shipped.
3. **[`DesktopCaptureLayout.tsx` + `page.tsx`] [L] [med]** — Stage 2 layout: optional **three-pane** or floating peek rail for prior context when `draftStarted` (mockup 16% rail) so prior goals stay glanceable — addresses clinician + audit "context while drafting" without inventing facts.
4. ~~**[`CaptureTrustHeader.tsx` + `session-trust.ts`] [S] [low]**~~ **DONE** — trust secondary label now reflects drafting state (`Recording · drafting`).
5. **[`TranscriptPanel.tsx`] [S] [med]** — If product approves **voice-ID assisted** "likely clinician" copy, gate behind confidence + **tap-to-confirm**; until then document mockup as **aspirational** (current code is safer for misidentification).
6. ~~**[`RecordingControls.tsx`] [XS] [low]~~ **DONE** — stage-2 controls now render **Save Draft** (outline) + **Finish & Review** (primary) as peer row actions.
7. **[`PriorContextPanel.tsx` + goal badges] [S] [low]** — Swap `STATUS_BADGE` Tailwind map for **`StatusBadge`** variants (`success` / `info` / `neutral`) from `src/components/ui/status-badge.tsx`.
8. **[`PipelineStatusBanner.tsx` + `CaptureErrorBanners.tsx`] [S] [low]** — Consider **`StatusBanner`** from Phase 0 for consolidation (tokens already used inline).

## Cross-reference to cursor-tasks/01-quick-wins.md

- **Task #1 (capture button polarity):** **COVERED** in current `RecordingControls` — filled "Start drafting", ghost pre-draft "Finish", default post-draft "Finish & Review →" [`RecordingControls.tsx:63-108`]; no red destructive Finish.
- **Task #2 (audio level meter):** **COVERED** via `AudioLevelBars` in `CaptureTrustHeader` [`CaptureTrustHeader.tsx:126`, `audio-level-bars.tsx:9-38`].
- **Task #3 (patient identity contrast):** **COVERED** in trust header [`CaptureTrustHeader.tsx:79`] and mobile setup `CaptureHeader` [`CaptureHeader.tsx:49-54`]; prepare also uses stronger meta.
- **Task #4 (`StatusBadge`):** **PARTIAL** — capture path still has some hardcoded accent colors in `LiveNotePanel` and `TranscriptPanel`; PriorContext goal-pill debt called out earlier is no longer present in current `PriorContextPanel`.
- **Task #5 (touch targets):** **PARTIAL** — capture primary controls `h-12` good [`RecordingControls.tsx:47, 68`]; `NoteStyleSelector` / `NoteTypeSelector` use **`h-7`** triggers [`NoteStyleSelector.tsx:125`, `NoteTypeSelector.tsx:104`] if reused on tablet capture surfaces.
- **Task #6 (emoji home CTA):** **N/A** (capture/prepare scope).
- **Task #7 ("Start free trial"):** **N/A**.

**Phase 2+ candidates (not in Tasks #1–#7):** ~~desktop **three-column** drafting layout~~ *(prior peek rail shipped; exact ratio polish remains)*; ~~**section progress strip + per-section regen**~~ **shipped Phase 04**; ~~mobile **More** tab + **reordered tabs**~~ **shipped**; ~~**"Drafting started" toast**~~ **shipped**; ~~**visit type** in `CaptureTrustHeader`~~ **shipped**; ~~**timer format** (`MM:SS` vs `HH:MM:SS`)~~ **shipped**; ~~**explicit "Save draft"** placement parity~~ **shipped**; ~~**`Recording · drafting` trust copy**~~ **shipped**; ~~mobile sticky progress-in-panel placement~~ **shipped**; remaining: mockup **Full-history** style single link vs deep accordion UI, right-rail transition polish, and **token/CSS var alignment** with mockup HTML.
