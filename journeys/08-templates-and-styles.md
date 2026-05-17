# Journey 08 — Templates and Note Styles

> An org admin authors a custom template; a clinician picks it for a visit and adjusts their note style preference. The template + style choice flows into AI generation.

## Who

**Maria Ortega** (the org admin / clinician from Journey 07) wants to add a custom template for IOP (Intensive Outpatient Program) intake assessments — a specialized BH workflow her clinic does weekly. **Sam Rivera** (the new clinician from Journey 01) uses the template for their first IOP intake.

## The journey at a glance

Maria opens the templates page, duplicates the closest preset template, customizes the sections, sets visibility, saves. Sam picks it for an IOP patient. The AI generates a note structured exactly to Maria's template. Sam edits, signs.

## The journey, step by step

### Step 1 — Maria opens templates, 9:00 AM

**Screen: `/admin/templates`** — Maria's view (SUPER_ADMIN). Shows:

- **Tabs**: All / Preset / My Org / Personal
- **Filter**: by division (REHAB / MEDICAL / BH / ALL)
- **List of templates**:
  - "Behavioral Health Intake" (preset, CMS-default, ●) — locked, can be duplicated
  - "BH Progress Note" (preset, CMS-default, ●) — locked
  - "BH Discharge Summary" (preset, CMS-default, ●) — locked
  - "BH Intake — Lakeshore Trauma Focus" (org-custom, TEAM visibility, ✓) — Maria created last week
- **Search**: by name

She wants to add an IOP-specific intake.

### Step 2 — Duplicate the closest preset, 9:01 AM

She clicks "Behavioral Health Intake" → **Duplicate as Org Template**.

**Screen: `/admin/templates/[id]/edit`** — Template editor with:

- **Name**: "Behavioral Health Intake (copy)" (she renames to "IOP Intake — Lakeshore")
- **Visibility**: TEAM (visible to all Lakeshore clinicians) | PERSONAL (only her) | PUBLIC (would require platform-owner approval)
- **Division**: BEHAVIORAL_HEALTH
- **Specialty tag** (optional): "IOP" — surfaces when clinician filters
- **Sections editor**: structured JSON editor for section schema (Unit 13 improves this with live preview; for v1 it's a basic JSON editor):

```json
{
  "sections": [
    { "id": "chiefComplaint", "label": "Chief Complaint", "required": true, "format": "narrative" },
    { "id": "presentingProblem", "label": "Presenting Problem", "required": true, "format": "narrative" },
    { "id": "iopReferralSource", "label": "IOP Referral Source", "required": true, "format": "structured", "fields": [
        { "name": "referredBy", "type": "string" },
        { "name": "referralDate", "type": "date" },
        { "name": "referralReason", "type": "narrative" }
    ]},
    { "id": "substanceUseHistory", "label": "Substance Use History", "required": true, "format": "structured", "fields": [
        { "name": "currentUse", "type": "narrative" },
        { "name": "lastUse", "type": "date" },
        { "name": "treatmentHistory", "type": "narrative" }
    ]},
    { "id": "mentalStatusExam", "label": "Mental Status Exam", "required": true, "format": "structured" },
    { "id": "phq9", "label": "PHQ-9 Score", "required": true, "format": "measure", "measure": "phq9" },
    { "id": "gad7", "label": "GAD-7 Score", "required": true, "format": "measure", "measure": "gad7" },
    { "id": "iopReadinessAssessment", "label": "IOP Readiness Assessment", "required": true, "format": "structured", "fields": [
        { "name": "willingness", "type": "scale", "scale": "1-10" },
        { "name": "barriers", "type": "narrative" },
        { "name": "supports", "type": "narrative" }
    ]},
    { "id": "treatmentPlan", "label": "Treatment Plan", "required": true, "format": "structured" },
    { "id": "iopScheduleProposed", "label": "Proposed IOP Schedule", "required": true, "format": "structured" }
  ],
  "promptHints": {
    "iopReadinessAssessment": "Capture clinician's assessment of patient's readiness for the IOP commitment; willingness scale + barriers + supports verbatim from session.",
    "iopScheduleProposed": "Capture the proposed schedule discussed: days/week, hours/day, group vs individual, projected duration."
  }
}
```

She also marks `sensitivityDefault: BEHAVIORAL_HEALTH` (so IOP intakes auto-tier under 42 CFR Part 2).

She saves.

**Behind the scenes**: `NoteTemplate` row created with `visibility: TEAM`, `orgId: lakeshore.id`, `division: BEHAVIORAL_HEALTH`, `specialty: 'IOP'`, `sectionSchema: <the JSON>`, `sensitivityDefault: BEHAVIORAL_HEALTH`. Audit: `TEMPLATE_CREATED`.

### Step 3 — Maria sets it as the IOP default, 9:08 AM

Above the section list there's a "Defaults" expander:
- **Default for**: select "New patients in [specialty]: IOP"

She picks that. Saves.

**Behind the scenes**: Updates an `OrgTemplateDefaults` row (or similar table) keyed by `(orgId, division, specialty, patientStatus)`. When Sam later creates a note for an IOP patient, this template is auto-selected.

Audit: `TEMPLATE_SET_AS_DEFAULT`.

### Step 4 — Sam uses the template, 1:30 PM same day

Sam is doing IOP intakes today. Maria added Sam to those visits via the schedule earlier. Sam picks the first IOP patient (Riley — same patient from Journey 01, who's now being assessed for IOP).

Sam opens `/prepare/[noteId]`. The setup form shows:
- **Template**: "IOP Intake — Lakeshore" (auto-selected based on Maria's default rule)
- **Style**: "Hybrid" (Sam's per-user default)
- **Division**: BEHAVIORAL_HEALTH
- **Sensitivity**: BEHAVIORAL_HEALTH (auto, from template's `sensitivityDefault`)

Sam reviews. The template matches what they want.

### Step 5 — Sam adjusts style for this note only, 1:31 PM

Sam wants this particular note in **Structured** style (vs their default Hybrid) because IOP intakes are highly structured. They tap the style dropdown:
- Narrative (long-form prose)
- **Hybrid** (current default, mix of structured + prose)
- Hybrid Bullet (mostly bulleted)
- Structured (tightly structured, less prose)

Sam picks **Structured**.

**Behind the scenes**: `Note.noteStyle = 'STRUCTURED'` on this note row. Sam's profile preference (`OrgUser.preferredNoteStyle = 'HYBRID'`) is unchanged — this was a per-note override.

### Step 6 — Sam records the visit, 1:35 → 2:25 PM

50-minute intake. Sam records, drafts mid-session, finishes.

**Behind the scenes (note generation)**: The `ai-generation` worker uses the template's `sectionSchema` to determine what sections to generate. It uses the `style` preference (STRUCTURED) to choose the prompt variant — `rehab-master-prompt.ts` / `behavioral-health-prompt.ts` etc. have style-specific composition rules. It uses the template's `promptHints` to give the LLM hints for specific sections.

Generated note (excerpt):
```
PRESENTING PROBLEM
[narrative paragraph]

IOP REFERRAL SOURCE
Referred by: Dr. Lin (PCP)
Referral date: 2026-05-14
Referral reason: Treatment-resistant depression; multiple medication trials without remission.

PHQ-9: 17 (moderately severe depression)
GAD-7: 12 (moderate anxiety)

IOP READINESS ASSESSMENT
Willingness scale: 8/10
Barriers: Transportation may be challenging — works weekdays.
Supports: Spouse supportive; sister also in recovery, willing to help.

[...continues per template structure...]
```

The note structure matches Maria's template exactly. The style (STRUCTURED) means there's minimal narrative — mostly key-value pairs + bulleted lists.

### Step 7 — Sam edits + signs, 2:25 → 2:30 PM

Sam reviews. Two edits: (a) clarify the "barriers" — Riley mentioned childcare as a barrier too, but Sam couldn't add that mid-session and the AI missed it; Sam adds it inline. (b) The "IOP Readiness Assessment" section has the willingness scale right but Sam wants to add a sentence of context — does it.

The PHQ-9 and GAD-7 are correctly captured (Soniox heard Sam say "PHQ-9 is 17" and "GAD-7 is 12"). Sam confirms.

She signs at 2:30 PM. The post-sign artifacts include patient instructions tailored to IOP onboarding.

---

## What just happened — behind the scenes summary

### Template authoring (Maria)
| Step | Action | Audit |
|---|---|---|
| Duplicate preset | Creates `NoteTemplate` row with `visibility: TEAM`, sectionSchema copied | `TEMPLATE_CREATED` |
| Edit sections | Updates `sectionSchema` JSON; validates against Zod schema before save | `TEMPLATE_UPDATED` |
| Set default | Writes `OrgTemplateDefaults` row | `TEMPLATE_SET_AS_DEFAULT` |

### Template use (Sam)
| Step | Action | Audit |
|---|---|---|
| Auto-select on `/prepare` | Server reads `OrgTemplateDefaults` matching (patient division + specialty + status); applies as default | `TEMPLATE_AUTO_SELECTED` (PHI-free; templateId only) |
| Style override | Sets `Note.noteStyle` for this note | `NOTE_STYLE_OVERRIDDEN` |
| AI generation | Worker uses template's sectionSchema + style preference + promptHints | (per Journey 02) |
| Sign | Per Journey 02 | `NOTE_SIGNED` |

## What makes this work (build-team mental model)

**Templates are JSON, not code.** Each `NoteTemplate.sectionSchema` is a JSON document defining the sections, their format, required-ness, and any structured fields. Schema validated by Zod on save. The AI generation worker consumes the schema at generate time — no per-template code paths.

**Visibility model.**
- `PERSONAL` — only the creator can use; useful for clinician-specific quirks.
- `TEAM` — visible to all clinicians in the same org; org admin can manage.
- `PUBLIC` — visible across orgs; requires platform-owner approval (rare; mostly the CMS preset templates).

**Specialty tag.** Optional free-text tag (e.g., "IOP", "Pediatric ADHD", "Geriatric Falls"). When a clinician schedules a patient with that specialty, the matching template is auto-selected as default.

**Style is a per-note attribute that can be defaulted per user.** `OrgUser.preferredNoteStyle` is the default; `Note.noteStyle` is the actual. The clinician can override per-note. The prompt module branches on style — `STRUCTURED` produces minimal narrative; `NARRATIVE` produces flowing prose; `HYBRID` mixes.

**Prompt hints.** Each template section can carry a `promptHints` string that's appended to the LLM prompt for that section, giving the AI a section-specific direction. This is how IOP-specific sections get IOP-specific generation behavior without writing IOP-specific code.

**Template versioning.** When a template is edited, the old version is archived (`NoteTemplate.versions` or a `NoteTemplateRevision` table). Notes record the `templateId + templateVersion` so an auditor can reconstruct what schema was used. Out-of-scope for v1 strict; the data model supports it; UI exposure is Wave 2.

## Edge cases

- **Maria edits a template that's already in use.** Existing in-progress notes continue with the old version (snapshot at note creation). New notes get the new version. Sign records the version used.
- **Clinician wants to deviate from template for one note.** Picks "No template" → fully free-form. The AI generation worker still composes the note from transcript but without section schema; output is a single "Notes" section. Rare in practice — clinicians usually pick a template.
- **Template's required section can't be populated from transcript.** Section comes back `failed` with a specific error: "Required section [IOP Schedule Proposed] couldn't be generated — no relevant content in transcript." Clinician adds it manually.
- **Template uses a measure (PHQ-9) but transcript doesn't mention it.** Section shows `empty` with a hint: "PHQ-9 score not captured in transcript. Add manually." Clinician adds.
- **Maria deletes a template that's set as a default.** Confirm dialog: "This template is the default for [N] patient categories. Deleting will revert those categories to the preset default. Continue?" — soft-delete, not hard-delete (audit retention).
- **Personal template by a clinician who later leaves the org.** Template stays accessible read-only; admin can convert to TEAM visibility or archive.
- **Compliance profile incompatibility.** Org with `STANDARD` compliance profile tries to enable a template that requires `BH_42CFR2`. Server refuses with a clear error.

## Three-lens evaluation

**Clinician** — Sam doesn't have to think about template + style every time; defaults match the clinical context. Override is one tap when needed.

**Medicare Compliance Officer** — Templates encode required sections; required-section gating means notes can't be signed missing critical documentation. Specialty templates (IOP) capture the specialty-specific elements (readiness, schedule, referral) that auditors expect.

**Insurance Auditor** — Template + version are recorded on every note. Section structure is reconstructable. Custom template changes are audited.

## What this journey doesn't cover

- Live section preview in the template editor (Wave 2 Unit 13)
- Cross-org template sharing / marketplace (out of scope for v1)
- Template import/export (out of scope; could be added)
- Multi-clinician template review/approval workflow (out of scope; org admin is the gatekeeper)

## Build-team checklist for "this journey works"

- [ ] `NoteTemplate` model with `sectionSchema: Json`, `visibility`, `division`, `specialty`, `sensitivityDefault`, `promptHints: Json`.
- [ ] Template editor at `/admin/templates/[id]/edit` (basic JSON editor for v1; better UI in Unit 13).
- [ ] Zod validation of `sectionSchema` on save; reject malformed schemas.
- [ ] `OrgTemplateDefaults` table for "when patient division + specialty + status matches, use this template."
- [ ] Auto-select default template on `/prepare` based on rules.
- [ ] AI generation worker reads `sectionSchema` + `noteStyle` + `promptHints`; no per-template code.
- [ ] `NoteStyle` enum: NARRATIVE / HYBRID / HYBRID_BULLET / STRUCTURED.
- [ ] `OrgUser.preferredNoteStyle` is the per-user default; `Note.noteStyle` is the per-note value (overridable).
- [ ] Soft-delete on templates with default-reassignment confirmation.
- [ ] Audit log: `TEMPLATE_CREATED / UPDATED / DELETED / SET_AS_DEFAULT / AUTO_SELECTED / STYLE_OVERRIDDEN`.
- [ ] Three-lens evaluation passes.

## Related references

- Templates governance: [`references/strategic/...`](../references/strategic/) (HIPAA controls matrix touches template versioning)
- Build units delivering this journey: [`context/specs/05-note-generation-and-sign.md`](../context/specs/05-note-generation-and-sign.md), [`context/specs/00-build-plan.md`](../context/specs/00-build-plan.md) Unit 13 (Templates editor maturity)
