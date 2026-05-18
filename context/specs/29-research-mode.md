# Unit 29: Research Mode

## Goal

Wave 5 / Phase 54. Separate the copilot's "research the literature" capability from chart-mode answers (Units 27–28). The clinician opens the Sheet, switches to a Research tab, types "what does recent literature say about NSAIDs in CKD?" — the agent calls `searchPMC` / `searchAttestedLiterature`, returns an answer with literature citations. **Chart sources NEVER appear in research answers; research sources NEVER appear in chart answers.** The visual + data-flow separation is the whole point.

> **Unit 29 ships when** the CopilotShell has Chart / Research tabs, each with its own state + endpoint + tool set, and a research answer renders with literature citations (PMC id + title + journal + year) that link out to the PMC URL.

## Locked decisions

| # | Decision | Value |
|---|---|---|
| 1 | Separation strategy | Two tabs in the Sheet (Chart / Research). Each tab owns its own message state + endpoint + tool set. Switching tabs preserves the OTHER tab's state but never blends. Strongest visual + structural separation. |
| 2 | Tool set (v1) | 2 tools: `searchPMC({ query, limit? = 5 })` + `searchAttestedLiterature({ query, limit? = 5 })`. PMC = PubMed Central; attested = a vetted internal library (stub-mode synthesizes; real-mode lands when an attested-literature service exists). |
| 3 | Stub mode | Both tools return canned plausible results when no external service is configured. Lets the UI surface + agent loop be exercisable end-to-end. |
| 4 | Sources | New kind `'literature'` with `id = PMC{n}` or internal lit id, `label = "<title> (<journal>, <year>)"`. UI renders as a link to `https://www.ncbi.nlm.nih.gov/pmc/articles/<id>/` for PMC + a text chip for attested. |
| 5 | System prompt | Locked: research answers are EVIDENCE summaries, not clinical recommendations. NEVER tailor to a specific patient (the agent has no patientId in research mode). Cite all evidence. |
| 6 | Audit | New action `COPILOT_RESEARCH_QUERY`. Tool calls reuse `COPILOT_TOOL_CALL`. Answers reuse `COPILOT_ASK_ANSWERED` (with `mode: 'research'` in metadata). Avoids audit-action explosion. |
| 7 | History scope | Per-tab per-session (same in-memory pattern as Unit 27). Closed Sheet → both tabs discarded. |

## Design

### Tool set

`src/services/copilot/research-tools.ts`:

```typescript
searchPMC({ query: string, limit?: number })
  → { results: Array<{ pmcId, title, journal, year, abstract }> }

searchAttestedLiterature({ query: string, limit?: number })
  → { results: Array<{ id, title, source, year, summary }> }
```

Stub-mode results: 3 plausible canned entries per tool, seeded off the query so repeated dev queries are stable. Real-mode: `searchPMC` would hit eutils.ncbi.nlm.nih.gov (PMC API is public, no PHI sent); `searchAttestedLiterature` waits for an internal service.

### Agent runner

Extend `runAgent` with `mode: 'chart' | 'research'` on `AgentInput`. Mode drives:
- Which system prompt is used (`ASK_SYSTEM_PROMPT` vs `RESEARCH_SYSTEM_PROMPT`)
- Which tools the dispatcher accepts — research mode REFUSES chart tools (returns `wrong_mode_tool` error), chart mode REFUSES research tools. Fail-closed: the model can't mix even if the prompt drifts.

Research mode doesn't need patientId/noteId in the system prompt — the agent has no patient context. The route still passes them so org-scoping checks work for the audit row, but the agent's prompt has no `<context>` block.

### Endpoint

`POST /api/copilot/research` — body: `{ question, history }`. NOTE_REVIEW-gated (clinician role check). NO patientId — research is patient-agnostic. Returns `{ answer, toolCalls, iterations, stub }`. Writes:
- `COPILOT_RESEARCH_QUERY` on receipt (PHI-fenced: question length only)
- `COPILOT_TOOL_CALL` per tool invocation (tool name + result count)
- `COPILOT_ASK_ANSWERED` on response (metadata: `mode: 'research'`, source count, iteration count)

### UI

`src/components/copilot/research-surface.tsx` — research counterpart to Unit 27's `AskSurface`. Same shape (composer + message list + per-message source pills) but:
- Source pills use the `'literature'` kind: PMC → external link with `↗`, attested → text chip
- Empty state shows 3 example research questions ("recent evidence on X", "guidelines for Y")
- Background tint distinguishes research messages (subtle warning-tier background) from chart messages — visual reminder this is evidence, not chart data

`CopilotShell` Sheet gets a Tabs primitive:
- Chart (default) → existing `AskSurface`
- Research → new `ResearchSurface`

Switching tabs preserves each tab's state; closed Sheet discards both per Unit 27 spec.

## Implementation order

1. Spec + 1 new audit action + 2 research tool stubs (this commit)
2. `runAgent` mode param + research system prompt + tests
3. `/api/copilot/research` endpoint + audit
4. `ResearchSurface` UI + Tabs in `CopilotShell`
5. Tracker + PR #30

## Out of scope (Unit 29)

- Real PMC eutils API integration (stub-mode synthesizes; real-mode lands when the integration is wired)
- Attested literature service (stub-mode synthesizes; service doesn't exist yet)
- Citation export (no "copy to clipboard" / "export as RIS" in v1)
- Per-message follow-up: research answers can't trigger chart-mode follow-ups or vice versa
- Cross-tab history search (each tab is a silo)

## Verify when done

- CopilotShell Sheet has Chart + Research tabs.
- Chart tab still works identically to Unit 27/28 (no regression).
- Research tab: asking "what's the recent evidence on X" returns a stub-mode answer with literature pills.
- PMC pills link to `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC<n>/`.
- Switching tabs preserves each tab's message state.
- `runAgent` with `mode: 'research'` refuses to call chart tools (`wrong_mode_tool` error).
- Same with chart mode refusing research tools.
- Audit: 1 `COPILOT_RESEARCH_QUERY` + N `COPILOT_TOOL_CALL` + 1 `COPILOT_ASK_ANSWERED` (with `mode: 'research'`).
- progress-tracker.md updated; PR #30 stacked on Unit 28.
