# Brief Chain — state of play (2026-05-23)

**Purpose:** Snapshot of what's wired vs. missing in the prior-context brief pipeline, written as input to the visit-type-aware brief surface spec. Pairs with [`visit-type-taxonomy.md`](visit-type-taxonomy.md) and is the gap analysis that backs that spec.

**Audit scope:** sign → enqueue → worker → BriefGenerator → NoteBrief → render. Did NOT audit: case-router agent (separate Cleo agent), copilot Watch v1 cards (consume brief data downstream).

---

## A. What ships today (Unit 06 + extensions through Unit 25)

### A.1 The full chain works end-to-end

```
clinician taps Sign
        │
        ▼
POST /api/notes/[id]/sign  ─── src/app/api/notes/[id]/sign/route.ts
  ├─ refuses 409 open_followups_present if any FollowUp.status=OPEN
  │  for THIS patient (excluding rows originated by this note)
  ├─ transaction: Note.status=SIGNED, finalJson frozen, signedAt set
  ├─ enqueueNoteBriefJob({ noteId, orgId })       ◄── post-commit
  ├─ enqueuePostSignArtifactJob (patient instructions)
  ├─ enqueuePostSignArtifactJob (referral letter, if "refer" in plan)
  ├─ enqueueCleoStateRefresh (signer + peer clinicians)
  └─ episodeOfCare.visitsCompleted += 1 (if episode-linked)
        │
        ▼
note-brief worker  ─── src/workers/note-brief/handler.ts
  ├─ loads note + up to 2 prior signed notes (same patient, prefer same episode)
  ├─ loads externalEhrContext (Unit 22 / FHIR)   ◄── try/catch, optional
  ├─ loads externalContexts (paste-in / outside records)
  ├─ runs BriefGenerator (Sonnet → Haiku fallback)
  ├─ runs FollowupExtractor (Haiku) on the plan section, IDEMPOTENT
  ├─ creates FollowUp rows with status=OPEN
  ├─ snapshots ALL currently-open follow-ups for the patient
  ├─ hydrates ehrEnrichment with fetchedAt per row (Unit 23 / F5)
  ├─ upserts NoteBrief.content with the full PriorContextBriefContent
  └─ writes BRIEF_GENERATED audit with personaVersion='miss-cleo-v1'
        │
        ▼
NoteBrief row exists  (1:1 with signed Note; indexed by patientId + episodeId)
```

### A.2 Where the brief renders

| Surface | File | Status |
|---|---|---|
| `/prepare/[noteId]` | [`src/app/(clinical)/prepare/[noteId]/page.tsx`](../src/app/(clinical)/prepare/[noteId]/page.tsx) | ✅ Renders `<BriefCard>` above recording CTA; fallback `<EmptyBrief>` with `first-visit` vs `unavailable` variants |
| `/capture/[noteId]` | [`src/app/(clinical)/capture/[noteId]/_components/PriorContextPanel.tsx`](../src/app/(clinical)/capture/[noteId]/_components/PriorContextPanel.tsx) | ✅ Wraps `<BriefCard>` with `followUpsSlot` for interactive Met/Drop/Carry chips |
| Sign-time sweep | [`src/components/sign/sign-followup-sweep-dialog.tsx`](../src/components/sign/sign-followup-sweep-dialog.tsx) (assumed; sign route returns 409 with open list) | ✅ Sign route refuses until `sweepAcknowledged=true` and writes `FOLLOWUP_SWEEP_OPENED` + `FOLLOWUP_SWEEP_RESOLVED` audits |
| `/telehealth/room/[scheduleId]` | room-shell.tsx | ✅ Renders brief during the call |
| Copilot Watch v0 cards | `<OpenFollowUpsCard>`, `<PlanForTodayCard>` | ✅ Read from brief content on /prepare |
| Copilot Watch v1 cards | `<FhirWatchCards>` | ✅ Read from `externalEhrContext` independently (does not depend on brief — same FHIR projection) |
| Proactive nudges | `<PrepareNudgeBlock>` (Sprint 0.18) | ✅ Loads eligible nudges by surface=`VISIT_PREPARE` |
| Patient chart | `src/lib/snapshots/build-snapshot-strip.ts` | ✅ Consumes brief for the snapshot strip (separate hydration; brief is one input among many) |

### A.3 Components built (all in `src/components/brief/`)

`brief-card.tsx`, `brief-header.tsx`, `brief-section.tsx`, `brief-footer.tsx`, `trajectory-table.tsx`, `goals-snapshot.tsx`, `watch-list.tsx`, `follow-up-preview-list.tsx`, `ehr-enrichment-block.tsx`, `ehr-source-pill.tsx`, `source-pill.tsx`, `provenance-drawer.tsx`, `empty-brief.tsx`.

### A.4 APIs that exist

- `GET /api/patients/[id]/brief` — most-recent NoteBrief for patient (and episode if specified)
- `GET /api/notes/[id]/brief` — brief computed from this specific note
- `GET /api/patients/[id]/follow-ups` — follow-ups list for sweep
- `PATCH /api/follow-ups/[id]` — status change endpoint (Met / Drop / Carry)

### A.5 Schema in place

```
NoteBrief: 1:1 with signed Note via noteId; @@index(patientId, episodeId)
FollowUp:  lifecycle (OPEN / MET / CARRIED / DROPPED / CLOSED_BY_DISCHARGE)
            with originNoteId + closingNoteId + closedAt
```

### A.6 Anti-regression posture (validated by audit)

- **Rule 20** (brief reads only SIGNED/TRANSFERRED): worker's `where.status: { in: [SIGNED, TRANSFERRED] }` enforces it; grep-checked.
- **Rule 3** (finalJson immutable): brief lives in sibling `NoteBrief.content`, not on Note.
- **Rule 6** (LLM through abstraction): `BriefGenerator` calls `getLLMService()`.
- **Rule 8** (audit writes not swallowed): worker `writeAuditLog` calls are not wrapped in try-catch that suppresses errors.
- **Rule 10** (BullMQ 3 retries exp backoff): inherited from queue defaults.

---

## B. The genuine gap (what's missing for the user's stated vision)

The user's question — *"when it's progress notes time, what will Miss Cleo do to prepare me?"* — exposes a real gap:

**The brief is comprehensive about *what happened* but blind to *what's about to happen.*** It doesn't know whether the clinician is about to record an Initial Eval, a Daily Note, a Progress Note, a Re-evaluation, or a Discharge. So Cleo can't:

- Foreground the goal ledger when it's Progress Note time
- Foreground the risk trend when it's a BH session
- Foreground the discharge summary scaffold when goals are met
- Suggest "Re-administer LEFS today" or "Repeat goniometry on R knee" based on what THIS visit needs
- Surface medical-necessity talking points for the audit-critical Progress Note

### B.1 Net-new domain modeling

| Item | Status | Notes |
|---|---|---|
| `Encounter.intent` enum field | ❌ Missing | Proposed enum in [`visit-type-taxonomy.md` §6](visit-type-taxonomy.md#6-the-encounterintent-enum-proposed) — 5 REHAB + 7 BH + 7 MEDICAL + UNSPECIFIED variants |
| `Encounter.intentSource` field | ❌ Missing | Tracks whether intent came from clinician, Cleo proposal, or schedule |
| `Schedule.visitType` collision | None | Existing enum is modality (IN_PERSON / TELEHEALTH) — different concern; no rename needed |

### B.2 Cleo's proposal logic

| Item | Status | Notes |
|---|---|---|
| `src/services/copilot/intent-proposer.ts` | ❌ Missing | Sibling to `case-router.ts`; deterministic calculator from episode state + schedule context + prior notes |
| `GET /api/patients/[id]/proposed-intent` | ❌ Missing | Returns `{ intent, division, reason }` for the chip subtitle |
| 60s in-memory cache | ❌ Missing | Optional; episode state changes rarely |

### B.3 UI surface — intent chip in start-visit flow

| Item | Status | Notes |
|---|---|---|
| Intent chip in `StartVisitDialog` | ❌ Missing | Renders Cleo's proposal at the top of the sheet; clinician confirms or overrides via dropdown |
| Intent capture in `POST /api/encounters` | ❌ Missing | Body accepts `intent` + `intentSource`; default UNSPECIFIED + CLINICIAN |
| Override → flat division-filtered intent list | ❌ Missing | Dropdown lists only intents valid for the clinician's `viewerDivision` |

### B.4 Intent-aware brief shape

| Item | Status | Notes |
|---|---|---|
| `BriefGenerator` takes `intent` parameter | ❌ Missing | Worker passes `note.encounter?.intent`; prompt builder branches per `(division, intent)` |
| Prompt branching by intent | ❌ Missing | System prompt swaps the "spine" section (the audit-critical content for this visit type) |
| Schema additions for intent-specific fields | ⚠️ Partial | `topActiveGoals.max(3)` is too thin for a Progress Note — needs full-ledger variant. `medicalNecessityTalkingPoints`, `suggestedDataToCapture` fields don't exist |
| Renderer branching by intent | ❌ Missing | `<BriefCard>` renders the same sections regardless of visit purpose. Needs intent-aware section order + intent-specific section components (e.g. `<GoalLedger>`, `<MedicalNecessityScaffold>`, `<SuggestedDataChecklist>`) |

### B.5 Division-aware spine (cross-discipline)

| Item | Status | Notes |
|---|---|---|
| BH-flavored spine | ❌ Missing | Brief schema is REHAB-flavored (objectiveMeasures, episodeContext.visitNumber/plannedVisits). BH needs PHQ-9/GAD-7/C-SSRS trend, session-theme history, homework status. Probably new schema fields gated by `division === BEHAVIORAL_HEALTH` |
| MEDICAL-flavored spine | ❌ Missing | Needs active problem list (per problem status), med reconciliation flags, care gaps. Currently absent |
| Few-shot examples per division in prompt | ⚠️ Partial | Prompt builder takes division; examples per division need verification (see `build-brief-prompt.ts`) |

### B.6 Downstream consumers that would benefit but don't yet

| Item | Status | Notes |
|---|---|---|
| Note generator template default by intent | ❌ Missing | Template selection is by clinician/org default; could default from `(division, intent)` mapping |
| Compliance flags by intent | ❌ Missing | Progress Note without all-goal-coverage should be a P0 flag (MAC-audit critical); not currently enforced |
| Sign-time sweep widening for Progress Note intent | ❌ Missing | Progress Notes should also gate on each LTG/STG having an updated status, not just open follow-ups |
| Post-sign artifacts for `DISCHARGE_*` intents | ❌ Missing | A discharge intent should trigger an AVS-with-HEP artifact, not just patient instructions |

---

## C. The narrow scope that delivers the user's headline value

Of the gaps in §B, the **minimum viable unit** that turns "Cleo briefs me about what happened" into "Cleo briefs me for the visit I'm about to record" is:

1. `Encounter.intent` + `intentSource` schema (§B.1)
2. Intent proposer service + endpoint (§B.2)
3. Intent chip in `StartVisitDialog` + capture in `POST /api/encounters` (§B.3)
4. `BriefGenerator` takes intent; prompt branches per `(division, intent)` (§B.4 first three rows)
5. `<BriefCard>` renders an intent-aware spine for the four most-important `(division, intent)` pairs: `REHAB_PROGRESS_NOTE`, `REHAB_REEVAL`, `BH_TREATMENT_PLAN_REVIEW`, `MEDICAL_ANNUAL_WELLNESS` (§B.4 last row)

Deferred to follow-on units:
- New schema fields for full goal ledger / medical necessity / suggested data (those are richer brief content, which we can add once the intent layer is in place and we know what data each `(division, intent)` actually needs at render time)
- Note template defaulting by intent
- Compliance flags by intent
- Sign-time sweep widening
- BH and MEDICAL spines beyond the four pairs above

This puts the unit in the **complete-Unit-06-clinical-depth** category — not a Wave 8 (Miss Cleo persona) item. The polish gate ahead of Wave 7/8 does not apply.

---

## D. References for the spec author

- Unit 06 spec: [`context/specs/06-prior-context-brief.md`](../context/specs/06-prior-context-brief.md)
- Brief spec: [`prior-context-brief-spec.md`](prior-context-brief-spec.md)
- Brief UI spec: [`prior-context-brief-ui-spec.md`](prior-context-brief-ui-spec.md)
- Brief prompt spec: [`prior-context-brief-prompt.md`](prior-context-brief-prompt.md)
- Visit-type taxonomy (sibling of this doc): [`visit-type-taxonomy.md`](visit-type-taxonomy.md)
- Encounter model: `prisma/schema.prisma:1169-1193`
- Worker: `src/workers/note-brief/handler.ts`
- Generator: `src/services/brief/BriefGenerator.ts`
- Prompt builder: `src/lib/notes/build-brief-prompt.ts`
- Schema: `src/types/brief.ts`
- Sign route: `src/app/api/notes/[id]/sign/route.ts`
- StartVisitDialog: `src/app/(clinical)/patients/[id]/_components/start-visit-dialog.tsx`
- /prepare page: `src/app/(clinical)/prepare/[noteId]/page.tsx`
