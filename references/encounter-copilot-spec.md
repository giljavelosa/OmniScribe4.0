# OmniScribe — Encounter Copilot Master Spec

**Status:** Draft for review and roadmap planning
**Owner:** Gil
**Last updated:** 2026-05-11
**Implementation pattern:** Master spec; derive numbered `cursor-tasks/` files (slots 50–59) per phase
**Anchored anti-regression rules:** 1, 4, 6, 8, 14, 17, 20, 21, 22, 23 (new — added by Phase 50)

---

## 1. Goal

The clinician should have **one** always-available conversational surface — already in place as the `GlobalCopilotBeacon` in the bottom-right of every clinical and admin route — that does two things:

1. **Ask:** answer any grounded clinical or workflow question the clinician types, by orchestrating a typed catalog of tools (search signed notes, fetch a brief, look up a CPT code, query the FHIR cache once F4 lands, etc.).
2. **Watch:** pre-fetch grounded context for the patient/encounter currently in view and surface it as glanceable cards above the chat input — without being asked.

Both modes share the same tool catalog, the same safety boundaries, and the same audit shape. The chatbox is the **product surface**; the agent + tools + grounding sources are the **substance** behind it.

This is the realisation of the "visit-time medical assistant" sketched in `fhir-integration-spec.md` §16 — the original 30-second-card brainstorm anchored in the founder's clinical workflow.

## 2. Why this anchors the roadmap

OmniScribe today has a lot of AI capabilities, all of them buried behind specific screens or automatic pipelines:

- Note generation runs in a worker the clinician never sees
- Brief generator output appears as a card on `/prepare/[noteId]`
- Follow-up extractor proposals appear at sign-time
- Copilot grounded-query lives only on `/review/[noteId]`
- Voice-id runs invisibly during transcription
- Goal analysis appears only inside generated notes

There is no single place a clinician can **ask** the system to use those capabilities mid-workflow, and no single place the system can **proactively** surface the right capability's output without the clinician knowing which capability to invoke.

The chatbox is the unifier. Once it exists as a real agent surface:

- Clinicians get one mental model ("ask Co-Pilot") instead of N screens
- New capabilities ship as new tools, not new screens
- Every tool call is audited the same way, simplifying compliance review
- The FHIR roadmap (F1–F6) becomes 10× more valuable — F3.2's cached resources finally have a clinician-facing read path that isn't a bespoke screen

Strategically, the Encounter Copilot also unlocks:

- **Visit-time decision support** without crossing the FDA SaMD line (cards surface DATA, never recommendations)
- **Cross-discipline continuity** (PT, BH, primary care all ask the same Co-Pilot)
- **Founder-clinician workflow recovery** — the original 30-second-card pitch becomes shippable

## 3. Non-goals (v1)

Listed so scope doesn't drift mid-build.

- **No autonomous actions.** Every "do" tool requires explicit clinician confirmation before it executes (Phase 55 introduces the first action tools; v0–v1 are read-only).
- **No clinical recommendations.** The Co-Pilot surfaces structured data ("last A1c was 8.2 in March"); it never says "you should order an A1c today." That distinction is what keeps the product out of FDA SaMD scope.
- **No diagnostic claims.** Cards quote source data verbatim or summarise it within the rule-20 attested boundary; they never produce de-novo clinical inferences.
- **No patient-facing chat.** The Co-Pilot is clinician-facing only. Patient-facing chat surfaces have entirely different consent and safety requirements.
- **No untrusted ingestion.** Tools read only from rule-20-attested sources (SIGNED / TRANSFERRED notes, clinician-confirmed `FollowUp` rows, verified `PatientFhirIdentity` → FHIR cache rows). Drafts, transcripts of in-progress notes, and unverified FHIR identities are out of bounds.
- **No global "history" persistence in v0.** Conversation state lives in-memory per session; persistent multi-day chat history is a v1.5+ design (see Phase 54).
- **No tool that mutates a signed note's `finalJson`.** Rule 3 stays untouched.

## 4. Architecture overview

```
┌───────────────────────────────────────────────────────────────────┐
│  GlobalCopilotBeacon (already mounted in clinical + admin layouts)│
│                                                                   │
│  ┌────────────────────┐  ┌─────────────────────────────────────┐  │
│  │ <EncounterCardSec> │  │ <AskInput> + <AskAnswer>            │  │
│  │                    │  │                                     │  │
│  │ Watch-mode cards   │  │ Reactive Q&A (Phase 51+ → agent loop)│ │
│  │ (Phase 50: open    │  │                                     │  │
│  │  follow-ups; later │  │                                     │  │
│  │  Phase 52: plan;   │  │                                     │  │
│  │  Phase 53–54: live │  │                                     │  │
│  │  transcript trig)  │  │                                     │  │
│  └─────────┬──────────┘  └────────────────┬────────────────────┘  │
│            │                              │                       │
│            └──────────┬───────────────────┘                       │
└───────────────────────┼───────────────────────────────────────────┘
                        │
                        ▼
            ┌──────────────────────┐
            │  Tool catalog        │
            │  (typed, audited,    │
            │   PHI-guarded)       │
            └─┬───────────┬────────┘
              │           │
   ┌──────────▼─┐   ┌─────▼──────────┐
   │ Read tools │   │ Action tools   │
   │ (Phase 50+)│   │ (Phase 55+)    │
   └─────┬──────┘   └────────────────┘
         │
         ▼
   ┌──────────────────────────────────────────────────┐
   │  Grounded sources (rule 20 attested only)        │
   │  ─ SIGNED / TRANSFERRED Notes                    │
   │  ─ FollowUp rows (clinician-confirmed at sign)   │
   │  ─ FhirCachedResource (verified link, F3+)       │
   │  ─ EpisodeGoal + GoalProgressEntry               │
   │  ─ Deterministic lookups (CPT codes, schedule)   │
   └──────────────────────────────────────────────────┘
```

The **chatbox surface** is unchanged across phases — the only thing that grows is the tool catalog behind it, the orchestration loop on top of it, and the trigger paths that surface Watch cards.

## 5. The two modes

### Ask (reactive)

| | v0 (today) | v1 (Phase 54) |
|---|---|---|
| Turns | Single | Multi |
| LLM behaviour | One-shot prompt | Tool-using agent loop (Bedrock Claude function-calling) |
| Tools | 0 (just an LLM call to a fixed prompt) | Full catalog |
| Streaming | None | Token + agent-activity streaming |
| State | None | In-memory per session |
| Audit | One row per question | One row per question + one per tool call |

### Watch (proactive)

| | v0 (Phase 50) | v1 (Phase 52) | v2 (Phase 53–54) |
|---|---|---|---|
| Trigger | Page mount on `/prepare/[noteId]` or `/capture/[noteId]` | Same | Live transcript content (entity match + LLM classifier) |
| Card kinds | `open_followup` | + `plan_for_today` | + `last_a1c`, `active_meds`, `recent_vitals`, `allergies` |
| Data sources | FollowUp table | + finalJson Plan section | + FHIR cache |
| Latency budget | <500ms | <500ms | <2–3s end-to-end |
| Cost per encounter | ~0 LLM calls | ~0 LLM calls | Bounded — keyword gate before any LLM call |

Cards have a strict UX contract:

- **Glanceable in 2 seconds.** Single line of text + source pill at minimum.
- **Dismissable in 1 tap.** Persistent per-clinician across visits (Phase 50's `CopilotCardDismissal` table).
- **Never modal.** Never steal focus from recording controls.
- **Never recommend.** Surface DATA only — "From your last visit you noted: re-check BP," not "You should re-check BP." Crossing this line is the FDA SaMD risk.
- **Always traceable.** Every card has a tap-through to the source — clinician can audit the claim back to a signed note or a FHIR resource.
- **Rate limited.** ≤1 visible card-or-chip element on screen at a time. ≥2 underlying items collapse to a count chip.

## 6. Tool catalog

The tool catalog is a typed registry of pure functions the agent (Phase 54+) and the Watch resolvers (Phase 50+) can call. Every tool has:

- A name + description (the LLM uses these to pick)
- A zod input schema
- A PHI guard (`assertProviderAllowedForPHI` / rule 17 / per-vendor BAA env flag)
- An audit hook (rule 8: every tool call writes one audit row, PHI-free metadata only)
- A permission scope (some tools are clinician-only, some org-admin-only)

| Tool | Status | Backed by |
|---|---|---|
| `getOpenFollowUps(patientId)` | Phase 50 | FollowUp table + Phase 50 resolver |
| `getPlanFromLastVisit(patientId)` | Phase 51 | Most recent signed note's Plan section |
| `searchSignedNotes(patientId, question)` | Already exists | `answerGroundedQuery` + investigator + adjudicator |
| `getPatientPriorBrief(patientId)` | Already exists | `services/llm/brief-generator.ts` |
| `getEpisodeGoalProgress(patientId, episodeId?)` | Already exists | `EpisodeGoal` + `GoalProgressEntry` |
| `lookupCptCode(query)` | Already exists (partial) | rehab CPT validator data |
| `searchPatients(query)` | Already exists | patient search route |
| `getActiveMedications(patientId)` | Lands with FHIR F4 | FhirCachedResource (`MedicationStatement` / `MedicationRequest`) |
| `getRecentLabs(patientId, type?)` | Lands with FHIR F4 | FhirCachedResource (`Observation` lab category) |
| `getRecentVitals(patientId)` | Lands with FHIR F4 | FhirCachedResource (`Observation` vital-signs category) |
| `getActiveAllergies(patientId)` | Lands with FHIR F4 | FhirCachedResource (`AllergyIntolerance`) |
| `getActiveConditions(patientId)` | Lands with FHIR F4 | FhirCachedResource (`Condition`) |
| `draftPatientMessage(patientId, intent)` | Phase 55 (action) | New |
| `proposeFollowUpCadence(diagnosis, lastVisitDate)` | Phase 55 (action) | New |
| `enqueueFhirSync(patientFhirIdentityId)` | Phase 55 (action) | Wraps existing `/api/fhir/sync` |

Most of v1's value comes from wiring the *already-built* read capabilities into a typed tool registry. The new ML work is small; the orchestration work is real.

## 7. Trigger pipeline

Watch mode has two trigger paths, layered in over time:

**Visit-context trigger (Phase 50–52).** Fires when the clinician opens `/prepare/[noteId]` or `/capture/[noteId]`. The patient is known from the URL → resolved to `patientId` → resolvers run → cards rendered. Deterministic, fast, no LLM. This is the foundation.

**Transcript-content trigger (Phase 53–54).** Fires mid-encounter when the live transcript mentions a clinical entity the system can ground. Two-stage gate to keep cost + latency bounded:

1. **Keyword/entity match (browser-side, free).** Parse each finalised utterance for clinical entities (med names from a known list, lab terms, body parts, allergies). On match, mark a candidate trigger.
2. **LLM classifier (server-side, fast model).** Only invoked if step 1 fired AND a per-card-kind cooldown has elapsed (default 30s). Decides whether the candidate is *actually* a relevant moment to surface a card. Returns confidence score; only cards above a threshold are shown.

Trigger source (browser vs server): start browser-side because the transcript stream is already there. Move server-side once we want cross-device cards (e.g. the clinician's phone surfaces a card based on what's said on the desktop's mic).

## 8. Card UX contract (locked)

Every Watch card MUST satisfy:

| Constraint | Locked rule |
|---|---|
| Visible elements at once | ≤1 (multiple items collapse to a count chip) |
| Temporal rate limit | ≤1 surface change per 30s per card kind |
| Dismiss | Single tap, persistent per-clinician across visits |
| Modal? | Never |
| Steals focus? | Never |
| Provenance | Always — source pill + tap-through to underlying note or resource |
| Recommendation language | Forbidden — DATA only ("you noted: …", "last value: …") |
| Markdown / HTML in card text | Forbidden — plain string only |
| PHI in audit metadata | Forbidden — `cardKind` + `cardEntityId` + counts only |

## 9. Safety boundaries

- **Rule 20 propagation.** Card resolvers read only from SIGNED / TRANSFERRED notes, sign-time-confirmed FollowUp rows, and (once F4 lands) FHIR cache rows whose `PatientFhirIdentity.matchConfidence === "verified"`. No drafts, no unattested transcripts, no unverified identity links.
- **Rule 21 propagation.** Audit metadata for every fetch + dismiss + tool call records IDs, kinds, counts, latencies, status codes — never card text, follow-up content, patient name, MRN, or DOB.
- **Rule 23 (new at Phase 50).** Cards surface DATA only, never clinical recommendations. Card text is rendered as plain string. Adding a new card kind requires both a resolver AND a doc note declaring why this card does not cross into recommendation territory.
- **Per-tool PHI guard.** Every tool that touches PHI runs through the existing `assertProviderAllowedForPHI` pattern (rule 17). Sandbox-only data is gated separately.
- **Per-tool permission scope.** Tools declare who can call them. Most are clinician-only (and use `requireFeatureAccess(PATIENTS_READ)`). Some action tools (Phase 55) require org-admin role or per-action consent.
- **FDA SaMD line.** The product line that keeps the Co-Pilot out of FDA SaMD jurisdiction is: **the Co-Pilot does not produce clinical conclusions or recommendations; it only retrieves and surfaces pre-existing clinical data the clinician already has the right to see.** Every card kind, every tool, and every Ask answer must respect that line. When in doubt, do less.

## 10. Conversation state

| Phase | State model | Persistence | Why |
|---|---|---|---|
| 50 (this) | None — Watch cards only, no conversation | — | Watch is one-shot per page mount |
| 51 | Same | — | Same — second card kind, same model |
| 54 | In-memory per beacon mount | Lost on page nav | Multi-turn within an encounter; agent loop benefits from short-history context |
| 55+ | DB-backed (`CopilotConversation` + `CopilotMessage`) | Per-clinician across days | Clinician resumes "what did I ask about Mrs. Abreu yesterday?" |

The conversation table is NOT in scope for v0/v1. Defer until the agent loop is shipped and we have evidence clinicians want history.

## 11. Compliance

- **HIPAA.** Audit-log every tool call + every card fetch + every card dismiss. PHI-free metadata.
- **42 CFR Part 2 propagation.** When the FHIR cache row carries a `sensitivityLevel === "42CFRPart2"` (Phase F3.1's propagation table), the surfacing tools MUST honor it. Cards backed by Part 2 data either don't show OR show a redacted form per the existing `canAccessNoteSensitivity` access checks.
- **BAA.** All LLM calls in the agent loop go through the existing PHI-guarded LLM service (Bedrock for production; sandbox for dev). Same gate the rest of the product uses.
- **Tribal sovereignty.** Same per-deployment review as the rest of the product. No additional surface introduced here.
- **Data minimisation.** Tools return only what the agent needs to answer the question. The agent's prompt must not include the patient's full chart by default — only the specific data the user's question implicates.

## 12. Phasing roadmap

| Phase | Slot | Title | Risk | Effort | Status |
|---|---|---|---|---|---|
| **50** | `50-encounter-copilot-watch-card-followups.md` | Watch v0: open-follow-ups card + dismissal model + card registry foundation | Medium (rule 23 new, persistence model new) | 1 sprint | Drafted 2026-05-11 |
| **51** | `51-encounter-copilot-watch-card-plan.md` | Watch v0.5: plan-from-last-visit card (reuses Phase 50's infra) | Low | 2–3 days | Drafted 2026-05-11 |
| **52** | `52-encounter-copilot-watch-cards-fhir.md` | Watch v1: FHIR-cache-backed cards (medications, last A1c, vitals, allergies, conditions) | Medium | 1.5 sprints | Drafted 2026-05-11 — unblocked the moment F3.2 sync runs against a verified-linked patient (F3.2 shipped) |
| **53** | `53-encounter-copilot-transcript-trigger.md` | Live-transcript subscription + keyword-gate trigger pipeline (browser-side) | High | 1.5 sprints | Blocked on Phase 52 |
| **54** | `54-encounter-copilot-ask-agent-loop.md` | Ask-mode upgrade: Bedrock Claude function-calling + tool catalog + multi-turn + streaming | High | 2 sprints | — |
| **55** | `55-encounter-copilot-action-tools.md` | First action tools (draft message, propose cadence, enqueue sync) with explicit confirm-before-act + undo | High | 2 sprints | — |
| **56** | `56-encounter-copilot-research-mode.md` | Research mode — freeform external lookup (DailyMed, PubMed, MedlinePlus) gated by one-time signed disclosure + PHI detector + quote-and-link discipline + copy-to-chart attest. The Co-Pilot becomes a researcher/secretary the clinician can use mid-workflow without opening a browser tab. Adds CLAUDE.md rule 27. | High (FDA SaMD-adjacent; HIPAA still hard line) | 3–4 sprints + parallel legal review | Drafted 2026-05-11 |
| **57** | `57-encounter-copilot-research-ai-knowledge.md` | Research mode — AI knowledge answer tool. Closes the gap where Phase 56's three external sources don't cover general medical-knowledge questions (mechanism of action, anatomical reference, condition comparisons, recovery timelines). LLM answers from training data with NO verifiable source citation; distinct visual treatment + extra disclaimer wrap on copy-to-chart. Disclosure v2. Adds CLAUDE.md rule 28. | High (no source backing; visual treatment is the safety surface) | 1–1.5 sprints + parallel legal review | Drafted 2026-05-11 |
| **58** | `58-encounter-copilot-research-vendor-reference.md` | Research mode — vendor reference tools (UpToDate, DynaMed, Lexicomp) gated by per-org subscription configuration + per-vendor BAA env flag. Per-org admin UI for vendor management. Disclosure v3. Adds CLAUDE.md rule 29. Vendor failures are loud + source-attributed; never silent fallback. | High (per-vendor contract chains + license compliance) | 3–4 sprints + per-vendor contract negotiation | Drafted 2026-05-11 |
| **59** | `59-encounter-copilot-research-web-search.md` | Research mode — curated web search via the org-configured provider (Brave / Bing / You.com), filtered to a ~30-domain medical-source allowlist. Off-allowlist results silently dropped. Copy-to-chart requires "Open to verify" tap first. Disclosure v4. Adds CLAUDE.md rule 30. Unfiltered web search permanently out of scope. | Highest (open web exposure; allowlist IS the safety surface) | 2–3 sprints + parallel legal review | Drafted 2026-05-11 |
| **60** | `60-encounter-copilot-clinical-reasoning-agent.md` | Clinical reasoning agent — cross-mode chains (Chart reaches into Research tools mid-conversation, gated by consent + per-call PHI guard + PHI-strip transform), plan-then-act loop (planner produces structured JSON plan before action), reasoning narration (new SSE events stream the chain to the clinician inline), synthesis with calibrated language + adjudicator pattern. Recommendation-shaped questions deflected at planning time. Addresses the 10 named clinical-reasoning failure modes. Adds CLAUDE.md rule 31. | High (the chain crosses safety boundaries; PHI-strip is non-negotiable) | 2–3 sprints + parallel legal review | Drafted 2026-05-11 |

### Phase boundaries (the gates)

- **50 ships when** opening `/prepare/[noteId]` or `/capture/[noteId]` for a patient with open follow-ups surfaces them as an inline card or count chip in the beacon, with persistent per-clinician dismissal that survives page reload + future visits.
- **51 ships when** the same beacon also surfaces the verbatim Plan section text from the most recent signed note for the patient in view.
- **52 ships when** medications / last A1c / recent vitals / allergies / active conditions cards appear for any patient with a verified `PatientFhirIdentity` link and a populated `FhirCachedResource` row set, with a freshness chip when the cache is >24h stale and an amber warning when >7d stale.
- **53 ships when** mentioning "gabapentin" mid-encounter (in the live transcript) surfaces an `active_meds` card within 2–3s, gated by a keyword pre-filter.
- **54 ships when** a clinician can type "what was her last A1c?" into the Ask box and the agent picks `getRecentLabs`, calls it, and returns a streamed grounded answer with citation.
- **55 ships when** the clinician can ask "draft a message telling her to come in for a BP recheck" and the agent produces a draft requiring explicit tap-to-send confirmation, with full audit + undo.
- **56 ships when** a clinician can switch the beacon to Research mode, sign the disclosure once, type a non-PHI query (or have the system PHI-strip + auto-rewrite their query), and see the agent route to DailyMed / PubMed / MedlinePlus and surface raw source quotes with links — without ever opening a browser tab. Research outputs MUST never appear in any chart-grounded surface; copy-to-chart is the only legitimate path into the medical record and requires an explicit attest tap.
- **57 ships when** the clinician can ask a general medical-knowledge question that DOESN'T match an external source (mechanism of action, anatomical reference, etc.) and the agent responds with an `ai_knowledge_answer` rendered with high-contrast "AI KNOWLEDGE — NO EXTERNAL SOURCE CITATION" disclaimer banner, and copy-to-chart wraps the text with the AI-knowledge prefix.
- **58 ships when** an org admin can configure UpToDate / DynaMed / Lexicomp via the per-org admin UI, the clinician sees that vendor's tool in their Research-mode tool list, and the tool returns vendor-specific quote-and-link results — with vendor failures surfacing as vendor-attributed errors instead of silent fallback to a different source.
- **59 ships when** an org admin configures a web-search provider, the clinician asks a question best answered by current web content, and the agent surfaces up to 5 results filtered to the curated medical-domain allowlist — with copy-to-chart disabled until the clinician taps "Open to verify."
- **60 ships when** the founder-scenario integration test passes: clinician asks *"Patient called — said he got dizzy a week after starting the medication we prescribed. Is this a side effect of what I gave him?"* and the agent produces a 4-step chain (identify patient → retrieve recent prescription → query DailyMed with PHI-stripped query → synthesise calibrated answer with 2+ differential considerations) with the reasoning trace visible inline in the beacon, all gated through the existing safety surfaces (Research consent, PHI guard, per-call audit, adjudicator). Recommendation-shaped questions never produce a synthesis.

## 13. Open questions (deferred)

- **Card pinning.** Should the clinician be able to pin a card so it stays visible across visits even after the underlying entity transitions? Probably yes for action items they want to keep on the radar, but defer until dismissal data tells us how clinicians actually use the surface.
- **Cross-card priority.** When ≥2 card kinds have data for the same patient (e.g. open follow-ups AND last A1c), what's the display order? Default kind-priority list in `cards/index.ts`; revisit when we have ≥3 kinds shipping.
- **Per-org Watch enable/disable.** Should orgs be able to opt out of Watch mode entirely while keeping Ask mode? Probably yes — feature flag — but defer.
- **Tool-call cost guardrails.** Per-clinician daily token budget for the Ask agent? Per-org? Per-encounter? Defer until we have usage data.
- **Conversation-history search.** Once Phase 55 lands, can clinicians search past Co-Pilot conversations? UX + retention policy questions. Defer.
- **Voice trigger.** Could the Watch mode listen for an explicit voice cue ("Hey Co-Pilot, …")? Probably yes but adds another trigger path; defer until v3.

## 14. Anti-patterns to avoid

- Do **not** let a card's text speak as a clinical recommendation (rule 23). Surface DATA, not advice.
- Do **not** read from drafts (rule 20). Resolvers only read from SIGNED / TRANSFERRED notes, attested FollowUp rows, and verified-link FHIR cache rows.
- Do **not** include PHI in audit metadata (rule 14 / 21). IDs, kinds, counts, latencies — that's the metadata schema.
- Do **not** render card text through `dangerouslySetInnerHTML` or any markdown processor. Plain string only.
- Do **not** auto-dismiss cards based on heuristics. Only an explicit clinician dismiss-tap creates a `CopilotCardDismissal` row.
- Do **not** spin up a new BullMQ worker fleet for the Co-Pilot (rule 18). The agent loop runs in the request handler; the trigger pipeline runs in the browser (or server-side later, on the existing fleet).
- Do **not** call the LLM in the Watch trigger path before the keyword gate fires. The two-stage gate is what makes the cost + latency budget feasible.
- Do **not** make a tool that mutates a signed note's `finalJson` (rule 3).
- Do **not** add a card kind without also adding a doc note declaring why it doesn't cross into recommendation territory (rule 23 enforcement).
- Do **not** widen the Ask-mode v0 to multi-turn or streaming — that's Phase 54.
- Do **not** widen the Watch-mode v0 to transcript-listening — that's Phase 53.

## 15. Success metrics

Capability metrics, not activity metrics, per AGENT framework:

- **% of returning visits where the clinician opens the prior note manually before the visit** (target: ≥70% reduction once Phase 51 ships)
- **Card relevance rate**: dismissed-without-tap-through / total-shown. Target: ≤30% — anything higher means the trigger is too noisy.
- **Card tap-through rate**: tapped / total-shown. Target: ≥40% within 30 days of any new card kind shipping.
- **Time from "patient mention triggers context" to "card surfaces"** (Phase 53+): p95 ≤2.5s end-to-end
- **Ask-mode grounded-answer rate** (Phase 54+): % of answers where verdict = SUPPORTED with at least one citation. Target: ≥80%.
- **Action-tool acceptance rate** (Phase 55+): % of proposed actions the clinician accepts. Diagnostic of trust + relevance.

Reject as success metrics: "cards shown per visit," "Ask questions per day," "tools called per encounter." Those are activity, not capability.

## 16. What this unlocks downstream

Once the Encounter Copilot is real (post-Phase 55):

1. **The chatbox becomes the primary entry point** for new AI capabilities — new tools, not new screens.
2. **The visit-time medical assistant from `fhir-integration-spec.md` §16 ships** — the founder's original 30-second-card pitch.
3. **The FHIR work pays off in a clinician-facing way** — F3.2's cached resources become tools the agent calls during real visits, not data sitting in a JSONB column waiting for F4 brief integration.
4. **Capability evaluation becomes systematic** — every tool emits structured audit data, so we can measure which tools clinicians actually use and which are dead weight.
5. **A path to action tools opens** — once the read-only Co-Pilot has earned trust, Phase 55+ introduces guarded write tools (draft message, enqueue sync, propose follow-up). That's the path to "the Co-Pilot does things, not just answers."

The chatbox already exists. Everything in this spec is about giving it substance.
