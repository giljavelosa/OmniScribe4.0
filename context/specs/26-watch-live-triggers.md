# Unit 26: Watch v2 — Live-Transcript Triggers

## Goal

Wave 5 / Phase 52 follow-up. Unit 25 ships the 4 FHIR-backed Watch cards as static surfaces in the right aside. Unit 26 makes them REACTIVE — when a transcript segment mentions a known condition, medication, or lab from the patient's cache, the corresponding card "raises" (visual highlight + position bump on mobile + a "Mentioned just now" subhead) so the clinician's eye is drawn to relevant context exactly when they need it.

> **Unit 26 ships when** a clinician on /capture who says "let's talk about your metformin" sees the CurrentMedicationsCard raise into view with the metformin row highlighted, and the audit log captures one `COPILOT_CARD_RAISED` row per card per session.

## Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | Trigger scope | /capture only. /prepare's transcript doesn't stream (the brief is pre-built). Mounting a live-coordinator there would subscribe to nothing. |
| 2 | Matching | Pure substring/token match — no LLM, no embedding. Each row's display text is tokenized; tokens length ≥ 4, lowercased; transcript text is lowercased and substring-matched. False-positive rate is acceptable because the raise is non-destructive (it doesn't dismiss other cards; it doesn't insert content). |
| 3 | Raise state | Per fhirResourceId. Once raised, stays raised for the rest of the session (no "un-raise" — the clinician may glance back; toggling raised off is jittery). |
| 4 | Audit cadence | One `COPILOT_CARD_RAISED` per (cardType) per session. Per-row audit would flood the log; per-card-type is enough for the auditor lens ("did the copilot raise the meds card during this visit?"). |
| 5 | Visual | Subtle: `data-raised="true"` attribute + accent border + "Mentioned just now" subhead in the card header. No animation that pulls focus from the transcript pane (the clinician is still recording). |
| 6 | Stub-mode aware | Local matching — works without any service. Stub-mode transcript flowing through the worklet feeds the matcher just like real-mode. |

## Design

### Topic matcher

`src/lib/copilot/topic-match.ts`:

```typescript
type Row = { fhirResourceId: string; tokens: string[] };
type CardIndex = {
  activeConditions: Row[];
  currentMedications: Row[];
  recentObservations: Row[];
  allergies: Row[];
};

function buildIndex(context: ExternalEhrContext | null): CardIndex;
function matchTranscript(transcriptText: string, index: CardIndex): {
  activeConditions: Set<string>;
  currentMedications: Set<string>;
  recentObservations: Set<string>;
  allergies: Set<string>;
};
```

- `buildIndex` is called once per context — tokenizes each row's display text, drops short/numeric/stopword tokens.
- `matchTranscript(text, index)` runs on every transcript update — returns the set of matched fhirResourceIds per category. Cheap (linear scan; ~50 rows max).
- Stopword list: a small hardcoded set covering English common words. Out of scope: stemming, medical-term expansion (future polish).

### Coordinator

`src/components/copilot/cards/fhir-watch-cards-live.tsx` — client wrapper around `FhirWatchCards`. Uses `useTranscript()` to subscribe. On every transcript change:

1. Compute matches via `matchTranscript`
2. Merge into accumulated `raisedFhirIds` state (Sets, by category)
3. On first match per category, fire `COPILOT_CARD_RAISED` audit (one-time guard via Set)

Passes `raisedFhirIds: { activeConditions: Set<string>, ... }` down to the inner cards.

### Card visual

Each card accepts an optional `raisedFhirIds: Set<string>`:
- Card header adds a "Mentioned just now" subhead chip when ≥1 row in the card is raised.
- Each row checks if its fhirResourceId is in the set and applies a left-border accent when matched.
- The `<Card>` wrapper gets `data-raised="true"` when any row is raised; CSS hook for future polish.

### Audit allowlist extension

`COPILOT_CARD_RAISED` added to the AuditAction union AND to the `/api/audit/copilot-event` allowlist. Same metadata shape as `COPILOT_CARD_RENDERED` — `{ surface, noteId, cardType, itemCount }` where `itemCount` is the number of rows currently raised in that card at the moment of the first raise.

## Implementation order

1. Spec + audit action (this commit)
2. Topic matcher pure helper + tests
3. FhirWatchCardsLive coordinator + raised visual on cards
4. Wire into capture (replace FhirWatchCards on capture only; /prepare stays on the static bundle)
5. Tracker + PR #27

## Out of scope (Unit 26)

- Medical term expansion + stemming (future polish; v1 substring match is enough for common patterns like "metformin", "diabetes").
- LLM-based topic inference (Wave 6+ ask-mode work).
- Raise-on-prompt for the brief's note-sourced fields (only FHIR cards in v1; brief fields are denser + raising every line on every mention would be noisy).
- Scroll-into-view on raise (visual highlight only — auto-scrolling pulls focus from the transcript pane mid-utterance).
- "Un-raise" after N seconds of no mention (sticky raise per session per spec decision 3).

## Verify when done

- Static substring matcher returns the right fhirResourceIds for a transcript like "patient says metformin is working".
- FhirWatchCardsLive renders identical to FhirWatchCards when no transcript matches (no raised state).
- On capture, saying a known med name highlights the medications card.
- `COPILOT_CARD_RAISED` fires once per cardType per session (not per row, not per transcript update).
- /prepare unchanged — FhirWatchCards (static) is still what mounts there.
- progress-tracker.md updated; PR #27 stacked on Unit 25.
