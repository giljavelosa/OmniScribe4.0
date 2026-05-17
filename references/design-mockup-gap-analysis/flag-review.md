# Flag review — Mockup Gap Analysis

## At a glance
- **Mockup file(s):** `design-mockups-2026-05/flag_review_redesign.html` (233 lines)
- **Production file(s):** `src/components/review/flag-review-panel.tsx` (897 lines); host surface `src/app/(clinical)/review/[noteId]/page.tsx` (Transcript Verification / flag region ~1784–1861); types `src/lib/review-flags.ts` (47 lines); analyze API `src/app/api/notes/[id]/analyze-flags/route.ts` (GREEN definitions); related `src/components/review/goal-review-panel.tsx` (1110 lines)
- **Coverage estimate:** built ~82% / partial ~12% / missing ~6%
- **Top blocking issue:** Remaining gaps are now mostly strict spacing/typography rhythm fidelity; status-token primitive usage and host chrome copy parity are improved.

## Mockup summary
**State 1 (Summary):** Panel title **"Flag review"**, sub **"N statements need attention before signing"**, help **"What do these mean?"**; **three tier cards** (RED with pulse + emphasized copy "Contradicts transcript", BLUE "Added specifics", YELLOW "Inferred") with counts; **`By section`** list with colored count pills per section; primary **"Start review →"**, secondary **"Signing checks"**.

**State 2 (Active RED):** Progress **"1 of 7"** + section chip + **Exit review**; RED **flag card** with tier header, quoted statement, reason paragraph; **Transcript evidence** block with quote, speaker/time meta, **"Jump to source →"**; **Before/After diff** with labels **"Before · contradicted"** / **"After · matches transcript"**; primary **"Replace with what was actually said"**; grid of secondaries: Edit myself, AI rewrite custom, Remove, Keep as is; footer **"Was this flag wrong? … Report incorrect flag →"**.

## Production summary
**Host page:** "Transcript Verification" section: explains analysis, **"Analyze for Hallucinations"**, loading state, optional summary line `N red / blue / yellow unresolved` (`review/[noteId]/page.tsx:1784-1837`), then `FlagReviewPanel` (`1839–1848`) and **Re-analyze**.

**`FlagReviewPanel`:** now includes explicit summary chrome (`Flag review`, attention count, `What do these mean?`), tier cards, section rollup, **Start review** + **Signing checks** actions, plus existing tier chips/popovers and unresolved list. Active review includes transcript evidence + **Jump to source**, before/after preview, red/blue/yellow action flows, and inline `Report incorrect flag` feedback.

**Taxonomy backend:** `StoredReviewFlag.confidence` includes **GREEN** (`review-flags.ts:3-10`); analyze route marks GREEN as auto-resolved `verified` (`analyze-flags/route.ts:172-173` per grep context).

## Element-by-element diff

### Header
| Mockup | Production | Gap |
|--------|------------|-----|
| Title + sub + global help link | No title inside panel; parent says "Transcript Verification" | Framing split across parent + panel (`review/[noteId]/page.tsx:1786` vs `flag-review-panel.tsx:361-428`) |
| "What do these mean?" | Per-tier `TierChip` popover triggers | **Different pattern** — acceptable functionally, not visual parity (`flag-review-panel.tsx:66-90`) |

### Body — Summary
| Mockup | Production | Gap |
|--------|------------|-----|
| Large left-border tier **cards** + RED pulse | Tier cards + chips + unresolved list | **Partial parity** — tier-card IA now present; pulse animation / exact card rhythm still differs |
| Counts only at tier level | Chips show counts + full flag list always visible | Information density higher in prod; mockup is more **dashboard-like** |
| **By section** rollup | Summary now includes `By section` block with red/blue/yellow count pills | **Shipped** (styling still differs from mockup proportions) |
| "Signing checks" secondary CTA | `Signing checks` button in panel summary, wired to review shell anchors | **Shipped** |

### Body — Active review
| Mockup | Production | Gap |
|--------|------------|-----|
| Progress row + section pill | `Reviewing X of Y` + **Exit review** (`510–520`) | **Section chip in progress** not shown in prod header row |
| RED tier header + quoted statement | Same structure with icons (`530–543`) | **Close** |
| Evidence + **Jump to source** | Transcript evidence + `Jump to transcript` action | **Shipped** |
| Diff labels "Before · contradicted" / "After · matches transcript" | "Before:" / "After:" with status-token colors (`597–604`) | **Copy/intent** close, not literal |
| Primary **"Replace with what was actually said"** | **"⚡ AI Fix This"** (RED) (`642`) | **Tone differs** — mockup implies apply transcript-aligned replacement explicitly |
| Four-up secondary grid | Similar actions but **not same layout/labels**; BLUE/YELLOW have tier-specific CTAs (`685–770`) | Partial |
| **"Report incorrect flag"** feedback row | Present in active review (`Report incorrect flag` / `Thanks — feedback logged`) | **Shipped** |

### Footer / interactions
- **Start review →** vs **Start Review** + chevron (`flag-review-panel.tsx:423-424`) — trivial.
- **Exit review:** both have it (`514–520`).
- **Re-analyze:** production-only parent control (`review/[noteId]/page.tsx:1850-1859`) — good for clinicians, not in mockup.
- **Batch BLUE/YELLOW:** production-only flows (`431–497`) — **extra** vs mockup; improves throughput.

### Related: `goal-review-panel.tsx`
**Not in flag mockup** but same review session: episode goals, AI rec verification, bulk accept (`goal-review-panel.tsx:835-872, 698-702`). **Complements** flag workflow for rehab discharge/progress — separate IA from "Flag review".

## Copy diff (selected)
| Concept | Mockup | Production |
|---------|--------|------------|
| Panel name | "Flag review" | Parent now carries "Transcript Verification" + explicit "Flag review" sublabel for closer copy parity |
| Tier names | "Contradicts transcript" / "Added specifics" / "Inferred" | RED label "Contradicts transcript"; BLUE "Added specifics — confirm details"; YELLOW "Inferred — not directly stated" (`127–131`) |
| RED primary CTA | "Replace with what was actually said" | "⚡ AI Fix This" (`642`) |
| Help | "What do these mean?" | ARIA "What does red mean?" on chips (`70`) |
| False positive | "Report incorrect flag →" | (none) |

## Token / styling diff
- **Mockup:** `--color-background-danger/info/warning`, left-accent tier cards, RED pulse animation (`flag_review_redesign.html:14-22`).
- **Production:** Hardcoded hex tier palette `#E24B4A`, `#378ADD`, `#EF9F27`, `#FCEBEB`, etc. (`flag-review-panel:47-51, 109-113, 370-385`) — **Phase 0 `StatusBadge` / semantic tokens not used** for tier chips (contrast with `status-badge.tsx` which is `var(--status-*)`-based).
- **Completion state:** prod uses `var(--status-success-*)` (`346–347`) — **better token alignment** than tier chips.
- **Preview diff:** prod uses `--status-danger` / `--status-success` (`597–603`) — **aligned** with token direction.

## Refactor recommendations
1. ~~[`flag-review-panel.tsx` summary layout]~~ **DONE** [M] [med] — Tier cards + **by-section** aggregation shipped, including RED pulse affordance when unresolved RED flags exist.
2. [`flag-review-panel.tsx` + `review/[noteId]/page.tsx`] [M] [med] — **Jump to source**: pass transcript char offset or search token + callback to open `SpeakerRelabelSheet` / transcript sheet (`review` page already has transcript UI ~1884+).
3. ~~[`flag-review-panel.tsx`] [S] [low]~~ **DONE (shared badges)** — section rollup chips, resolved count, and active section chip now use shared `StatusBadge` variants (danger/info/warning/success/neutral) for token-consistent rendering.
4. [`review/[noteId]/page.tsx` chrome] [XS] [low] — Rename or duplicate heading to **"Flag review"** under "Transcript Verification" for strict copy parity.

## Cross-reference to `cursor-tasks/01-quick-wins.md`
- **Tasks #1–#6:** Not primary for flag UI (capture/home/drafts); **Task #4** (`01-quick-wins.md:83-98`) motivates replacing **hardcoded** `bg-*` / chip colors — **flag panel hex badges** are additional grep targets for Phase 1 token migration.
- **Phase 2+:** Inline transcript highlighting from flags, **signing checks** surfacing (if a separate compliance panel exists, wire mockup secondary CTA to it), **feedback loop** for model improvement.

### Flag taxonomy vs `.cursorrules` (RED / BLUE / YELLOW / GREEN)
- **Implemented in data + API:** Four levels including **GREEN** auto-resolved (`review-flags.ts:3`; `analyze-flags/route.ts` per grep).
- **UI panel:** Only **RED/BLUE/YELLOW** are actionable; resolved GREENs collapse into **resolved** count, matching comment "GREEN may be auto-resolved and hidden from review queue" (`review-flags.ts:1`).
- **Mockup:** Shows **three** tiers in summary **plus** resolved styling in section pills (`flag_review_redesign.html:14-52`); **no explicit GREEN tier card** — closest is **resolved** success styling. **Alignment:** mockup ≈ prod on "don't queue GREEN"; mockup adds **resolved** pill styling per section **without** naming GREEN.

### 42 CFR Part 2 / SUD / behavioral health sensitivity
- **Grep** over `src/**/review/**/*.tsx` for `42 CFR`, `Part 2`, `SUD_PART`, `sensitivity`, `BEHAVIORAL` returned **no matches**.
- **`flag-review-panel.tsx`** has **no** patient sensitivity tier, restricted-data banner, or SUD-specific flag handling.
- **Conclusion:** **Mockup vs prod parity** on "special sensitivity surfacing" is **N/A** — **neither** the mockup HTML nor the production flag panel implements a Part 2–specific flag lane; any such enforcement would require **separate** product/design work (and would likely live at **note/patient shell**, not only inside `FlagReviewPanel`).
