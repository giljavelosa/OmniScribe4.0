# Unit 42: Copilot Persona — Miss Cleo

> **Wave 8 — Copilot maturity port (Miss Cleo).** Wave 8 opener. Port from OmniScribeThree; Wave 5 Units 27–31 already ship the agent loop, tools, research tab, drafts, and basic reasoning — this unit names the copilot and locks the voice.

## Goal

Give the encounter copilot a consistent, clinician-trusted identity: **Miss Cleo** — a peer-colleague clinical assistant (not a chatbot, not a decision engine). After this unit, every Ask and Research system prompt, empty-state string, and first-turn greeting uses the shared persona module. Rule 23 unchanged: data only, no clinical recommendations in card form.

> **Unit 42 ships when** a clinician opens the Co-Pilot Sheet and sees "Miss Cleo" in the header/subhead, receives a context-aware greeting on first open per session, and every LLM system prompt includes the persona block from one source file.

## Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | Display name | **Miss Cleo** — product-facing only; internal code uses `persona.ts`, not "Cleo" scattered in components |
| 2 | Voice | Peer colleague: concise, warm, clinically literate, never sycophantic. Speaks to a licensed clinician as an equal who happened to read the chart already |
| 3 | Anti-drift | Persona module exports `PERSONA_ANTI_DRIFT_BLOCK` appended to every copilot system prompt — reminds model: source-grounded only, no recommendations, cite sources |
| 4 | Salutation | `buildGreeting({ clinicianName, patientFirstName, surface, mode })` — pure function; first Sheet open per session only; never includes PHI beyond first name + role-appropriate clinician honorific |
| 5 | Scope | Persona + copy only. No SSE (Unit 43), no beacon drag (Unit 44), no reasoning refactor (Unit 45) |
| 6 | Stub mode | Greeting + empty states render identically in stub mode; stub banner unchanged |

## Design

### UI surfaces

- `<CopilotShell>` Sheet header: "Miss Cleo" + subhead "Clinical co-pilot" (Chart tab) / "Research assistant" (Research tab — persona voice adapts via mode param, name stays Cleo)
- `<AskSurface>` / `<ResearchSurface>` empty state: example questions remain; add one-line persona intro above chips
- First-open greeting bubble (assistant role, no tool calls) when history is empty

### Persona module

`src/services/copilot/persona.ts`:

```typescript
export const COPILOT_DISPLAY_NAME = 'Miss Cleo';

export function buildPersonaSystemBlock(mode: 'chart' | 'research'): string;
export function buildGreeting(input: GreetingInput): string;
export const PERSONA_ANTI_DRIFT_BLOCK: string;
```

- `buildPersonaSystemBlock` — prepended or merged into `ASK_SYSTEM_PROMPT` / `RESEARCH_SYSTEM_PROMPT` in `agent.ts`
- `buildGreeting` — deterministic template selection (morning/afternoon/evening optional); no LLM call for greeting in v1
- Anti-drift block — short, fixed string; version constant `PERSONA_VERSION = 'miss-cleo-v1'` for audit metadata

### Audit

Extend `COPILOT_ASK_ANSWERED` / `COPILOT_BEACON_OPENED` metadata with `personaVersion: 'miss-cleo-v1'` (PHI-free). No new audit actions in Unit 42.

## Implementation

1. Create `src/services/copilot/persona.ts` with exports above + unit tests (greeting shape, anti-drift present in both modes, no raw PHI in greeting templates)
2. Update `src/services/copilot/agent.ts` — inject `buildPersonaSystemBlock(mode)` into system prompt assembly for chart + research paths
3. Update `src/components/copilot/copilot-shell.tsx` — header copy
4. Update `src/components/copilot/ask-surface.tsx` + `research-surface.tsx` — empty state intro + first-open greeting via session-local `greetingShown` ref
5. Replace any generic "Co-Pilot" / "Clinical co-pilot" strings in copilot components with imports from persona module (beacon `aria-label` may stay "Open Co-Pilot" for accessibility — display name is Cleo inside Sheet)

## Dependencies

- Unit 31 — reasoning chain UI (Sheet structure stable)
- Unit 27–29 — Ask + Research endpoints and surfaces

## Out of scope (later Wave 8 units)

- SSE streaming → Unit 43
- Draggable beacon → Unit 44
- `planner.ts` / orchestrator → Unit 45
- Real web search → Unit 46
- DB conversation persistence → Unit 47

## Verify when done

- [ ] Single import path: no hardcoded "Miss Cleo" outside `persona.ts` + thin UI wrappers
- [ ] Chart + Research system prompts both include persona + anti-drift blocks
- [ ] First Sheet open per session shows greeting; second open in same session does not repeat
- [ ] Greeting uses clinician display name + patient first name only
- [ ] Stub mode: greeting renders; no Bedrock required
- [ ] `npm test` — persona unit tests pass; no regression in agent tests
- [ ] Three-lens: Clinician trusts the voice; Compliance — no PHI in audit metadata; Auditor — personaVersion traceable
