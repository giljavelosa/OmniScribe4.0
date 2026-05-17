# Journey 05 — Asking the Copilot

> The reactive mode of the agentic copilot. A clinician opens the beacon, asks a question in plain language, and gets a sourced answer — never an opinion, always a citation.

## Who

**Dr. Eve Quintero**, behavioral health psychiatrist, 8-clinician integrated-care clinic in Portland. Mid-visit with **Daniel Adams**, 42M, ongoing depression management. Daniel just said something Eve wants to verify against history.

## The journey at a glance

Daniel says, "I think the last time we tried bupropion it gave me headaches." Eve isn't sure — she's been Daniel's clinician for 18 months but doesn't remember a bupropion trial. She wants to verify without breaking eye contact for 5 minutes of EHR scrolling.

She taps the Copilot beacon. Asks: "Did Daniel have a bupropion trial in the last 2 years?"

12 seconds later: a sourced answer. Yes — March 2024, discontinued after 3 weeks for migraines. Source pill points to the Plan section of that note.

She closes the sheet. The conversation continues seamlessly.

## The journey, step by step

### Step 1 — The trigger, 3:14 PM

Eve is in the middle of a recorded session at `/capture/[noteId]`. The capture page is in mobile-tabbed mode (Eve is on her iPad in landscape, in the patient's room). Transcript is streaming in the left pane.

Daniel mentions bupropion. Eve thinks: I need to know if we already tried this.

She taps the **Copilot beacon** — the Sparkles icon, bottom-right corner of the screen (always visible during capture). 48×48 px touch target. The recording continues (not paused).

### Step 2 — The Ask sheet opens, 3:14:05 PM

**Screen overlay: `<CopilotSheet>`** slides in from the right (`sm:max-w-md` on tablet). Contents:

- **Header**: "Co-Pilot" + close button
- **Patient chip** at top: "Daniel Adams · 42M · MRN 00219475" — confirms scope
- **Mode toggle** (small, top-right of chat area): `Chart` (default) | `Research`
- **Empty chat**: greeting message — "Hi Eve. I can search Daniel's chart for signed notes, follow-ups, and verified records. What do you want to know?"
- **Input**: text field at bottom, "Ask about Daniel's chart…"

### Step 3 — The question, 3:14:15 PM

Eve types (or voice-dictates): "Did Daniel have a bupropion trial in the last 2 years?"

She taps send (or hits enter).

### Step 4 — The copilot's reasoning, 3:14:18 → 3:14:28 PM

The copilot's UI shows:

- **User message** bubble (right side): the question
- **Assistant** placeholder with a 3-dot pulsing indicator: "Searching Daniel's signed notes…"

**Behind the scenes**: The agent loop begins.

- **Tool call 1**: `searchSignedNotes(patientId, query="bupropion", timeWindowMonths=24)` → returns 3 candidate signed notes ranked by relevance.
- **Tool call 2**: For each candidate, the copilot fetches the relevant section excerpts. (PHI-safe; only the snippets needed.)
- The copilot composes an answer grounded in those excerpts.

The UI updates: "Reading 3 notes…" then "Composing answer…"

### Step 5 — The answer, 3:14:28 PM

```
Yes. Bupropion XL 150 mg was started on 2024-03-12 and discontinued
on 2024-04-02 after Daniel reported worsening migraine headaches.

After discontinuation, you switched to sertraline 50 mg.

[ from Office Visit · 2024-03-12 — Plan section ]
[ from Office Visit · 2024-04-02 — Plan section ]
```

Each source pill is tappable. The body text is calm, complete, sourced. No "I think" or "you might want to." Just the data.

### Step 6 — Eve verifies + closes, 3:14:35 PM

Eve taps the first source pill. A small drawer opens to the right of the Co-Pilot sheet, showing the Plan section of the 2024-03-12 note:

```
PLAN — 2024-03-12 — Office Visit
─────────────────────────────────
1. Start bupropion XL 150 mg PO once daily, morning.
2. Discuss side-effect profile (insomnia, headache, jitteriness).
3. Follow-up 3 weeks.
```

She nods. Closes the drawer. Closes the Co-Pilot sheet. Turns to Daniel.

"You're right, we did. Mar 2024. You had migraines on it. Let's not go back to that. Let me think about what else might fit."

The whole interaction took 25 seconds, no break in eye contact except for the read-and-verify glance.

---

## What just happened — behind the scenes summary

| Event | What | Audit |
|---|---|---|
| Beacon tap | Opens `<CopilotSheet>` with patient scope locked to current `noteId.patientId` | `COPILOT_BEACON_OPENED` (PHI-free: noteId, surface=capture) |
| Question typed | Client POST `/api/copilot/chat` with `{ patientId, noteId, mode: 'chart', message }` | `COPILOT_MESSAGE_SENT` |
| Tool: searchSignedNotes | Server executes against Prisma: signed notes only for `(patientId, orgId)`, query-relevance ranked | `COPILOT_TOOL_CALL` with `tool: 'searchSignedNotes'`, `argsHash` (no PHI) |
| Tool: fetchSectionExcerpts | Fetches specific sections from candidate notes; respects sensitivity-tier access | `COPILOT_TOOL_CALL` with `tool: 'fetchSectionExcerpts'`, `noteCount: 3` |
| LLM composes answer | Bedrock Sonnet 4.5, temp 0, with system prompt + user message + retrieved excerpts | `COPILOT_ANSWER_GENERATED` with model, latency, tokens |
| Source pill tap | Client-side drawer opens with section excerpt | `NOTE_SECTION_VIEWED` |
| Sheet close | UI dismisses | `COPILOT_SHEET_CLOSED` |

## What makes this work (build-team mental model)

**Rule 20 is non-negotiable.** The copilot's tools (`searchSignedNotes`, `fetchSectionExcerpts`, `lookupFollowUp`, `lookupFhirResource` in later waves) read **only** from:
- `Note.status ∈ {SIGNED, TRANSFERRED}` — never drafts
- `FollowUp.status != null` — clinician-confirmed only
- `FhirCachedResource.verifiedAt != null` — verified FHIR resources only (Wave 4)

No tool reads from `Note.draftJson` ever. The tool registry enforces this at the source-of-data level, not at a "we'll filter in the UI" level.

**Rule 23 is non-negotiable.** The copilot **does not recommend**. It answers factual questions. Eve might ask "what should I prescribe?" — the copilot won't answer that. It might say "I can show you Daniel's medication history" and surface data, but it never proposes a clinical action. Action tools (Wave 5, Unit 30) require explicit clinician initiation + confirmation; the copilot doesn't suggest them unprompted.

**Source pills are the foundation of trust.** Every fact the copilot surfaces has at least one source pill. Tapping it opens a drawer with the source excerpt. If a fact has no source, the copilot doesn't say it.

**Mode toggle: Chart vs Research.** Chart mode (default) reads OmniScribe data + FHIR. Research mode (Unit 29) reads PubMed Central + clinician-attested literature. They are *separate tool registries* — never co-mingled in the same chat. If a clinician asks a research question in chart mode, the copilot says: "I can search the literature for that — switch to Research mode." (Or, in later waves, auto-prompts a mode switch.)

**Scope: patient-locked.** When the beacon is opened from a capture or review surface, the scope is locked to that patient. Eve can't ask "show me all my patients on bupropion" from inside Daniel's visit — that would be a cross-patient query and requires a different surface (and broader auth).

## The agent loop in detail (for the build team)

```
1. Receive user message + context (patientId, noteId, mode, prior turns)
2. Compose system prompt:
   - Identity: "You are OmniScribe Co-Pilot. Read-only access to signed notes
     and verified data. Cite sources. Never recommend clinical action."
   - Tool registry definitions (chart-mode tools)
   - Patient scope: "Daniel Adams (patientId=..., orgId=...)"
   - Prior conversation turns (compressed if long)
3. LLM (Bedrock Sonnet 4.5, temp 0) decides:
   - Call tool? → emit tool call(s); execute; receive results; loop
   - Final answer? → emit answer with mandatory source pills
4. Each tool call:
   - Validate inputs (Zod)
   - Auth check (requireFeatureAccess + PHI scoping)
   - Execute against DB (Prisma; only SIGNED/TRANSFERRED notes for chart mode)
   - Return structured result
   - Audit log
5. Stream final answer to client via SSE
6. Render with clickable source pills
```

Max 6 tool calls per turn (cap). Max 20 turns per session. Long sessions auto-summarize prior turns to keep context bounded.

## Edge cases this journey handles

- **The copilot can't find a relevant note.** Answer: "I couldn't find a bupropion trial in Daniel's signed notes from the last 2 years. Would you like me to widen the search?" — clear admission of empty result; offer to retry.
- **Daniel's chart has a relevant note BUT it's in a sensitivity tier Eve can't see.** Answer: "Daniel has a record matching your query, but it's in a sensitivity tier you don't have access to. Please coordinate with the clinician of record." — never leaks the content; surfaces the existence + the obstacle.
- **The clinician switches mode mid-conversation.** Chart-mode chat history is cleared (different scope, different attestation rules). Research mode opens fresh. The two histories are not merged.
- **The clinician asks the copilot something that requires reasoning beyond source.** "Should I try venlafaxine?" — copilot responds: "I don't recommend clinical actions, but I can show you Daniel's history of antidepressant trials, his current symptoms documented in the last 3 visits, and contraindications I can find in the chart. Want any of that?"
- **The clinician asks about a different patient.** "What about Jane Smith — has she been on bupropion?" — copilot responds: "I'm scoped to Daniel's chart in this session. To ask about other patients, open Co-Pilot from their patient page or from your home screen." (Cross-patient queries require explicit scope change for auditability.)
- **Network failure mid-answer.** Sheet shows error state: "Lost connection — try again." Tool calls that already executed are audited; partial answer is not rendered (would be misleading without source completeness).
- **Tool call returns 0 results AND the LLM hallucinates an answer anyway.** Detection: every fact in the answer must trace to a tool call result. Post-generation validation rejects answers without source pills. If validation fails, response is "I couldn't find enough information to answer confidently. Here are the notes I searched: [list]."
- **A signed note is later soft-deleted.** Copilot tool returns the note still (audit retention); source pill remains tappable; if the user taps, they see a "this note was retracted on [date] — viewing for audit purposes" banner.

## Three-lens evaluation

**Clinician** — The copilot is fast, sourced, never preachy. It answers what was asked. It admits when it doesn't know. It never tells the clinician what to prescribe.

**Medicare Compliance Officer** — The copilot doesn't make clinical decisions — the clinician does. Every copilot answer is sourced. The copilot doesn't write to the record (action tools, when they ship in Wave 5, require explicit confirmation).

**Insurance Auditor** — Every copilot interaction is audited end-to-end: beacon open, message, tool calls, sources, answer, source-pill taps, sheet close. The full reasoning chain is reconstructable.

## What this journey doesn't cover

- The proactive Watch cards (Journey 03)
- Cross-patient queries (out of scope for v1 — separate surface)
- Action tools that draft messages / propose follow-up cadence (Unit 30 — explicit clinician initiation required)
- Research mode in detail (Unit 29 — separate tool registry, PubMed Central + attested literature)
- Multi-turn agent reasoning chains (Unit 31 — more complex agentic flows; still Rule-20 + Rule-23 bound)

## Build-team checklist for "this journey works"

- [ ] Copilot beacon renders on prepare + capture + review surfaces (NOT on sign or admin/owner surfaces in v0; expand scope in later units).
- [ ] Sheet opens patient-scoped; cross-patient queries return scope-violation message.
- [ ] Mode toggle (Chart / Research) is visible; switching clears chat history.
- [ ] Every tool the copilot can call is registered in `src/services/copilot/tools/`; PHI-allowlisted; auth-checked at the tool-execution boundary.
- [ ] All tools enforce Rule 20 at the data-fetch layer (e.g., `searchSignedNotes` query includes `WHERE status IN ('SIGNED', 'TRANSFERRED')`).
- [ ] LLM system prompt explicitly forbids clinical recommendations (Rule 23).
- [ ] Post-generation validation: answer must contain ≥ 1 source pill OR explicit "no data" message; otherwise reject + retry.
- [ ] Audit log captures: beacon open, message, every tool call with args hash, answer with sources, source pill taps, sheet close — all PHI-free metadata.
- [ ] Sensitivity-tier gating: notes the clinician can't access are surfaced as existence only, not content.
- [ ] Performance: copilot answer in ≤ 15 seconds for a typical chart-mode query (3 tool calls + LLM).
- [ ] 3-tap test: from capture, ask a question in ≤ 2 taps (beacon → type → send).
- [ ] Three-lens evaluation passes.

## Related references

- Copilot architecture + Ask mode design: [`references/encounter-copilot-spec.md`](../references/encounter-copilot-spec.md) (Phases 53–54)
- Watch mode (the proactive sibling): [`context/specs/07-encounter-copilot-watch-v0.md`](../context/specs/07-encounter-copilot-watch-v0.md)
- Build units delivering Ask mode: [`context/specs/00-build-plan.md`](../context/specs/00-build-plan.md) Unit 27 (Ask mode v1), Unit 28 (FHIR tools), Unit 29 (Research mode)
