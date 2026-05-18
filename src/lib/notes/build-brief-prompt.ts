import type { Division, EpisodeOfCare, EpisodeGoal, Note, Patient } from '@prisma/client';

import type { BriefLLMOutput } from '@/types/brief';
import type { FinalJsonShape } from '@/lib/notes/build-artifact-prompt';
import type { ExternalEhrContext } from '@/lib/fhir/project-ehr-context';

/**
 * Prior-Context Brief — prompt builder (spec: references/prior-context-brief-prompt.md).
 *
 * Three absolute rules baked into the system prompt:
 *   1. SOURCE-GROUNDED ONLY — every value supported by source notes; missing → null
 *   2. VERBATIM WHERE PRECISION MATTERS — plan items, dosages, measurements, codes quoted exactly
 *   3. NO CLINICAL CONCLUSIONS BEYOND THE NOTES — no diagnoses/precautions/education not in source
 *
 * Output is strict JSON validated by BriefLLMOutputSchema. Two attempts on
 * Sonnet (re-prompt with validation error appended); single fallback on Haiku.
 *
 * Token budget per spec: ≤8k input, ≤1500 output, temperature 0. PHI flag set
 * — the PHI guard in src/services/llm/index.ts enforces Bedrock-only routing.
 */

export type BriefPatientProjection = {
  id: string;
  displayAge: number | null;
  sex: string;
  displayName: string; // first + last initial — never full legal name
  division: string;
  preferredLanguage: string | null;
  mrn: string;
};

export type BriefEpisodeProjection = {
  id: string;
  label: string;
  diagnosis: string;
  bodyPart: string | null;
  visitsAuthorized: number | null;
  visitsCompleted: number;
  status: string;
};

export type BriefGoalProjection = {
  id: string;
  goalText: string;
  goalType: string;
  status: string;
};

export type BriefPriorNoteProjection = {
  noteId: string;
  signedAtIso: string;
  noteType: string;
  templateName: string | null;
  clinicianName: string;
  division: string;
  finalJson: FinalJsonShape;
};

export type BuildBriefPromptInput = {
  division: Division;
  todayIso: string; // ISO date used for daysAgo computation
  patient: BriefPatientProjection;
  episode: BriefEpisodeProjection | null;
  priorNotes: BriefPriorNoteProjection[]; // oldest first; 1–3 notes
  topActiveGoals: BriefGoalProjection[];
  /** Unit 22 / F4 — optional EHR enrichment from FhirCachedResource.
   *  Null when no verified PatientFhirIdentity exists or every cached
   *  row is stale. When present, the renderer emits an
   *  <external_ehr_context> block AFTER prior_notes; the LLM treats it
   *  as secondary ground truth per the EHR_CONTEXT_BLOCK system prompt. */
  externalEhrContext?: ExternalEhrContext | null;
};

const SYSTEM_HEAD = `
You are a senior clinician colleague performing a focused chart review. You will be
given up to three of a patient's most recent signed clinical notes (oldest first)
plus a small block of identity metadata. Your job is to produce a single JSON
object — the "Prior-Context Brief" — that another clinician will read in 30
seconds before walking into the room with this patient.

The brief is high-stakes. Another clinician will rely on it to decide what to do
next. Treat the source notes as the only ground truth.

═══ ABSOLUTE RULES ═══

1. SOURCE-GROUNDED ONLY.
   Every value you emit must be directly supported by text in the provided notes.
   If the notes do not contain a fact, the corresponding field is null (or an
   empty array). Never infer, extrapolate, or fill gaps with general medical
   knowledge. "Not documented" and "not present" are the same to you — both → null.

2. VERBATIM WHERE PRECISION MATTERS.
   - Plan items in \`carryForwardPlan\` MUST be quoted directly from the most recent
     note's plan section, preserving wording. Do not summarize, do not combine,
     do not reorder.
   - Numerical measurements (ROM degrees, MMT grades, pain VAS, BP, lab values,
     dosages) MUST be quoted exactly with their units.
   - Goal text MUST be quoted from the source goals section.
   - ICD/CPT codes MUST appear exactly as written (no normalization).

3. NO CLINICAL CONCLUSIONS BEYOND THE NOTES.
   You may classify trajectory direction (improving / plateau / regressing /
   mixed) only when at least two prior visits contain comparable measurements
   for the same finding. With only one prior visit, trajectory is null. Never
   add a diagnosis, never add a precaution, never add an education topic that
   is not in the source.

4. EVERY TEXT FIELD CARRIES A SOURCE NOTE ID.
   For each value in \`objectiveMeasures\` and \`topActiveGoals\`, include the
   \`sourceNoteId\` (or \`originNoteId\` for goals) of the note it came from.
   The top-level \`sourceNoteIds\` array lists every note you actually drew
   content from.

5. NO PROSE PADDING.
   Do not write "The patient appears to be..." or "It seems that...". Short,
   factual, scannable. Ideal sentence length: 8–14 words.

6. OUTPUT IS JSON ONLY.
   No markdown fences, no preamble, no commentary, no trailing text. The very
   first character of your response is \`{\` and the very last is \`}\`.
`.trim();

const MEASURE_KEY_BLOCK = `
═══ MEASURE-KEY REGISTRY (Phase 13b) ═══

When you emit an objectiveMeasures entry, set "measureKey" to the matching
registry key from this list when one clearly applies; otherwise null. Never
invent a near-miss key.

REHAB (episode-scoped):
  pain-nrs, rom-primary, strength-primary, gait-speed, outcome-tool-score

MEDICAL (patient-scoped):
  bp, hr, weight, bmi, spo2, temp

BEHAVIORAL_HEALTH (patient-scoped):
  phq9-total, gad7-total, mood-rating
`.trim();

const EHR_CONTEXT_BLOCK = `
═══ EXTERNAL EHR CONTEXT (optional) ═══

When an <external_ehr_context> block is present, treat it as SECONDARY
ground truth — equivalent in trust to the prior notes for the categories
it covers (conditions, medications, allergies, recent labs). The notes
remain the PRIMARY source for trajectory, plan, interventions, and
clinical reasoning; the EHR block adds chart-side facts the notes may not
have repeated.

CONFLICT RULE. If the EHR contradicts the most recent signed note,
prefer the note. Example: a Plan saying "discontinue metformin" overrides
an EHR MedicationStatement still listing metformin as active. Note this
gently in \`watch.recentMedChanges\` if the discrepancy is clinically
relevant — never silently drop the EHR data.

When you emit a brief value whose evidence came from the EHR block,
populate the OPTIONAL top-level \`ehrEnrichment\` object with the matching
fhirResourceId. \`ehrEnrichment\` is APPENDED to the brief — do not blend
EHR facts into the note-sourced fields (objectiveMeasures, carryForwardPlan,
etc.); those stay strictly note-sourced per Absolute Rule 1.

EHR-sourced facts that don't appear in the notes belong in
\`ehrEnrichment\`:
  • \`activeConditions\`: chronic conditions the EHR carries that the
    notes don't repeat
  • \`currentMedications\`: full med list per EHR (the notes only carry
    changes)
  • \`allergies\`: chart-side allergy list
  • \`recentObservations\`: chart labs / vitals from the last fetch

NEVER invent. If the EHR block lists 30 conditions, list at most the 8
most clinically prominent in ehrEnrichment.activeConditions. Choose
prominence by onset recency + the categories already discussed in the
notes (e.g. for an MSK visit, prioritize MSK conditions).
`.trim();

const SYSTEM_TAIL = `
═══ OUTPUT SCHEMA (strict) ═══

{
  "patientOneLine": string | null,
  "episodeContext": {
    "episodeId": string,
    "label": string,
    "visitNumber": integer | null,
    "plannedVisits": integer | null
  } | null,
  "lastVisit": {
    "noteId": string,
    "date": string,                // ISO date the note was signed
    "daysAgo": integer,
    "clinicianName": string,
    "noteType": string | null,
    "templateName": string | null
  },
  "chiefConcern": string | null,
  "priorAssessment": string | null,
  "trajectory": {
    "summary": string | null,      // ≤ 1 sentence; null if not enough data
    "direction": "improving" | "plateau" | "regressing" | "mixed" | null
  } | null,
  "objectiveMeasures": [
    {
      "measure": string,
      "unit": string | null,
      "lastValue": string,
      "priorValues": [string, ...],
      "trend": "improving" | "stable" | "worsening" | "unknown",
      "sourceNoteId": string,
      "measureKey": string | null
    }, ...
  ],
  "interventionsPerformed": [string, ...],
  "homeProgram": string | null,
  "educationGiven": [string, ...],
  "carryForwardPlan": [string, ...],
  "topActiveGoals": [
    { "text": string, "status": "active"|"met"|"carried", "delta": string | null, "originNoteId": string }, ...   // max 3
  ],
  "watch": {
    "recentMedChanges": [string, ...],
    "recentResults": [string, ...],
    "precautions": [string, ...],
    "redFlagsFromPriorNote": [string, ...]
  },
  "sourceNoteIds": [string, ...],
  "ehrEnrichment": {                       // OPTIONAL — only when <external_ehr_context> was provided
    "activeConditions": [
      { "display": string, "code": string | null, "onsetDate": string | null, "fhirResourceId": string }
    ],
    "currentMedications": [
      { "display": string, "status": string, "fhirResourceId": string }
    ],
    "allergies": [
      { "display": string, "criticality": string | null, "fhirResourceId": string }
    ],
    "recentObservations": [
      { "display": string, "value": string, "unit": string | null, "effectiveDate": string | null, "fhirResourceId": string }
    ]
  } | undefined
}

The fields generatedAt, generatorVersion, and openFollowUps are added by the
calling code AFTER your output is parsed. DO NOT include them in your response.

═══ EDGE CASES ═══

• Single prior note → trajectory is null, objectiveMeasures[].priorValues is [],
  objectiveMeasures[].trend is "unknown".
• Plan section absent → carryForwardPlan is [].
• Goals section absent in every note → topActiveGoals is [].
• Cross-discipline (e.g. OT last, PT today) → still produce; new clinician judges relevance.
• Sensitivity-redacted content (42 CFR Part 2): treat empty/redacted sections as
  not documented (null/empty), not absence of finding.
• daysAgo is calendar days between the most recent note's signed date and the
  date supplied in metadata as "today".

Now read the input. Output JSON only.
`.trim();

export const BRIEF_SYSTEM_PROMPT = [
  SYSTEM_HEAD,
  MEASURE_KEY_BLOCK,
  EHR_CONTEXT_BLOCK,
  SYSTEM_TAIL,
].join('\n\n');

export function buildBriefUserMessage(input: BuildBriefPromptInput): string {
  const episodeJson = input.episode
    ? JSON.stringify({
        episodeId: input.episode.id,
        label: input.episode.label,
        visitNumber: input.episode.visitsCompleted || null,
        plannedVisits: input.episode.visitsAuthorized,
      })
    : 'null';

  const priorBlocks = input.priorNotes
    .map((note) => {
      const sections = renderNoteSectionsForBrief(note.finalJson);
      return [
        `  <note id="${note.noteId}" signedAt="${note.signedAtIso}" type="${escapeAttr(note.noteType)}" template="${escapeAttr(note.templateName ?? 'untitled')}" clinician="${escapeAttr(note.clinicianName)}" division="${note.division}">`,
        sections,
        '  </note>',
      ].join('\n');
    })
    .join('\n');

  const goalsBlock = input.topActiveGoals.length
    ? `<active_goals>\n${input.topActiveGoals
        .map((g) => `  - id=${g.id} type=${g.goalType} status=${g.status} :: ${g.goalText}`)
        .join('\n')}\n</active_goals>`
    : '<active_goals>\n  (no active goals in DB)\n</active_goals>';

  return [
    '<patient_identity>',
    `  patientId: ${input.patient.id}`,
    `  displayAge: ${input.patient.displayAge ?? 'null'}`,
    `  sex: ${input.patient.sex}`,
    `  displayName: ${input.patient.displayName}`,
    `  division: ${input.patient.division}`,
    `  preferredLanguage: ${input.patient.preferredLanguage ?? 'English'}`,
    `  mrn: ${input.patient.mrn}`,
    `  today: ${input.todayIso}`,
    '</patient_identity>',
    '',
    '<episode_context>',
    `  ${episodeJson}`,
    '</episode_context>',
    '',
    goalsBlock,
    '',
    `<prior_notes count="${input.priorNotes.length}">`,
    priorBlocks || '  (none — first visit on record)',
    '</prior_notes>',
    '',
    renderExternalEhrContext(input.externalEhrContext ?? null),
    '',
    'Now produce the brief JSON object. Output JSON only.',
  ].join('\n');
}

function renderExternalEhrContext(ctx: ExternalEhrContext | null): string {
  if (!ctx) return '<external_ehr_context>\n  (no verified EHR link — skip ehrEnrichment in output)\n</external_ehr_context>';
  const totals =
    ctx.activeConditions.length +
    ctx.currentMedications.length +
    ctx.allergies.length +
    ctx.recentObservations.length +
    ctx.recentProcedures.length +
    ctx.recentDiagnosticReports.length;
  if (totals === 0) {
    return `<external_ehr_context ehrSystem="${escapeAttr(ctx.ehrSystem)}">\n  (cache empty for this patient — skip ehrEnrichment in output)\n</external_ehr_context>`;
  }
  const lines = [`<external_ehr_context ehrSystem="${escapeAttr(ctx.ehrSystem)}">`];
  if (ctx.activeConditions.length) {
    lines.push('  <active_conditions>');
    for (const c of ctx.activeConditions) {
      lines.push(
        `    - display="${escapeAttr(c.display)}" code=${c.code ?? 'null'} onsetDate=${c.onsetDate ?? 'null'} fhirResourceId="${escapeAttr(c.provenance.fhirResourceId)}" fetchedAt="${c.provenance.fetchedAt}"`,
      );
    }
    lines.push('  </active_conditions>');
  }
  if (ctx.currentMedications.length) {
    lines.push('  <current_medications>');
    for (const m of ctx.currentMedications) {
      lines.push(
        `    - display="${escapeAttr(m.display)}" status=${m.status} sourceType=${m.sourceType} fhirResourceId="${escapeAttr(m.provenance.fhirResourceId)}"`,
      );
    }
    lines.push('  </current_medications>');
  }
  if (ctx.allergies.length) {
    lines.push('  <allergies>');
    for (const a of ctx.allergies) {
      lines.push(
        `    - display="${escapeAttr(a.display)}" criticality=${a.criticality ?? 'null'} category=${a.category ?? 'null'} fhirResourceId="${escapeAttr(a.provenance.fhirResourceId)}"`,
      );
    }
    lines.push('  </allergies>');
  }
  if (ctx.recentObservations.length) {
    lines.push('  <recent_observations>');
    for (const o of ctx.recentObservations) {
      lines.push(
        `    - display="${escapeAttr(o.display)}" value="${escapeAttr(o.value)}" unit=${o.unit ?? 'null'} effectiveDate=${o.effectiveDate ?? 'null'} fhirResourceId="${escapeAttr(o.provenance.fhirResourceId)}"`,
      );
    }
    lines.push('  </recent_observations>');
  }
  if (ctx.recentProcedures.length) {
    lines.push('  <recent_procedures>');
    for (const p of ctx.recentProcedures) {
      lines.push(
        `    - display="${escapeAttr(p.display)}" performedDate=${p.performedDate ?? 'null'} fhirResourceId="${escapeAttr(p.provenance.fhirResourceId)}"`,
      );
    }
    lines.push('  </recent_procedures>');
  }
  if (ctx.recentDiagnosticReports.length) {
    lines.push('  <recent_diagnostic_reports>');
    for (const r of ctx.recentDiagnosticReports) {
      lines.push(
        `    - display="${escapeAttr(r.display)}" effectiveDate=${r.effectiveDate ?? 'null'} conclusion="${escapeAttr(r.conclusion ?? '')}" fhirResourceId="${escapeAttr(r.provenance.fhirResourceId)}"`,
      );
    }
    lines.push('  </recent_diagnostic_reports>');
  }
  lines.push('</external_ehr_context>');
  return lines.join('\n');
}

function renderNoteSectionsForBrief(finalJson: FinalJsonShape): string {
  return finalJson.sections
    .filter((s) => s.content.trim().length > 0)
    .map((s) => `== ${s.label} ==\n${s.content.trim()}`)
    .join('\n\n');
}

function escapeAttr(value: string): string {
  // Escape ampersands FIRST so the &quot; introduced by the next pass isn't
  // re-escaped into &amp;quot;.
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Followup extractor — separate, lightweight prompt for Haiku.
// ---------------------------------------------------------------------------

export const FOLLOWUP_EXTRACTOR_SYSTEM_PROMPT = `
You extract clinician follow-up commitments from a signed clinical note's Plan
section. A "follow-up" is a NEXT-VISIT action item — something the clinician
promised to ask, recheck, order, refer, or address at the patient's NEXT
encounter. It is NOT a description of what was done this visit.

═══ ABSOLUTE RULES ═══

1. SOURCE-GROUNDED ONLY. Every follow-up text is paraphrased only enough to be
   self-contained (≤ 280 chars). Never invent items.
2. SKIP items that describe THIS visit's work (e.g., "Performed manual mobilization").
3. SKIP HEP / education / patient instructions — those live in artifact rows.
4. SKIP one-time orders already executed this visit (e.g., "ordered CBC today").
5. KEEP items the next clinician needs to act on: "trial NSAID — ask if started",
   "recheck BP", "review imaging report", "refer ENT if no improvement in 14 days",
   "follow up labs at next visit".
6. EACH item ≤ 280 chars. If a single plan paragraph contains multiple commitments,
   split them into separate items.
7. If the plan section is empty or contains no future-facing commitments, return
   { "items": [] }.

═══ OUTPUT SCHEMA (strict) ═══

{ "items": [ { "text": "<self-contained one-line follow-up>" }, ... ] }

No markdown fences. No preamble. JSON only. Maximum 20 items.
`.trim();

export function buildFollowupExtractorUserMessage(input: {
  noteId: string;
  signedAtIso: string;
  planSectionContent: string;
}): string {
  return [
    `Note id: ${input.noteId}`,
    `Signed at: ${input.signedAtIso}`,
    '',
    'PLAN SECTION (source of truth):',
    '"""',
    input.planSectionContent.trim().length > 0
      ? input.planSectionContent
      : '(plan section was empty)',
    '"""',
    '',
    'Now extract the follow-up commitments JSON object.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Projections — same PHI discipline as the note-generation prompts.
// ---------------------------------------------------------------------------

/**
 * Brief-friendly patient projection. First-name + last-initial only —
 * NEVER full legal name into the prompt. DOB / SSN / phone / email never
 * projected.
 */
export function projectPatientForBrief(patient: Patient): BriefPatientProjection {
  const lastInitial = patient.lastName[0] ?? '';
  const displayName = `${patient.firstName} ${lastInitial}${lastInitial ? '.' : ''}`.trim();
  return {
    id: patient.id,
    displayAge: ageInYears(patient.dob),
    sex: patient.sex,
    displayName,
    division: patient.division,
    preferredLanguage: patient.preferredLanguage,
    mrn: patient.mrn,
  };
}

export function projectEpisodeForBrief(
  episode: EpisodeOfCare,
): BriefEpisodeProjection {
  return {
    id: episode.id,
    label: episode.bodyPart
      ? `${episode.diagnosis} (${episode.bodyPart})`
      : episode.diagnosis,
    diagnosis: episode.diagnosis,
    bodyPart: episode.bodyPart,
    visitsAuthorized: episode.visitsAuthorized,
    visitsCompleted: episode.visitsCompleted,
    status: episode.status,
  };
}

export function projectGoalForBrief(goal: EpisodeGoal): BriefGoalProjection {
  return {
    id: goal.id,
    goalText: goal.goalText,
    goalType: goal.goalType,
    status: goal.status,
  };
}

/**
 * Project a signed Note into the shape the brief prompt needs. Throws if the
 * note isn't actually signed (rule 20 — brief reads only attested artifacts).
 */
export function projectSignedNoteForBrief(
  note: Note & { template?: { name: string } | null },
  clinicianName: string,
): BriefPriorNoteProjection {
  if (note.status !== 'SIGNED' && note.status !== 'TRANSFERRED') {
    throw new Error(
      `projectSignedNoteForBrief: note ${note.id} is not signed (status=${note.status})`,
    );
  }
  if (!note.signedAt) {
    throw new Error(`projectSignedNoteForBrief: note ${note.id} has no signedAt`);
  }
  if (!note.finalJson) {
    throw new Error(`projectSignedNoteForBrief: note ${note.id} has no finalJson`);
  }
  return {
    noteId: note.id,
    signedAtIso: note.signedAt.toISOString(),
    noteType: 'Clinical Note',
    templateName: note.template?.name ?? null,
    clinicianName,
    division: note.division,
    finalJson: note.finalJson as unknown as FinalJsonShape,
  };
}

function ageInYears(dob: Date): number {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

// dummy use so unused-symbol stays clean if a downstream prompt-tweak removes
// BriefLLMOutput consumption.
export const __briefTouch = (_p: BriefLLMOutput | null = null) => _p;
