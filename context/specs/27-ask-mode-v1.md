# Unit 27: Ask Mode v1 — Agent Loop

## Goal

Wave 5 / Phase 53. The `CopilotShell`'s Sheet has been placeholder text since Unit 07. Unit 27 graduates it to a multi-turn chat surface backed by a simple agent loop with four read-only lookup tools. Every answer carries source pills; chat history lives per-session (in-memory, cleared on Sheet close); Rule 20 enforced server-side (tools only return data from attested sources).

> **Unit 27 ships when** a clinician opens the Co-Pilot Sheet on /prepare or /capture, types "what was the plan from her last visit?", the agent calls `lookupSignedNote` server-side, and the model's answer renders with a Source pill back to the note it cited.

## Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | Tool-use mechanism | Prompt-engineered JSON action loop (NOT native Bedrock tool-use API). System prompt locks the contract: model emits `{ "action": "tool", "tool": "...", "args": {...} }` to invoke a tool OR `{ "action": "answer", "text": "...", "sources": [...] }` to finalize. Simpler than threading the Converse API through the existing `LLMService.generate` contract; future polish can swap to native tools when the second use case lands. |
| 2 | Max iterations | 4 — model can call up to 3 tools before being forced to answer. Bounds runaway loops + token cost; 4 is enough for "look up notes → look up follow-ups → look up demographics → answer." |
| 3 | History scope | Per-session, in-memory in the React Sheet. Closed Sheet → discarded. No DB persistence in v1 (spec defers `ChatSession` persistence to Wave 6 — premature without real usage signal). |
| 4 | Tools (v1) | `lookupSignedNote`, `lookupFollowUp`, `lookupEpisodeGoals`, `lookupPatientDemographics`. Read-only, org-scoped via session. FHIR tools (Unit 28) intentionally separate so the Bedrock token budget per prompt stays bounded. |
| 5 | Sources | Mandatory on every answer. Format: `Array<{ kind: 'note' \| 'follow-up' \| 'goal' \| 'patient', id, label }>`. The chat surface renders each as a SourcePill (or the new EhrSourcePill in Unit 28). Empty sources → answer is rejected client-side (fail-closed). |
| 6 | Stub mode | When LLM is stubbed (Bedrock unconfigured), the endpoint returns a canned response: "Ask mode runs against Bedrock — set AWS_BEARER_TOKEN_BEDROCK to use it." No tool calls. Lets the UI surface itself be exercisable end-to-end without an LLM key. |

## Design

### Agent runner

`src/services/copilot/agent.ts`:

```typescript
type AgentTurn = { role: 'user' | 'assistant' | 'tool-result'; content: string };

type AgentInput = {
  patientId: string;
  noteId: string;
  orgId: string;
  history: AgentTurn[];     // prior chat turns this session
  question: string;          // new user message
};

type AgentOutput = {
  answer: { text: string; sources: AskSource[] };
  toolCalls: Array<{ tool: string; args: unknown; result: unknown }>;
  stub: boolean;
};

async function runAgent(input: AgentInput, ctx: AgentContext): Promise<AgentOutput>;
```

Loop:
1. Build conversation: system prompt + history + current question
2. Call LLM in JSON mode
3. Parse JSON response
4. If `action: 'tool'`: run the tool via the registry, append result as a `tool-result` turn, loop (max 4 iterations)
5. If `action: 'answer'`: validate sources non-empty, return
6. If max iterations hit: force an answer pass with a "you've used your tools — answer now" hint

### Tools

`src/services/copilot/tools/`:

- `lookupSignedNote(noteId)` — reads the Note's `finalJson` (Rule 20: requires `status IN (SIGNED, TRANSFERRED)`). Returns `{ sections: Array<{ label, content }>, signedAt, clinicianName }`.
- `lookupFollowUp(patientId, status?)` — returns up to 10 FollowUps for the patient, optionally filtered by status. Includes `originNoteId` for the source pill.
- `lookupEpisodeGoals(episodeId)` — returns active + partially-met goals on the EpisodeOfCare.
- `lookupPatientDemographics(patientId)` — returns `{ firstName, lastName, dob, sex, division, mrn }`. No PHI denied — the clinician has authority to see their own patient's demographics.

Each tool:
- Pure function over `(prisma, orgId, args) → result`
- Asserts `orgScoping` at the boundary (assertOrgScoped via the patient's orgId)
- Returns a structured shape the model can consume + the surface can render as source pills

### System prompt

```
You are a clinical co-pilot answering a clinician's question about a specific patient
during their visit. You have access to four read-only lookup tools:
  - lookupSignedNote({ noteId })
  - lookupFollowUp({ patientId, status? })
  - lookupEpisodeGoals({ episodeId })
  - lookupPatientDemographics({ patientId })

EVERY answer you produce MUST be source-grounded. Cite the source for every fact via
the `sources` array in your final answer. NEVER invent facts. NEVER provide clinical
recommendations beyond what the source notes say.

OUTPUT FORMAT (strict JSON, nothing else):
  - To call a tool: { "action": "tool", "tool": "<name>", "args": { ... } }
  - To finalize:    { "action": "answer", "text": "<short answer>", "sources": [
      { "kind": "note" | "follow-up" | "goal" | "patient",
        "id": "<id>",
        "label": "<short human label>" }
    ] }

If you don't have enough information to answer, ASK A FOLLOW-UP QUESTION via:
  { "action": "answer", "text": "<question>", "sources": [] }
(empty sources = the surface will surface this as a clarification, not an answer)
```

### API

`POST /api/copilot/ask` — body: `{ patientId, noteId, question, history }`. NOTE_REVIEW-gated. Calls `runAgent`. Returns `{ answer, toolCalls, stub }`. Writes:
- `COPILOT_ASK_QUERY` on receipt (PHI-fenced: metadata is question length, NOT the question text)
- `COPILOT_TOOL_CALL` per tool invocation (metadata: tool name + result count, not args)
- `COPILOT_ASK_ANSWERED` on response (metadata: source count, iteration count, stub flag)

### UI

`src/components/copilot/ask-surface.tsx` — client. Mounts inside `CopilotShell`'s Sheet (replacing the placeholder paragraph). Owns:
- Message list (user bubbles right, assistant bubbles left, tool-call chips inline)
- Composer with Textarea + Send button
- Per-assistant-message source pills (note → SourcePill linking to /review/[id]; follow-up → text only with "from note 2025-09-04"; goal → text only; patient → demographics chip)

`CopilotShell` (Unit 07) — minor refactor: import + mount `AskSurface` instead of the placeholder text block.

## Implementation order

1. Spec + 3 audit actions + tool registry skeleton (this commit)
2. Agent runner + LLM JSON parsing + tests
3. /api/copilot/ask endpoint + Zod validation + audit
4. AskSurface UI + CopilotShell wiring
5. Tracker + PR #28

## Out of scope (Unit 27)

- FHIR tools (`lookupFhirCondition`, etc.) — Unit 28.
- Research-mode tools (`searchPMC`, etc.) — Unit 29.
- Action tools (drafts) — Unit 30.
- Chat history persistence — Wave 6.
- Streaming responses — v2 polish (full responses in v1; agent latency is bounded by max iterations).
- Native Bedrock Converse API tool-use — v2 polish (prompt-engineered JSON works for the 4-tool scope; native swap is a future infra refactor).

## Verify when done

- `/api/copilot/ask` returns a structured answer with non-empty sources in real-mode.
- `/api/copilot/ask` returns the stub-mode canned response when Bedrock isn't configured.
- Tool calls audited per invocation; query + answer audited once each.
- AskSurface in the CopilotShell Sheet sends + receives + renders messages.
- Sources on each assistant message link or display correctly per kind.
- Max-iteration ceiling enforces non-runaway behavior (test: a question that would loop forever returns a "ran out of tool calls" answer after 4 iterations).
- progress-tracker.md updated; PR #28 stacked on Unit 26.
