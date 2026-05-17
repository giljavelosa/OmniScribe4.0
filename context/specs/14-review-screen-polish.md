# Unit 14: Review Screen Polish

## Goal

Wave 2's closing unit — close the trust gaps on `/review/[noteId]` with an AI compliance-flag system (RED/BLUE/YELLOW/GREEN), per-section copy-to-clipboard for EHR-paste workflows, and accordion animation polish. Builds on Unit 05 (review surface) + Unit 10 (regen polish).

## Design

### Flag severity taxonomy (canonical)

- **RED — contradicts transcript.** The AI claim disagrees with what was actually said. Must resolve before sign.
- **BLUE — added specifics.** AI added detail beyond the transcript. Confirm or remove.
- **YELLOW — inferred.** AI made an inference (e.g., "patient appears anxious" without explicit cue). Confirm or rephrase.
- **GREEN — verified.** Auto-resolved; the AI claim is supported by the transcript. Surfaces as resolved-count only.

### Flag lifecycle

```
  AI emits flag → status='OPEN' → clinician resolves (ACCEPT_EDIT|DISMISS_KEEP|REGENERATE_SECTION) → status='RESOLVED'
                                  ↓
                          status='DISMISSED' (DISMISS_KEEP without edit)
```

### Surfaces

- `/review/[noteId]` adds a `FlagReviewPanel` between SectionProgressStrip and the section list — collapsible when no flags, expanded when ≥1 OPEN.
- "Analyze for flags" button triggers the analyzer; SSE updates the panel as flags land.
- Per-section: copy-to-clipboard button on each section header for EHR-paste workflows.

## Implementation

### A. Schema

```prisma
model ReviewFlag {
  id              String    @id @default(cuid())
  noteId          String
  note            Note      @relation(fields: [noteId], references: [id], onDelete: Cascade)
  orgId           String
  sectionId       String                       // template section id
  severity        ReviewFlagSeverity           // RED | BLUE | YELLOW | GREEN
  status          ReviewFlagStatus @default(OPEN)
  /** AI-extracted claim from the draft section. */
  claim           String   @db.Text
  /** Why the AI flagged it — short rationale. */
  rationale       String   @db.Text
  /** Transcript evidence snippet supporting the claim (or contradicting it). */
  evidence        String?  @db.Text
  /** Suggested replacement text (RED especially). */
  suggestion      String?  @db.Text
  /** AI confidence 0..1 — surfaces in UI as small percent. */
  confidence      Float    @default(0.5)
  /** Set when status flips to RESOLVED/DISMISSED. */
  resolvedAt      DateTime?
  resolvedByOrgUserId String?
  resolutionAction String? // 'ACCEPT_EDIT' | 'DISMISS_KEEP' | 'REGENERATE_SECTION' | 'AUTO_VERIFIED'
  resolutionNote  String?
  createdAt       DateTime @default(now())

  @@index([noteId, status])
  @@index([noteId, sectionId])
  @@index([orgId, createdAt])
}

enum ReviewFlagSeverity {
  RED       // contradicts transcript
  BLUE      // added specifics
  YELLOW    // inferred
  GREEN     // auto-verified
}

enum ReviewFlagStatus {
  OPEN
  RESOLVED
  DISMISSED
}
```

### B. Flag analyzer

`src/lib/notes/build-flag-analyzer-prompt.ts` — builds the Bedrock prompt: system prompt enforces strict-JSON output, three absolute rules (only flag what's directly verifiable against transcript; severity per taxonomy; no flag without rationale + evidence pointer). User message embeds the transcript + the draft section content per section.

`src/services/review/FlagAnalyzer.ts` — wraps the LLM call (Sonnet, jsonMode); returns `{ flags: [...] }` Zod-validated.

`src/workers/flag-analyzer/handler.ts` — BullMQ job consumed by ai-generation queue with discriminator `analyze-flags`. Job payload: `{ noteId, orgId, requestId }`. Loads note + draftJson + transcriptClean, runs analyzer per section, writes ReviewFlag rows, emits SSE events for the FlagReviewPanel.

### C. APIs

- `POST /api/notes/[id]/analyze-flags` — enqueue analyzer job; 409 if already in flight.
- `GET /api/notes/[id]/flags` — list flags grouped by severity.
- `PATCH /api/notes/[id]/flags/[flagId]` — resolve / dismiss; resolutionAction + resolutionNote.

### D. UI

- `<FlagReviewPanel>` — at top of /review section list. Three severity cards (RED/BLUE/YELLOW) with counts; GREEN surfaces as `N resolved` only. Click card → expand list with claim + rationale + evidence + suggestion + action buttons.
- `<CopySectionButton>` — header-level copy-to-clipboard per SectionAccordion.
- SectionAccordion expand/collapse gets a CSS-only `data-state` transition for the chevron and content height.

### E. Audit actions

- `FLAGS_ANALYZER_ENQUEUED`
- `FLAGS_ANALYZED`
- `FLAG_RESOLVED`
- `FLAG_DISMISSED`
- `SECTION_COPIED_TO_CLIPBOARD`

## Out of scope (v1)

- TipTap rich editor — deferred. The textarea editor from Unit 05 stays; TipTap brings ProseMirror JSON storage cost that's not justified until per-section formatting matters (Wave 3+).
- Co-sign workflow for sensitive overrides — deferred.
- Sensitivity-tier picker on review — current sensitivity flows through Unit 02 schema.

## Verify when done

- ReviewFlag schema migration applied.
- Analyzer worker processes a note + writes flags per section.
- /review shows FlagReviewPanel with severity-grouped counts.
- Resolve / dismiss flow updates status + audits.
- Per-section copy-to-clipboard copies the section content with a header line.
- Accordion expand/collapse animates smoothly.
- 5 new audit actions wired.
- progress-tracker.md updated; Wave 2 marked complete.
