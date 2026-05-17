# Review screen — Mockup Gap Analysis

## At a glance
- **Mockup file(s):** `design-mockups-2026-05/review_screen_desktop_mockup.html` (224 lines); `design-mockups-2026-05/review_screen_mobile_mockup.html` (176 lines)
- **Production file(s):** `src/app/(clinical)/review/[noteId]/page.tsx` (2477 lines); `src/app/(clinical)/review/[noteId]/_components/NoteFindBar.tsx` (213 lines); `src/components/review/progress-note-nudge.tsx` (58 lines); `src/components/review/goal-review-panel.tsx` (1111 lines); `src/components/review/flag-review-panel.tsx` (898 lines)
- **Coverage estimate:** built ~90% / partial ~7% / missing ~3%
- **Top blocking issue:** Remaining gaps are now primarily strict spacing/typography rhythm polish; summary metadata depth is improved (modality + DOS + duration), and token alignment for mobile tabs/queue chrome + flag-tier badges is improved.

## Mockup summary
- **Desktop:** `.frame`; tokens `var(--color-*)`, `--border-radius-*`; **header** `.appbar` (back, patient, encounter meta with date · duration · modality · DOB · MRN), `.saved-tag`, `.btn-sign-top` `#0F6E56`; **alert** `.alert` `#FAEEDA`, `.alert-jump` "View source" + `.callout` markers; **body** `.split` 50/50: `.note-panel` (panel header "Note" + format), `.progress-strip` `.pi-tap` done/todo/active, `.note-sec` with `.status-tick` "Reviewed" / `.status-unrev` "Not reviewed", `.regen`, `.editing-shell` border `#1D9E75`, `.dose-flag` `#FAC775`, `.edit-toolbar` "AI-drafted · edited"; `.transcript-panel` header + `.search-box`, `.spk-key`, `.utt.source` highlighted, skipped turns line; **footer** `.bottom-bar` "Save draft" + "Sign & finalize". Legend: AI jump, dual panel, sticky speaker labels, bidirectional highlight, dual sign.
- **Mobile:** `.phone` 360px; `.progress-strip` as nav; `.alert` + "View source →"; **tabs** `.tabs` Note / Transcript / More; same section/edit pattern; **footer** `.bottom-zone`. Legend: strip navigation, flags switch transcript tab, per-section reviewed, inline edit, sign + biometric/PIN.

## Production summary
Review now ships a large-screen split note + transcript surface (`lg`) with tuned near-equal ratio, transcript sheet fallback on smaller screens, per-section reviewed chips, flag-blocking sign gate, one-tap source jumps, explicit `Saved` state tag, `Sign & finalize` parity copy in both header and mobile sticky actions, mobile `Note / Transcript / More` tabs, a persistent discrepancy banner with `View source`, and stronger transcript-turn → note-section synchronization.

```1248:1358:src/app/(clinical)/review/[noteId]/page.tsx
    <div className="flex min-h-screen flex-col bg-background">
      <NoteFindBar containerRef={noteBodyRef} />
      <header className="shrink-0 border-b border-border/60 bg-card">
        ...
              <Button
              variant="outline"
              size="sm"
              onClick={() => setTranscriptSheetOpen(true)}
              disabled={transcriptTurns.length === 0}
            >
              <MessageSquareText className="mr-1.5 h-3.5 w-3.5" />
              Transcript
            </Button>
        ...
              <Button ... onClick={async () => { await save(sections); router.push(`/sign/${noteId}`); }} disabled={!canSign}>
                Sign Note
              </Button>
            ) : (
              <Button ... onClick={markReviewed}>
                <Eye className="mr-1.5 h-3.5 w-3.5" />
                Mark Reviewed
              </Button>
            )}
```

```1438:1618:src/app/(clinical)/review/[noteId]/page.tsx
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-w-0">
                <div className="rounded-[28px] border border-border/60 bg-card shadow-sm">
                  ...
                  <div ref={noteBodyRef} className="px-6 py-6">
                    {sections.map((section, index) => {
```

```1784:1804:src/app/(clinical)/review/[noteId]/page.tsx
                <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
                  <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/65">
                    Transcript Verification
                  </p>
                  {!flagSummary && !analyzingFlags && (
                    ...
                        Analyze for Hallucinations
```

```1952:1961:src/app/(clinical)/review/[noteId]/page.tsx
                {note?.division === "REHAB" && note.episodeId && (
                  <ProgressNoteNudge
                    visitCount={rehabProgressContext?.visitCount ?? 0}
                    lastProgressNoteVisit={rehabProgressContext?.lastProgressNoteVisit ?? null}
                    noteType={note.noteType}
```

```157:174:src/app/(clinical)/review/[noteId]/_components/NoteFindBar.tsx
    <div className="fixed right-6 top-20 z-50 ...">
      ...
        placeholder="Find in note"
```

## Element-by-element diff

### Header
- Mockup desktop [L75–87] encounter line includes **duration**, "Saved 2 min ago", top **Sign & finalize**; prod [`1254–1357`,`1207–1275`] back, name, DOB/MRN via `buildPatientIdentityMeta`, **setup** summary from `buildReviewSummaryState` now includes modality, date-of-service, and encounter duration context. Saving now shows "Saving…" plus an explicit `Saved` status tag after successful writes.
- Mockup mobile [L61–70] **Saved** text; prod now includes saved-state affordance and adds explicit mobile tab chrome (`Note / Transcript / More`) ahead of content.

### Body — layout & navigation
- Mockup [L97–210] **equal split** + full transcript; prod now renders persistent large-screen split note/transcript (`lg`) with tuned near-equal ratio and sheet fallback on smaller screens.
- Mockup [L105–111] **progress strip** jumps sections; prod still differs in placement/structure but now supports section-level transcript focus, section acknowledgment chips, and active-flag section chips during review workflow.
- Mockup mobile [L89–93] **tabs**; prod now ships explicit `Note / Transcript / More` mobile tabs with semantic status-info selected-state tokens while preserving the existing sticky bottom action bar for save/sign safety.

### Body — alerts & flags
- Mockup [L89–95] inline **discrepancy** banner + View source; prod now includes persistent discrepancy framing with one-tap source jump, in addition to sign-blocking warning and flag panel controls.

### Body — sections
- Mockup per-section **Reviewed / Not reviewed** [e.g. L116–117, L136–137]; prod now ships per-section reviewed chips and sign gating on unresolved section acknowledgments.

### Body — transcript ↔ note
- Mockup legend bidirectional pulses; prod now supports transcript-turn click → note-section jump/scroll + pulse and note-section match/jump back into transcript, though full continuous dual-pane scroll-sync is still out of scope.

### Body — speakers
- Mockup [L182–185] key in transcript header; prod **Speakers** button + `SpeakerRelabelSheet` [`1309–1324`,`1869–1882`] — feature present, layout differs.

### Footer
- Mockup [L212–215] **Save draft** + second **Sign**; prod: mobile sticky bottom zone includes `Save draft`, `Transcript`, and `Sign & finalize`/`Review`, while desktop still relies on header actions + autosave.

### Interactions
- Mockup dual Sign; prod now supports header + mobile sticky sign affordance, and `canSign` requires reviewed + goals resolved + actionable flags resolved + all section chips acknowledged.

## Copy diff
| Mockup | Production |
|--------|------------|
| Sign & finalize | `Sign & finalize` (header + mobile sticky) |
| Save draft | Mobile sticky **Save draft** + implicit autosave |
| View source | Available in flag workflow and sign-warning banner |
| Transcript panel search ⌕ | Sheet search [`1904–1910`] |
| Per-section Reviewed | Per-section chips + Mark Reviewed shortcut |
| Mobile "More" tab | `More` tab shipped (mobile tablist + conditional panel) |

## Token / styling diff
- Mockup: `#0F6E56`, `#FAEEDA`, `#BA7517`, `#633806`, `#FAC775`, `#5DCAA5`, CSS vars.
- Prod: `--status-*` review banner [`1211–1218`]; flag tier hex in page [`1828–1834`] and `flag-review-panel` [`47–51`,`109–125`]; `NoteFindBar` `bg-yellow-200/80` [`62–63`]; transcript match `bg-yellow-200/80` [`page.tsx:2002`]. Section titles `text-[17px]` [`1505`] vs mockup 11px uppercase `.note-h-t`.

## Refactor recommendations
1. **[page.tsx] [M] [risk: low]** — Match mockup split ratio/tokens more closely (current functional split is shipped, ratio tuning pass landed; remaining drift is token-level polish). **DONE (ratio pass)**
2. **[page.tsx] [M] [risk: low]** — Mobile tab parity (`Note / Transcript / More`) if strict mockup IA remains a requirement. **DONE**
3. **[page.tsx + alert module] [S] [risk: low]** — Expand discrepancy alert framing beyond current sign-warning jump into fully persistent inline alert styling. **DONE**
4. ~~**[flag-review-panel.tsx] [M] [risk: low]**~~ **DONE (badge primitives)** — tier rollup and active-section chips now use shared `StatusBadge` primitives for tighter token consistency.

## Cross-reference to cursor-tasks/01-quick-wins.md
- **#1–#2:** N/A (capture).
- **#3:** PARTIAL — review identity `text-foreground/85` [`1265`]; flag panel uses low-contrast paths elsewhere.
- **#4:** PARTIAL — `FlagReviewPanel` hex/amber classes [`flag-review-panel.tsx:370-384`,`479-484`]; `text-red-600` errors [`page.tsx:1815`].
- **#5:** PARTIAL — many `size="sm"`; mockup mobile sign is larger thumb target.
- **#6–#7:** N/A.

**Phase 2+ candidates:** Phase 5 inline edit + AI alerts (`01-quick-wins.md` Out of scope); this report is the design spec delta for that phase.

### Three-lens (.cursorrules)
- **Clinician:** Transcript-linked section review is now materially stronger (chips, jumps, split/sheet parity, mobile action zone).
- **Medicare:** Goal panel + progress nudge now carry real visit context on review, reducing missed cadence prompts.
- **Insurance auditor:** Sign path now enforces unresolved actionable flags and offers one-tap source jump, improving traceability before irreversible sign.
