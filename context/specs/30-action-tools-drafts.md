# Unit 30: Action Tools — Drafts

## Goal

Wave 5 / Phase 55. The Chart-mode agent gains 3 NEW tools that PRODUCE drafts the clinician can review, edit, accept, or discard — `draftPatientMessage`, `proposeFollowUpCadence`, `suggestReferralLetterContent`. **No autonomous side effects.** The model SUGGESTS; the clinician DECIDES. Both the draft AND the decision are audited separately so the auditor sees the full agent-vs-clinician judgment chain.

> **Unit 30 ships when** a clinician asks "draft a patient message about her A1c result", the agent calls `draftPatientMessage`, the chat surface renders a draft card with the proposed text + Accept/Edit/Discard buttons, accepting copies to clipboard + creates `COPILOT_DRAFT_CONFIRMED` audit; discarding closes the card + creates `COPILOT_DRAFT_DISCARDED` audit.

## Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | Three draft tools | `draftPatientMessage({ patientId, topic })`, `proposeFollowUpCadence({ patientId, basis })`, `suggestReferralLetterContent({ patientId, specialty, reason })`. Chart-mode only — research mode has no patient context. |
| 2 | No autonomous effects | Every tool returns a DRAFT (text + structured metadata). No email sent, no FollowUp row created, no letter mailed until the clinician hits "Confirm". |
| 3 | Each tool is a sub-LLM call | The draft tool loads patient context (demographics, episode goals, recent signed note's plan section), calls Haiku with a per-type system prompt, returns structured `{ draftKind, draftContent }`. Bounded by maxTokens. |
| 4 | Audit on draft AND confirm | `COPILOT_DRAFT_PROPOSED` on tool call (metadata: kind + content length); `COPILOT_DRAFT_CONFIRMED` on accept (kind + actionTaken); `COPILOT_DRAFT_DISCARDED` on reject. The auditor sees BOTH the agent's suggestion and the clinician's decision. |
| 5 | Confirm side-effects | - `draftPatientMessage` → confirm = copy-to-clipboard (no real send; future polish). - `proposeFollowUpCadence` → confirm = create FollowUp row(s) via existing POST `/api/follow-ups` shape (NEW endpoint or extend existing — Wave 6 polish picks the right shape). - `suggestReferralLetterContent` → confirm = copy-to-clipboard (no real send). |
| 6 | Edit before confirm | The DraftCard has an inline textarea pre-filled with the proposed text. Editing modifies the to-be-confirmed content; confirm uses the edited version. Audit `COPILOT_DRAFT_CONFIRMED` includes `wasEdited: boolean`. |
| 7 | Drafts in chat surface | Drafts ride alongside the assistant message (not as a separate message). The assistant says "I've drafted X" + the card renders below. Card has its own state (pending / confirmed / discarded). |

## Design

### Draft type union

```typescript
export type DraftKind = 'patient-message' | 'followup-cadence' | 'referral-letter';

export type Draft = {
  draftId: string;          // client-generated UUID, stable across edits
  kind: DraftKind;
  content: string;          // editable text — what the clinician confirms
  meta: Record<string, unknown>; // kind-specific structured fields
};
```

Per-kind `meta` shapes:
- `'patient-message'`: `{ topic, tone }`
- `'followup-cadence'`: `{ basis, suggestedIntervals: Array<{ label, days }> }`
- `'referral-letter'`: `{ specialty, reason, recommendedReceiver }`

### Sub-LLM call per tool

`src/services/copilot/draft-tools.ts`:

Each tool:
1. Loads structured patient context via existing tool helpers (demographics + most recent signed note's plan section + active goals if episode)
2. Calls Haiku with a per-type system prompt + the patient context as JSON
3. Parses the draft text from the response
4. Returns `{ draftKind, draftContent, meta, contextSummary }`

Stub-mode: each tool returns a canned draft seeded off the patientId (deterministic for dev).

### Agent integration

Add 3 tool names to `runTool` dispatch. Each runs the corresponding draft-tool sub-LLM call. The tool result's `data` shape carries the draft:

```typescript
{ draft: { draftId, kind, content, meta }, contextSummary: string }
```

The agent's `AgentOutput` gains an optional `drafts: Draft[]` field — the route layer aggregates drafts from each successful tool call so the chat surface can render them. Sources for the assistant message use the existing chart-tool kinds for the context the draft tool read (patient + note + goal as applicable).

### API

- `POST /api/copilot/draft-confirm` — body: `{ draftId, kind, content, wasEdited, sideEffect }`. Where `sideEffect` is `'clipboard' | 'followup-create'`. Writes `COPILOT_DRAFT_CONFIRMED` audit. For `'followup-create'`, also creates one or more FollowUp rows via the existing Unit 06 follow-up creation path.
- `POST /api/copilot/draft-discard` — body: `{ draftId, kind }`. Writes `COPILOT_DRAFT_DISCARDED` audit.

Both NOTE_REVIEW-gated. Both PHI-fenced (metadata is kind + content length + actionTaken, not the content itself).

### UI

`src/components/copilot/draft-card.tsx` — client component embedded in AskSurface message render. Shape:

```
┌─ Draft: <kind> ───────────────────────────────────┐
│ [editable textarea pre-filled with draft.content] │
│                                                    │
│ Topic: <meta.topic> · Tone: <meta.tone>           │
│                                                    │
│ [Discard] [Edit] [Accept]                         │
└────────────────────────────────────────────────────┘
```

State per card: `'pending' | 'edited' | 'confirmed' | 'discarded'`. Confirm + discard both call the corresponding endpoint then transition to a terminal state (the card grays out but stays visible in the chat history).

`AskSurface` extension: the `ChatMessage` shape gains optional `drafts: Draft[]`. When present, each draft renders as a `DraftCard` below the assistant text.

## Implementation order

1. Spec + 3 audit actions + Draft type union + system prompts (this commit)
2. 3 draft tools + sub-LLM helper + tests
3. `/api/copilot/draft-confirm` + `/api/copilot/draft-discard` + ask-route extension to include drafts in response
4. `DraftCard` UI + AskSurface integration
5. Tracker + PR #31

## Out of scope (Unit 30)

- Real patient message sending (clipboard-only in v1; integration with a secure messaging service is a future unit)
- Real referral letter sending / fax / mail (clipboard-only)
- Multi-clinician routing (referral goes to whoever the clinician picks)
- Native Bedrock Converse tool-use API (still prompt-engineered JSON loop; native swap is a future infra refactor per Unit 27 spec)
- Templated drafts pulled from `NoteTemplate` (drafts are LLM-generated freeform in v1)

## Verify when done

- 3 new tools dispatched via `runTool` in chart mode.
- Each draft tool's stub-mode returns a deterministic draft seeded off patientId.
- `/api/copilot/draft-confirm` writes `COPILOT_DRAFT_CONFIRMED` with `wasEdited: boolean`.
- `/api/copilot/draft-confirm` with `sideEffect: 'followup-create'` creates one or more FollowUp rows.
- `/api/copilot/draft-discard` writes `COPILOT_DRAFT_DISCARDED`.
- AskSurface renders DraftCard with Discard / Edit / Accept actions.
- Edit flow updates the to-be-confirmed text; the confirm audit reflects `wasEdited: true`.
- progress-tracker.md updated; PR #31 stacked on Unit 29.
