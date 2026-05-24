# Visit-Type Taxonomy — clinical intent across divisions

**Status:** Draft for spec
**Companion to:** [`prior-context-brief-spec.md`](prior-context-brief-spec.md), [`prior-context-brief-ui-spec.md`](prior-context-brief-ui-spec.md), [`encounter-copilot-spec.md`](encounter-copilot-spec.md)
**Last updated:** 2026-05-23

---

## 1. Why this exists

`Schedule.visitType` in the schema is **modality** (`IN_PERSON` vs `TELEHEALTH`) — not clinical intent. There is currently no model field that answers "what *kind* of visit is this clinically?" — i.e. is the clinician about to record an Initial Eval, a Daily Note, a Progress Note, a Re-evaluation, or a Discharge?

Without that intent, the copilot can't do its real job:

- The pre-visit brief shipped in Unit 06 is **retrospective** ("here's what last visit looked like"). Cleo can't shape what she foregrounds without knowing the visit's clinical purpose.
- The note generator picks templates by clinician selection, not by clinical intent — so a clinician recording a Progress Note can accidentally produce a Daily-Note-shaped artifact.
- Compliance flagging can't enforce intent-specific requirements (a Progress Note that doesn't address each goal is a MAC-audit failure).
- The "what should I capture today" suggestion list (Section 8 of the brief spec, currently unbuilt) cannot exist until we know the intent.

This taxonomy is the input to (a) Cleo's brief-shape choice, (b) Cleo's suggested-data-to-capture list, (c) the note generator's template selection, (d) compliance flagging. It is *not* a billing field — CPT mapping is downstream.

## 2. The cross-division envelope

All three divisions share the same five-archetype shape. Each division names them differently and applies different cadence rules.

| Archetype | Purpose | REHAB | BEHAVIORAL_HEALTH | MEDICAL |
|---|---|---|---|---|
| **Initiation** | First clinical encounter; establishes baseline + plan of care | Initial Evaluation | Initial Assessment / Diagnostic Eval | New Patient Visit |
| **Routine touch** | Recurring contact executing the established plan | Daily Note (Treatment Note) | Psychotherapy Session | Follow-up / Established |
| **Periodic checkpoint** | Scheduled review of progress against the plan | Progress Note | Treatment Plan Review (90-day) | Chronic Care Mgmt touch / AWV |
| **Significant change** | Status changed enough to warrant re-baselining | Re-evaluation | Crisis / Risk Re-assessment | Acute Visit (interval problem) |
| **Termination** | Final touch; outcomes summary + handoff | Discharge Summary | Termination / Discharge | Hospital Discharge TCM |

The taxonomy enumerates these five plus any division-specific variants. The envelope shape is what lets one `BriefGenerator` + one `<BriefCard>` serve all three with division-aware sections.

---

## 3. REHAB (PT / OT / SLP)

Medicare Part B outpatient therapy under §1834(k), §1862(a)(1)(A), and CMS Pub. 100-02 Ch. 15 §220. The clinician must demonstrate skilled care + medical necessity at every touch; the Progress Note is the audit-critical artifact.

### 3.1 Intent variants

#### `REHAB_INITIAL_EVAL`
- **Trigger:** First encounter under a referral or self-referral; case has zero prior signed notes of any kind
- **What it must contain:** History, systems review, tests & measures, evaluation, diagnosis (ICD + treatment dx), prognosis, **Plan of Care with measurable LTGs + STGs**, frequency/duration, anticipated discharge criteria
- **CMS rule:** POC must be certified by the referring physician within 30 days
- **Brief spine for this intent:** *no prior context exists* — brief is empty or shows referral packet + intake forms + insurance authorization status

#### `REHAB_DAILY_NOTE` *(a.k.a. Treatment Note)*
- **Trigger:** Routine treatment visit between progress reports
- **What it must contain:** Date, time in/out, treatment provided (CPT-codable interventions), patient response, signature/credentials
- **CMS rule:** Required for *every* billed encounter
- **Brief spine for this intent:** light recap — last visit interventions + patient response + open follow-ups + HEP status. **No goal ledger** (that lives in the Progress Note).

#### `REHAB_PROGRESS_NOTE` *(a.k.a. Progress Report)*
- **Trigger:** **Every 10 treatment days OR every 30 calendar days, whichever comes first** (CMS Pub. 100-02 Ch. 15 §220.3). Cleo proposes this when either threshold is hit.
- **What it must contain:** Assessment of improvement against each functional goal, justification for continued POC, revisions to goals/POC if warranted, plans for continuing treatment, signature of qualified clinician (PT/OT/SLP — not assistant)
- **CMS rule:** Cannot be authored by a PTA/COTA/SLPA; supervising clinician must sign
- **Brief spine for this intent:** **full goal ledger + objective trend strip + medical-necessity talking points + carryover (full) + suggested data to capture**. This is the spine the user's question was really about.

#### `REHAB_REEVAL`
- **Trigger:** Significant change in patient status not predicted in the POC (clinically meaningful improvement, regression, new condition, new dx). Distinct from the periodic Progress Note.
- **What it must contain:** Updated tests & measures, revised evaluation, **updated POC with revised goals**, justification for re-evaluation (separate billable code 97164/97168 etc.)
- **CMS rule:** Re-eval is billable only when status change is documented + new POC results
- **Brief spine for this intent:** full re-test of objective measures + status of every goal + revision opportunities + side-by-side old POC vs. proposed new POC

#### `REHAB_DISCHARGE`
- **Trigger:** Goals met, plateau reached, patient transferred, voluntary discharge, no-show pattern
- **What it must contain:** Summary of LTG attainment, discharge status of each STG, final functional outcomes, discharge HEP, recommendations for maintenance, reason for discharge
- **CMS rule:** Required at episode close; can be folded into the final Progress Note
- **Brief spine for this intent:** LTG attainment summary, full HEP for discharge, maintenance recommendations, reason picker

### 3.2 Cadence calculator (deterministic)

For Cleo's proposal on REHAB:

```
let intent = REHAB_DAILY_NOTE  // default

if (priorSignedNotes.length === 0) {
  intent = REHAB_INITIAL_EVAL
} else if (episode.status === 'DISCHARGED' || dischargeReadinessSignals(episode)) {
  intent = REHAB_DISCHARGE
} else if (clinicianRequestedReeval || significantChangeSignal(episode)) {
  intent = REHAB_REEVAL
} else {
  const visitsSinceLastProgress = countVisitsSinceLastProgressNote(episode)
  const daysSinceLastProgress = daysSinceLastProgressNote(episode)
  if (visitsSinceLastProgress >= 10 || daysSinceLastProgress >= 30) {
    intent = REHAB_PROGRESS_NOTE
  }
}
```

`dischargeReadinessSignals(episode)`: all LTGs at MET status, OR goals plateaued for ≥ 2 progress notes, OR clinician noted "discharge planning" in last assessment.

`significantChangeSignal(episode)`: copilot detection — pain trend jumps > 3 points, functional outcome regresses > 1 MCID, or new diagnosis flagged. *(Detection is a follow-on; the intent enum supports the value from day one.)*

---

## 4. BEHAVIORAL_HEALTH

CPT 90791/90792 for intake, 9083x series for therapy. State licensing + HIPAA + 42 CFR Part 2 sensitivity rules apply. Risk assessment is the audit-critical artifact.

### 4.1 Intent variants

#### `BH_INITIAL_ASSESSMENT`
- **Trigger:** First encounter under a referral or self-referral; case has zero prior signed notes
- **What it must contain:** Presenting problem, history (psychiatric, medical, substance use, trauma, family), mental status exam, **risk assessment (suicide/homicide/self-harm)**, diagnosis (DSM-5 + ICD), **initial treatment plan with measurable behavioral goals**, frequency, modality
- **Brief spine for this intent:** referral context + intake screening packet + risk-tool results if pre-administered + any prior records released

#### `BH_SESSION_INDIVIDUAL` *(90832 / 90834 / 90837)*
- **Trigger:** Routine individual therapy session; default for established patients on regular cadence
- **What it must contain:** Session length (drives CPT), themes addressed, interventions used, patient response, **risk re-screen (PHQ-9 / GAD-7 if due)**, homework assignment, plan for next session
- **Brief spine for this intent:** last session themes (last 1-3) + risk trend (PHQ-9/GAD-7/C-SSRS sparkline) + active treatment goals + **homework from last session** + open carryover

#### `BH_SESSION_FAMILY` *(90847)*
- **Trigger:** Session includes family members per treatment plan
- **Brief spine:** as above + participants list + last family-session dynamics

#### `BH_SESSION_GROUP` *(90853)*
- **Trigger:** Group therapy session
- **Brief spine:** group themes + this patient's contribution + individual goal status

#### `BH_TREATMENT_PLAN_REVIEW`
- **Trigger:** Required by most payers every 90 days; Cleo proposes when threshold hit
- **What it must contain:** Progress against each goal, revisions, justification for continuing treatment, patient agreement to revised plan
- **Brief spine for this intent:** **full goal ledger + risk trend + outcome screener trend + side-by-side current plan vs. proposed revisions**. Same shape role as REHAB Progress Note.

#### `BH_CRISIS_REASSESSMENT`
- **Trigger:** Risk signal escalation (positive C-SSRS, suicidal ideation surface, recent ED visit, hospitalization, substance relapse)
- **What it must contain:** Full re-administration of risk tools, safety plan update, level-of-care decision, contacts notified
- **Brief spine for this intent:** **full risk history** + last safety plan + emergency contacts + provider's prior risk decisions + collateral contact list

#### `BH_DISCHARGE`
- **Trigger:** Goals met, mutual agreement, transfer, drop-out
- **What it must contain:** Summary of progress, residual symptoms, discharge diagnosis, aftercare recommendations, **final risk assessment**, reason
- **Brief spine for this intent:** treatment outcomes summary + final risk status + aftercare plan template

### 4.2 Cadence calculator

```
let intent = BH_SESSION_INDIVIDUAL  // default

if (priorSignedNotes.length === 0) {
  intent = BH_INITIAL_ASSESSMENT
} else if (recentRiskEscalation(patient)) {
  intent = BH_CRISIS_REASSESSMENT
} else if (clinicianRequestedDischarge || dischargeReadiness(patient)) {
  intent = BH_DISCHARGE
} else if (daysSinceLastTreatmentPlanReview(patient) >= 90) {
  intent = BH_TREATMENT_PLAN_REVIEW
} else if (scheduledAsFamilySession) {
  intent = BH_SESSION_FAMILY
} else if (scheduledAsGroupSession) {
  intent = BH_SESSION_GROUP
}
```

---

## 5. MEDICAL

E/M coding 99202–99215, AWV codes G0438/G0439, TCM 99495/99496. Documentation must support level of MDM (medical decision making) under 2021 E/M guidelines.

### 5.1 Intent variants

#### `MEDICAL_NEW_PATIENT` *(99202–99205)*
- **Trigger:** Patient has not been seen by *any* clinician in the same group/specialty within 3 years
- **What it must contain:** Full HPI, ROS, PFSH, exam, A/P with MDM justification for level chosen
- **Brief spine for this intent:** referral context + intake forms + pre-visit screening results

#### `MEDICAL_FOLLOW_UP` *(99212–99215)*
- **Trigger:** Default for established patients on routine cadence
- **What it must contain:** Interval history, focused exam, A/P, plan continuation/revision, MDM
- **Brief spine for this intent:** last visit + **active problem list with last status per problem** + **medication reconciliation flags** + open orders pending results + recent labs/imaging since last visit

#### `MEDICAL_ANNUAL_WELLNESS` *(G0438 initial / G0439 subsequent)*
- **Trigger:** Annual cadence; Cleo proposes when 11+ months since last AWV
- **What it must contain:** HRA, list of providers, medical/family history update, cognitive screen, depression screen, functional ability screen, vitals, BMI, **personalized prevention plan**
- **Brief spine for this intent:** **care gaps + screening due list + immunizations due + prior AWV plan items**

#### `MEDICAL_CHRONIC_CARE`
- **Trigger:** Patient enrolled in CCM program; monthly touchpoint
- **What it must contain:** Chronic-condition management actions, care coordination, medication management, patient self-management support
- **Brief spine for this intent:** chronic conditions list + last 30 days of care-team activity + medication changes + outstanding patient tasks

#### `MEDICAL_ACUTE_VISIT`
- **Trigger:** Same-day urgent visit for new or worsening complaint
- **What it must contain:** Focused HPI on the acute complaint, focused exam, A/P, follow-up plan
- **Brief spine for this intent:** allergies + active meds + relevant chronic problems only (focused; not full problem list)

#### `MEDICAL_DISCHARGE_TCM` *(99495 / 99496)*
- **Trigger:** First post-discharge contact within 7 or 14 days of hospital discharge
- **What it must contain:** Medication reconciliation, discharge summary review, follow-up plan, patient/caregiver communication documented
- **Brief spine for this intent:** **hospital discharge summary + admission med list + discharge med list (diff) + scheduled follow-ups**

#### `MEDICAL_TELEHEALTH_CHECKIN`
- **Trigger:** Modality is telehealth + intent is a brief check-in (not a full follow-up)
- **Brief spine for this intent:** focused — what's the specific complaint or task

### 5.2 Cadence calculator

```
let intent = MEDICAL_FOLLOW_UP  // default

if (priorSignedNotes.length === 0 || !seenInGroupWithin3Years(patient)) {
  intent = MEDICAL_NEW_PATIENT
} else if (recentHospitalDischarge(patient, within=14days)) {
  intent = MEDICAL_DISCHARGE_TCM
} else if (monthsSinceLastAWV(patient) >= 11 && patientIsMedicareEligible(patient)) {
  intent = MEDICAL_ANNUAL_WELLNESS
} else if (scheduledAsAcute || schedule.notes.includes('same-day')) {
  intent = MEDICAL_ACUTE_VISIT
} else if (patientEnrolledInCCM(patient)) {
  intent = MEDICAL_CHRONIC_CARE
}
```

---

## 6. The `EncounterIntent` enum (proposed)

```prisma
enum EncounterIntent {
  UNSPECIFIED

  // REHAB
  REHAB_INITIAL_EVAL
  REHAB_DAILY_NOTE
  REHAB_PROGRESS_NOTE
  REHAB_REEVAL
  REHAB_DISCHARGE

  // BEHAVIORAL_HEALTH
  BH_INITIAL_ASSESSMENT
  BH_SESSION_INDIVIDUAL
  BH_SESSION_FAMILY
  BH_SESSION_GROUP
  BH_TREATMENT_PLAN_REVIEW
  BH_CRISIS_REASSESSMENT
  BH_DISCHARGE

  // MEDICAL
  MEDICAL_NEW_PATIENT
  MEDICAL_FOLLOW_UP
  MEDICAL_ANNUAL_WELLNESS
  MEDICAL_CHRONIC_CARE
  MEDICAL_ACUTE_VISIT
  MEDICAL_DISCHARGE_TCM
  MEDICAL_TELEHEALTH_CHECKIN
}
```

Field placement:

```prisma
model Encounter {
  // ... existing fields ...

  /// Clinical intent of THIS encounter (distinct from Schedule.visitType
  /// which is modality only). Cleo proposes at start; clinician confirms or
  /// overrides; the value is recorded at create time and shapes the brief
  /// spine, the suggested-data list, and the note template default.
  intent             EncounterIntent  @default(UNSPECIFIED)
  intentSource       IntentSource     @default(CLINICIAN)
}

enum IntentSource {
  /// Clinician picked or confirmed at start time
  CLINICIAN
  /// Cleo proposed and clinician took the default without override
  COPILOT_PROPOSAL_CONFIRMED
  /// Inherited from schedule.notes or schedule template (future)
  SCHEDULE
}
```

Append-only enum per anti-regression rule 2 (NoteStatus precedent). New variants go at the bottom; nothing renamed or removed.

---

## 7. How intent shapes the brief spine

The brief generator already takes `division`. It needs to also take `intent` and branch on the combination. Below is the canonical spine per `(division, intent)` pair.

| Division | Intent | Spine sections (priority order) |
|---|---|---|
| REHAB | `INITIAL_EVAL` | *no prior context* → referral packet, intake forms, allergy/precaution badges, insurance auth status |
| REHAB | `DAILY_NOTE` | last visit recap (interventions + response), open follow-ups, HEP status, light goal status |
| REHAB | `PROGRESS_NOTE` | **goal ledger (all LTGs + all STGs)**, objective trend strip, carryover plan (full), medical-necessity talking points, suggested data to capture, last visit recap, watch |
| REHAB | `REEVAL` | full goal ledger, full objective measure history, revision-opportunity flags, side-by-side current vs. proposed POC scaffold |
| REHAB | `DISCHARGE` | LTG attainment summary, STG final status, outcomes vs. baseline, HEP-for-discharge scaffold, reason picker |
| BH | `INITIAL_ASSESSMENT` | referral context, intake screening, pre-administered risk tools, prior records released |
| BH | `SESSION_*` | last 1-3 session themes, **risk trend (PHQ-9/GAD-7/C-SSRS)**, active treatment goals, homework status, carryover |
| BH | `TREATMENT_PLAN_REVIEW` | **full goal ledger**, risk trend, outcome screener trend, current plan vs. proposed revisions scaffold |
| BH | `CRISIS_REASSESSMENT` | **full risk history**, last safety plan, emergency contacts, collateral list, level-of-care options |
| BH | `DISCHARGE` | treatment outcomes summary, final risk status, aftercare plan scaffold |
| MEDICAL | `NEW_PATIENT` | referral context, intake forms, pre-visit screening |
| MEDICAL | `FOLLOW_UP` | last visit, **active problem list with status per problem**, med reconciliation flags, open orders / pending results, recent labs/imaging |
| MEDICAL | `ANNUAL_WELLNESS` | **care gaps**, screenings due, immunizations due, prior AWV plan items |
| MEDICAL | `CHRONIC_CARE` | chronic conditions, last 30d care-team activity, med changes, outstanding patient tasks |
| MEDICAL | `ACUTE_VISIT` | focused: allergies, active meds, relevant chronic problems |
| MEDICAL | `DISCHARGE_TCM` | **hospital discharge summary**, admission med list, discharge med list (diff), scheduled follow-ups |
| MEDICAL | `TELEHEALTH_CHECKIN` | focused on specific complaint/task |
| any | `UNSPECIFIED` | default to "last visit + open follow-ups + active goals" (Unit 06 shipped shape) |

Sections marked **bold** are the audit-critical content for that intent — if Cleo can't surface them, the brief has failed for that visit.

---

## 8. Cleo's proposal flow

1. Clinician taps a patient (on schedule, on chart, on home, etc.)
2. **Before** `StartVisitDialog` opens, the client requests `GET /api/patients/[id]/proposed-intent?episodeId=&caseId=`
3. Server computes intent via the deterministic calculator for the patient's `viewerDivision`, using episode state + schedule context + prior notes
4. Server returns `{ intent, division, reason }` where `reason` is the human-readable cue for the chip subtitle (*"visit 10 of 30, last progress note was at the eval"*)
5. Dialog renders intent as a chip at the top: **"Progress Note — change ▾"** with the reason as small text below
6. Clinician confirms → submit captures `intent` + `intentSource = COPILOT_PROPOSAL_CONFIRMED`
7. Clinician overrides → submit captures the new `intent` + `intentSource = CLINICIAN`
8. Encounter is created with the intent recorded; downstream consumers (brief regen, note generator template default, compliance flags) read `Encounter.intent`

If the intent endpoint fails or times out, the dialog falls back to `UNSPECIFIED` and lets the clinician pick from a flat division-filtered list. Cleo doesn't block visit start on her own latency.

---

## 9. Downstream implications

| System | Today | After this taxonomy lands |
|---|---|---|
| Brief generator | Takes `division`; produces same spine shape regardless of visit purpose | Takes `(division, intent)`; spine is the table in §7 |
| Note generator template default | Picked by clinician / org default | Defaults from `(division, intent)` mapping; clinician can still override the template |
| Compliance flags | Generic per division | Intent-specific (Progress Note without all-goal-coverage flags as P0) |
| Post-sign artifacts | Patient instructions + referral letter | Adds `DISCHARGE_*` intents → AVS-with-HEP generation, `TCM` → discharge med rec |
| Sign-time sweep | Generic open-follow-ups gate | Intent-aware: Progress Note also gates on each goal having an updated status |
| Audit | `BRIEF_GENERATED`, etc. | Adds `intent` + `intentSource` to relevant audit metadata (PHI-free) |

---

## 10. Non-goals

- **Not a CPT field.** Intent loosely informs CPT but isn't itself billable; the CPT layer is downstream.
- **Not enforced at API.** The server records intent; it does not refuse to create an encounter if the intent looks wrong for the episode state. Cleo proposes; the clinician decides.
- **No automatic intent reclassification.** Once recorded at encounter create, intent is the clinician's stated purpose for the visit. If they realize mid-visit they need to do a Re-eval instead, that's a clinician-driven edit (handled in a later unit, not v1).
- **No multi-discipline mixed intents.** A REHAB clinician's encounter is REHAB-intent; co-treatment scenarios are out of scope for the enum.
- **No payer-specific variants.** Medicare cadence rules are the canonical defaults; commercial-payer variations are out of scope for v1.

## 11. Open questions

- **Who owns the `proposed-intent` endpoint shape?** Probably `src/services/copilot/intent-proposer.ts` next to `case-router.ts`. Decision deferred to the unit spec.
- **Should Cleo's proposal be cached?** Episode state changes rarely; a 60s cache per (patient, episode, clinician) is probably enough. Decision deferred to the unit spec.
- **Should intent show on the patient chart?** A "last visit intent" badge on each visit row would help the clinician scan history (and would help Cleo's cadence math by surfacing it). Defer to the chart polish work.
- **Should Re-eval require a justification field?** CMS billing requires it for the re-eval CPT code. The note-generator template already enforces this in the assessment section; we don't double-enforce at intent capture. Deferred.

## 12. Versioning

This taxonomy is version `v1`. New intent variants are *additive* (append to the enum). Renames are *forbidden* (anti-regression rule 2 precedent — `NoteStatus` discipline). If a variant becomes obsolete, mark it deprecated in this doc and stop proposing it; do not remove it from the enum.
