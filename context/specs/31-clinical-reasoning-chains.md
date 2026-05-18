# Unit 31: Clinical Reasoning Chains

## Goal

Wave 5 / Phase 56–60 closing unit. The agent (Units 27–30) currently shows tool calls + final answer; clinicians see WHAT it looked up but not WHY each step. Unit 31 makes the chain of thought visible — between tool calls the model can emit a short "think" step that names the working hypothesis or what it's about to verify. The clinician can inspect the chain after the fact OR redirect mid-conversation with a one-click pivot.

> **Unit 31 ships when** an Ask question that the agent answers via multiple tool calls also surfaces a 2-5 step reasoning trail (collapsible by default), AND the clinician has a "Redirect" affordance on assistant messages that pre-fills the composer with a pivot prompt.

## Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | "Think" as a 3rd action | Model emits `{ action: 'think', summary: '<≤120 chars>' }` between tool calls + before the final answer. Strict-JSON contract extended; cap at 1 think per iteration to keep the loop bounded (still MAX_ITERATIONS=4 ceiling). |
| 2 | Reasoning surface | Collapsible "Reasoning chain" under the assistant bubble. Closed by default — most clinicians want the answer; the chain is for trust-verification + audit-aware review. Header chip shows the step count + a small "Show". |
| 3 | Pause/redirect | "Redirect" button on every non-error assistant message. Click opens an inline composer pre-filled with `"Pivot from this answer: "` so the clinician sees the system's framing before typing. The pivot question becomes the next user message in the conversation, preserving prior history. |
| 4 | Rule 20 + 23 bounds | Reasoning steps are PHI-fenced at the audit metadata layer (summary LENGTH only, never the text). Rule 23 (no clinical recommendations in card form) holds: the reasoning chain is text-only, never renders as an actionable card. |
| 5 | Audit | New action `COPILOT_REASONING_STEP` — one row per step. Metadata: `stepIndex` + `summaryLength`. Bounded by MAX_ITERATIONS so audit volume is capped per ask. |
| 6 | Stub-mode | Stub-mode LLM returns the same canned response as Unit 27; no reasoning steps. The UI gracefully renders empty `reasoningSteps`. |

## Design

### Agent action union extension

The model can now emit THREE action shapes (was two):

```json
{ "action": "think", "summary": "<≤120 char working hypothesis or plan>" }
{ "action": "tool", "tool": "<name>", "args": { ... } }
{ "action": "answer", "text": "...", "sources": [...] }
```

Parser accepts the new shape. Iteration semantics:
- `think` does NOT consume the iteration ceiling. It's a free intra-step annotation.
- The agent accumulates `reasoningSteps: Array<{ index, summary }>` across the loop.
- To prevent runaway "think" loops, the agent enforces `MAX_THINK_STEPS = 5` total per agent call — exceeding returns a graceful answer fallback.

### System prompt addition

Append to `ASK_SYSTEM_PROMPT` + `RESEARCH_SYSTEM_PROMPT`:

```
═══ REASONING (Unit 31) ═══

Before a tool call OR before your final answer, you MAY emit ONE
"think" step:
  { "action": "think", "summary": "<your working hypothesis, ≤120 chars>" }

Think steps are visible to the clinician (collapsible chain under the
answer). Use them sparingly — 1-3 per answer is plenty. Each think MUST
be 120 characters or fewer. NEVER include patient identifiers or PHI in
think summaries.

If you don't need to think, skip straight to a tool call or answer.
```

### Per-iteration audit cost

Worst case: 4 iterations × (1 think + 1 tool) = 4 PROPOSED-style steps + 4 TOOL_CALL rows + 1 ANSWERED row = ~9 audit rows per ask. Still bounded; the `MAX_THINK_STEPS = 5` cap means reasoning audit volume tops out at 5 per ask regardless of how many tool calls happen.

### UI surface

`src/components/copilot/reasoning-chain.tsx` — collapsible reasoning surface:
- Header: chip "🧠 Reasoning chain · N steps" with a Show/Hide toggle
- Each step rendered as `N. <summary>` (mono font, muted color, indented)
- Footer hint: "The agent showed its thinking — useful for trust calibration."

`AskSurface` / `MessageBubble`:
- New `ChatMessage.reasoningSteps?: Array<{ index, summary }>` field
- ResearchSurface mirrors the same surface (research-mode reasoning is just as useful)
- "Redirect" button below each assistant message (next to source pills) — click opens an inline composer pre-filled with "Pivot from this answer: "

### Redirect interaction

Click "Redirect" → `setRedirectDraft("Pivot from this answer: ")` → renders an inline composer at the bottom of THIS message (not the global one) → user types after the prefix → Submit converts to a new user message in the conversation. Cancel collapses the inline composer.

Implementation: the inline composer is the SAME `Textarea + Send` pair the main composer uses, just scoped to a single message. When the clinician submits, the call delegates to the surface's existing `send()` so audit + history pipeline doesn't fork.

### Reasoning steps in /ask response

The response shape grows:

```typescript
{
  data: {
    answer, toolCalls, drafts, iterations, stub,
    reasoningSteps: Array<{ index: number, summary: string }>
  }
}
```

Per-step `COPILOT_REASONING_STEP` audit fires in the route after the agent returns + before the ANSWERED audit. Bounded by `MAX_THINK_STEPS` so volume is capped.

## Implementation order

1. Spec + COPILOT_REASONING_STEP audit + ASK_SYSTEM_PROMPT think contract (this commit)
2. Agent extended with reasoning loop + parser + tests
3. /ask response surfaces reasoningSteps + per-step audit
4. ReasoningChain component + AskSurface + ResearchSurface integration + Redirect button
5. Tracker + PR #32

## Out of scope (Unit 31)

- True streaming chain-of-thought (Wave 6 polish — current sync response shape is fine for v1)
- Pause MID-LOOP (true pause requires streaming; v1 redirect is between-asks only)
- Multi-step reasoning chains spanning multiple asks (each ask is independent — no carry-over reasoning state)
- Native Bedrock Converse "thinking" blocks (still prompt-engineered JSON; native swap is a future infra refactor)

## Verify when done

- Agent emits + accumulates think steps; reasoningSteps surfaced on AgentOutput.
- /ask response includes reasoningSteps; per-step audit row fires.
- AskSurface + ResearchSurface render a collapsed "Reasoning chain" chip under each assistant message; click expands the list.
- Redirect button opens an inline composer pre-filled with the pivot prefix.
- MAX_THINK_STEPS ceiling enforced (no runaway think loops).
- progress-tracker.md updated; PR #32 stacked on Unit 30. **Wave 5 closes.**
