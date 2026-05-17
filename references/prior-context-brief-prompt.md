# Prior-Context Brief — LLM Prompt Spec

**Status:** Draft for implementation
**Companion to:** `prior-context-brief-spec.md`
**Target file (Cursor will create):** `src/lib/prompts/brief-prompt.ts`
**Target generator (Cursor will create):** `src/services/llm/brief-generator.ts`
**Last updated:** 2026-05-05

**Runtime prompt shape (Phase 13b):** In code, the system prompt is `BRIEF_SYSTEM_PROMPT_HEAD` + an injected block from `measureKeyRegistryDoc()` (keys drawn from `src/lib/snapshots/registry.ts`, same text as **§4.1** below) + `BRIEF_SYSTEM_PROMPT_TAIL` — see `src/lib/prompts/brief-prompt.ts`. The large fenced block in **§4** is the human-readable baseline; the registry keys are always current in the repo.

---

## 1. What this prompt does

Given up to **3 most recent signed notes** for a patient (within the same episode of care when one is provided), produce a single JSON object conforming to `PriorContextBrief` (see `prior-context-brief-spec.md` §5.1). The output is what powers the 30-second card on the prepare and capture screens of the next visit.

This prompt is run by a BullMQ worker at sign-time of each note — not on every page render. It uses **Sonnet 4.5 via Bedrock** (BAA-covered), runs at temperature 0, and is hard-bounded on tokens.

## 2. Design philosophy (the three rules the prompt enforces)

1. **Source-grounded only.** Every text field in the output must be supported by content in the provided notes. If the source doesn't say it, the field is `null`. No inference, no paraphrase that loses precision, no clinical conclusions beyond what was written.
2. **Verbatim where it matters.** Plan items, dosages, measurements, dates, ICD/CPT codes, and goal text are quoted exactly as the prior clinician wrote them. The brief is a faithful summary, not an editorial.
3. **Structured > narrative.** The brief's value is its scannability. Output prefers short labeled fields and arrays over prose. Where text is needed (e.g. `trajectory.summary`), keep it ≤ 1 sentence.

These three rules exist to make the brief *trustable*. A clinician will only stop opening the prior note manually when they trust what's in front of them.

## 3. Model + invocation settings

| Setting | Value | Rationale |
|---|---|---|
| Provider | Bedrock (BAA) via `getLLMService()` | Anti-regression rule 6; PHI-guarded wrapper enforces this. |
| Model | `BEDROCK_MODEL_ID` (Sonnet 4.5, `us.anthropic.claude-sonnet-4-5-...`) | Clinical reasoning + JSON discipline. Latency isn't a primary concern (precompute job). |
| Temperature | `0` | Deterministic. The same input must produce the same brief. |
| `phi` flag | `true` | Required — input contains PHI. PHIProviderViolation if a non-BAA provider is configured. |
| Input token budget | ≤ 8,000 | Three full SOAP notes typically fit. Truncate longest sections first if exceeded. |
| `maxTokens` (output) | `1500` | Empirically sufficient for the schema; rejects bloated output. |
| `jsonMode` | n/a on Bedrock — enforced via prompt + Zod validation on parse | The Anthropic Bedrock API doesn't have OpenAI-style strict JSON mode. We use `<output_format>` discipline + post-parse validation. |
| Retries on schema violation | 2 | Worker re-prompts with the validation error appended to the user message. |
| Retries on Bedrock error | 3 with exponential backoff | Anti-regression rule 10 — same as other BullMQ jobs. |
| Fallback | `getFastLLMService()` (Haiku 4.5) on third failure | Generates a valid-but-thinner brief rather than no brief at all. Stamp `generatorVersion: "llm-v1-fallback-haiku"`. |
| Cost ceiling | ≤ $0.05 per brief | At ~6k input + 1.5k output tokens on Sonnet 4.5, expected cost is ~$0.024. Alarm at 2× expected. Re-confirm after adding the `measureKey` block (Phase 13b) — should stay within ~±10% output tokens. |

## 4. The system prompt (final text)

Wrap this in a const named `BRIEF_SYSTEM_PROMPT` in `src/lib/prompts/brief-prompt.ts`.

```
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
   - Plan items in `carryForwardPlan` MUST be quoted directly from the most recent
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
   For each value in `objectiveMeasures` and `topActiveGoals`, include the
   `sourceNoteId` of the note it came from. The top-level `sourceNoteIds` array
   lists every note you actually drew content from.

5. NO PROSE PADDING.
   Do not write "The patient appears to be..." or "It seems that...". Short,
   factual, scannable. Ideal sentence length: 8–14 words.

6. OUTPUT IS JSON ONLY.
   No markdown fences, no preamble, no commentary, no trailing text. The very
   first character of your response is `{` and the very last is `}`.

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
      "measure": string,           // e.g. "Pain VAS"
      "unit": string | null,       // e.g. "/10" or "degrees" or null
      "lastValue": string,
      "priorValues": [string, ...], // most recent first; may be empty
      "trend": "improving" | "stable" | "worsening" | "unknown",
      "sourceNoteId": string,
      "measureKey": string | null  // registry key from §4.1, or null if no match
    }, ...
  ],
  "interventionsPerformed": [string, ...],
  "homeProgram": string | null,
  "educationGiven": [string, ...],
  "carryForwardPlan": [string, ...],
  "topActiveGoals": [
    {
      "text": string,
      "status": "active" | "met" | "carried",
      "delta": string | null,      // ≤ 4 words; e.g. "on track", "stalled"
      "originNoteId": string
    }, ...                         // max 3 entries; surface highest-priority first
  ],
  "watch": {
    "recentMedChanges": [string, ...],
    "recentResults": [string, ...],
    "precautions": [string, ...],
    "redFlagsFromPriorNote": [string, ...]
  },
  "sourceNoteIds": [string, ...]
}

The fields `generatedAt` and `generatorVersion` are added by the calling code
AFTER your output is parsed. DO NOT include them in your response.

═══ FIELD CONSTRUCTION RULES ═══

• `patientOneLine`: build from identity metadata + diagnosis/episode label only.
  Format: "<age><sex>, <primary concern>, <where in episode if known>".
  Example: "68F, R shoulder post-fall, week 4 of 6".
  If you cannot construct it from the input → null.

• `chiefConcern`: 1 sentence summarizing why this patient is in care for this
  episode, drawn from the earliest available subjective/HPI section.

• `priorAssessment`: 1 sentence, drawn from the MOST RECENT note's assessment
  section. Quote-faithful; lossy paraphrase is allowed only to fit one sentence.

• `trajectory.direction`:
   - "improving" if a strict majority of comparable measures trend toward target
   - "regressing" if a strict majority trend away from target
   - "plateau" if a strict majority are unchanged across visits
   - "mixed" if no majority direction
   - null if fewer than 2 prior visits OR no comparable measures across visits

• `objectiveMeasures`: emit ONE entry per distinct measure that appears in the
  most recent note's objective section AND has a numerical or graded value.
  - Pull `priorValues` from earlier notes if the same measure appears.
  - `trend` for a single-visit measure is "unknown".
  - Do not invent measures not in the notes (no "BP" if BP wasn't recorded).
  - `measureKey`: set to the matching registry key from **§4.1** when one clearly
    applies; otherwise `null`. Never invent a near-miss key — if unsure, `null`.

• `interventionsPerformed`: itemize manual techniques, modalities, therapeutic
  exercises, and procedures performed during the most recent visit. One short
  phrase per item. Quote-faithful where possible.

• `homeProgram`: one sentence describing the HEP given/updated at the most recent
  visit. Null if no HEP section or no HEP-related content.

• `educationGiven`: list patient education topics covered at the most recent
  visit. Each topic ≤ 6 words.

• `carryForwardPlan`: VERBATIM plan items from the most recent note's plan
  section that describe actions for the NEXT (= today's) visit. Skip plan items
  that describe what was done this visit. Do not paraphrase.

• `topActiveGoals`: select up to 3 highest-clinical-priority goals from the
  goals section. Status mirrors how the goal was marked. `delta` is your read
  of progress trajectory based on goal text + prior values, ≤ 4 words. If no
  goals section exists in any note, return [].

• `watch`:
  - `recentMedChanges`: medications added, removed, or dosed differently since
    the second-most-recent note. If no medication context is available, [].
  - `recentResults`: labs/imaging mentioned in the most recent note. [] if none.
  - `precautions`: any explicit precautions mentioned in any note (weight-bearing,
    fall risk, sternal precautions, etc.). [] if none.
  - `redFlagsFromPriorNote`: items the prior clinician explicitly flagged for
    the next visit's attention. Distinct from precautions — these are visit-
    specific watchouts.

═══ EDGE CASES ═══

• Single prior note → `trajectory` is null, `objectiveMeasures[].priorValues` is [],
  `objectiveMeasures[].trend` is "unknown".
• Plan section absent → `carryForwardPlan` is [].
• Goals section absent in every note → `topActiveGoals` is [].
• Note division differs from the new visit (e.g. last visit was OT, today is PT)
  → still produce the brief; the new clinician will judge cross-discipline
  relevance. Do not gate output on division match.
• Sensitivity-redacted content (42 CFR Part 2): if a note section is empty or
  redacted, treat as not documented (null/empty), not as absence of finding.
• Date math: `daysAgo` is calendar days between the most recent note's signed
  date and the date supplied in the metadata as `today`.

Now read the input. Output JSON only.
```

### 4.1 Phase 13b — `measureKey` registry (must match `registry.ts`)

**Source of truth:** `src/lib/snapshots/registry.ts`. These keys must match **exactly** (character-for-character). If you cannot map a documented measure to one row, emit `"measureKey": null`. The brief generator then validates every key; unknown values are logged for observability and stored as `null` so downstream snapshot logic never persists a hallucinated key.

**REHAB (episode-scoped):** `pain-nrs`, `rom-primary`, `strength-primary`, `gait-speed`, `outcome-tool-score`

**MEDICAL (patient-scoped):** `bp`, `hr`, `weight`, `bmi`, `spo2`, `temp`

**BEHAVIORAL HEALTH (patient-scoped):** `phq9-total`, `gad7-total`, `mood-rating`

**Positive examples (label → key):**

| Division | Example measure label in notes | `measureKey` |
|----------|--------------------------------|----------------|
| Rehab | Shoulder flex AROM / primary ROM row | `rom-primary` |
| Medical | Blood pressure | `bp` |
| BH | PHQ-9 total score | `phq9-total` |

**Negative example:** Grip strength from a dynamometer (or any objective row with no registry entry) → include the measure text and values as usual, but set `"measureKey": null` because there is no `grip-*` key in the registry. Do not fabricate `rom-shoulder-r` or similar.

## 5. The user message template

Wrap this as a function `buildBriefUserMessage(input)` in `src/lib/prompts/brief-prompt.ts`. The function takes the BullMQ job's payload and returns the assembled user message string.

```
<patient_identity>
patientId: {{patientId}}
displayAge: {{age}}        // computed; null if DOB missing
sex: {{sex}}               // "M" | "F" | "other" | null
displayName: {{redactedDisplayName}}   // never include full legal name; first name + last initial
today: {{todayIso}}        // ISO date used for daysAgo computation
</patient_identity>

<episode_context>
{{episodeJsonOrNull}}      // { episodeId, label, visitNumber, plannedVisits } or "null"
</episode_context>

<prior_notes count="{{n}}">     // n = 1, 2, or 3; oldest first
  <note id="{{noteId}}" signedAt="{{signedAtIso}}" type="{{noteType}}" template="{{templateName}}" clinician="{{clinicianName}}" division="{{division}}">
{{noteAsPlainText}}        // headings + content, extracted from finalJson via the existing
                           // extractSections() utility, joined with two newlines
  </note>
  ...
</prior_notes>
```

**Plain-text extraction rule:** reuse `extractSections()` from `src/app/api/patients/[id]/note-context/route.ts`, lifted into `src/lib/notes/note-text.ts` so both the brief generator and the regex extractor share the parser. Each section is rendered as:

```
== {{Section Label}} ==
{{section content}}
```

Sections to include in order: Subjective / HPI, Objective, Assessment, Plan, Goals, Interventions/Treatment, Education, HEP, Precautions, Medications. Skip header/billing/CPT sections to save tokens.

**Truncation policy** if total input > 8,000 tokens: drop oldest note first; if still over, truncate longest section in oldest note; never truncate the most recent note's plan or assessment.

## 6. Few-shot examples (include in the user message at the END, before "Now produce the brief.")

Two examples — sparse and rich — give the model a calibration anchor. Append both to every call.

### 6.1 Sparse example (1 prior note, missing measures)

No objective measures were recorded in the note → `objectiveMeasures` is `[]`; therefore no `measureKey` fields appear.

**Input:**
```
<patient_identity>
patientId: pat_abc
displayAge: 54
sex: M
displayName: Jorge R.
today: 2026-04-12
</patient_identity>

<episode_context>
null
</episode_context>

<prior_notes count="1">
  <note id="note_001" signedAt="2026-04-05" type="Initial Evaluation" template="PT IE" clinician="Dr. Smith" division="REHAB">
== Subjective ==
Patient is 54M c/o R knee pain x 3 weeks after twisting injury during basketball.
Pain 6/10 with stairs, 3/10 at rest. Denies locking, giving way.

== Assessment ==
R knee pain consistent with mild MCL strain. Functional limitations with stairs and squatting.

== Plan ==
Begin PT 2x/week for 4 weeks. Focus on quad activation, ROM, progressive WB.
Recheck pain VAS and ROM at week 2. Patient education on RICE.
  </note>
</prior_notes>
```

**Expected output:**
```json
{
  "patientOneLine": "54M, R knee pain x 3 wk post twisting injury",
  "episodeContext": null,
  "lastVisit": {
    "noteId": "note_001",
    "date": "2026-04-05",
    "daysAgo": 7,
    "clinicianName": "Dr. Smith",
    "noteType": "Initial Evaluation",
    "templateName": "PT IE"
  },
  "chiefConcern": "R knee pain x 3 weeks after basketball twisting injury.",
  "priorAssessment": "R knee pain consistent with mild MCL strain; functional limits stairs and squatting.",
  "trajectory": null,
  "objectiveMeasures": [],
  "interventionsPerformed": [],
  "homeProgram": null,
  "educationGiven": ["RICE"],
  "carryForwardPlan": [
    "Recheck pain VAS and ROM at week 2"
  ],
  "topActiveGoals": [],
  "watch": {
    "recentMedChanges": [],
    "recentResults": [],
    "precautions": [],
    "redFlagsFromPriorNote": []
  },
  "sourceNoteIds": ["note_001"]
}
```

Note: trajectory is null (only 1 visit). No objective measures (none recorded). carryForwardPlan picks ONE item — the verbatim "Recheck pain VAS and ROM at week 2" — because the others describe actions done this visit, not next.

### 6.2 Rich example (3 prior notes, with trajectory)

**Input:** *(abbreviated for brevity in this spec; full version in test fixtures)*
- Note A — Initial Eval, 2026-03-15: pain 7/10, flex AROM 95°, MMT ER 3+/5
- Note B — Progress, 2026-03-22: pain 5/10, flex AROM 110°, MMT ER 3+/5, education on sleep posture, "Trial NSAID — ask if started" in plan
- Note C — Progress, 2026-04-06: pain 4/10, flex AROM 125°, MMT ER 3+/5, plan: "Progress band rows to red, recheck scap dyskinesis, address sleep complaint if still present"

**Expected output (key fields):**
```json
{
  "patientOneLine": "68F, R shoulder post-fall, week 4 of 6",
  "trajectory": {
    "summary": "Improving: pain trending down, AROM gains in flexion.",
    "direction": "improving"
  },
  "objectiveMeasures": [
    {
      "measure": "Pain VAS",
      "unit": "/10",
      "lastValue": "4",
      "priorValues": ["5", "7"],
      "trend": "improving",
      "sourceNoteId": "note_C",
      "measureKey": "pain-nrs"
    },
    {
      "measure": "Shoulder flex AROM",
      "unit": "degrees",
      "lastValue": "125",
      "priorValues": ["110", "95"],
      "trend": "improving",
      "sourceNoteId": "note_C",
      "measureKey": "rom-primary"
    },
    {
      "measure": "MMT ER",
      "unit": "/5",
      "lastValue": "3+",
      "priorValues": ["3+", "3+"],
      "trend": "stable",
      "sourceNoteId": "note_C",
      "measureKey": "strength-primary"
    }
  ],
  "carryForwardPlan": [
    "Progress band rows to red",
    "Recheck scap dyskinesis",
    "Address sleep complaint if still present"
  ]
}
```

Note: trajectory is "improving" because 2 of 3 measures trend that way (majority). Verbatim plan items.

## 7. Validation (Zod schema)

Place in `src/lib/prompts/brief-schema.ts`. The worker calls `briefSchema.parse(jsonResponse)` and on failure either retries with the validation error appended OR falls back to Haiku.

```ts
import { z } from "zod";

export const objectiveMeasureSchema = z.object({
  measure: z.string().min(1),
  unit: z.string().nullable(),
  lastValue: z.string().min(1),
  priorValues: z.array(z.string()),
  trend: z.enum(["improving", "stable", "worsening", "unknown"]),
  sourceNoteId: z.string().min(1),
  measureKey: z.union([z.string().min(1), z.null()]).optional(),
});

export const goalSnippetSchema = z.object({
  text: z.string().min(1),
  status: z.enum(["active", "met", "carried"]),
  delta: z.string().max(50).nullable(),
  originNoteId: z.string().min(1),
});

export const briefLLMSchema = z.object({
  patientOneLine: z.string().nullable(),
  episodeContext: z
    .object({
      episodeId: z.string(),
      label: z.string(),
      visitNumber: z.number().int().nullable(),
      plannedVisits: z.number().int().nullable(),
    })
    .nullable(),
  lastVisit: z.object({
    noteId: z.string().min(1),
    date: z.string(),
    daysAgo: z.number().int().min(0),
    clinicianName: z.string().min(1),
    noteType: z.string().nullable(),
    templateName: z.string().nullable(),
  }),
  chiefConcern: z.string().nullable(),
  priorAssessment: z.string().nullable(),
  trajectory: z
    .object({
      summary: z.string().nullable(),
      direction: z
        .enum(["improving", "plateau", "regressing", "mixed"])
        .nullable(),
    })
    .nullable(),
  objectiveMeasures: z.array(objectiveMeasureSchema),
  interventionsPerformed: z.array(z.string()),
  homeProgram: z.string().nullable(),
  educationGiven: z.array(z.string()),
  carryForwardPlan: z.array(z.string()),
  topActiveGoals: z.array(goalSnippetSchema).max(3),
  watch: z.object({
    recentMedChanges: z.array(z.string()),
    recentResults: z.array(z.string()),
    precautions: z.array(z.string()),
    redFlagsFromPriorNote: z.array(z.string()),
  }),
  sourceNoteIds: z.array(z.string().min(1)).min(1),
});

export type BriefLLMOutput = z.infer<typeof briefLLMSchema>;
```

After parse, the worker stamps `generatedAt: new Date().toISOString()` and `generatorVersion: "llm-v1"` (or `"llm-v1-fallback-haiku"`) and writes the full `PriorContextBrief` to the `NoteBrief` table.

## 8. Worker call shape (reference for Cursor)

```ts
import { getLLMService, getFastLLMService } from "@/services/llm";
import { BRIEF_SYSTEM_PROMPT, buildBriefUserMessage } from "@/lib/prompts/brief-prompt";
import { briefLLMSchema } from "@/lib/prompts/brief-schema";

export async function generateBrief(input: BriefGeneratorInput): Promise<PriorContextBrief> {
  const userMessage = buildBriefUserMessage(input);
  const llm = getLLMService();           // Sonnet via Bedrock
  let lastError: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const augmented = lastError
      ? `${userMessage}\n\nPREVIOUS ATTEMPT FAILED VALIDATION:\n${lastError}\nReturn corrected JSON only.`
      : userMessage;

    const raw = await llm.generate(BRIEF_SYSTEM_PROMPT, augmented, {
      phi: true,
      maxTokens: 1500,
    });

    try {
      const parsed = briefLLMSchema.parse(JSON.parse(raw.trim()));
      // After parse: sanitize objectiveMeasures[].measureKey against registry (Phase 13b).
      return finalizeBrief(parsed, "llm-v1");
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  // Fallback: Haiku, single attempt, mark version
  const fastLLM = getFastLLMService();
  const raw = await fastLLM.generate(BRIEF_SYSTEM_PROMPT, userMessage, {
    phi: true,
    maxTokens: 1500,
  });
  const parsed = briefLLMSchema.parse(JSON.parse(raw.trim()));
  return finalizeBrief(parsed, "llm-v1-fallback-haiku");
}

function finalizeBrief(
  parsed: BriefLLMOutput,
  generatorVersion: string,
): PriorContextBrief {
  return {
    ...parsed,
    generatedAt: new Date().toISOString(),
    generatorVersion,
  };
}
```

## 9. Test fixtures Cursor must build

Create `src/lib/prompts/__fixtures__/brief/`:

- `single-eval-sparse.json` → matches §6.1 example
- `three-visit-rich.json` → matches §6.2 example
- `redacted-sensitive.json` → 42 CFR Part 2-redacted sections; brief must not invent content
- `cross-discipline.json` → previous note OT, current PT — brief still produces, no division gating
- `no-goals.json` → brief returns `topActiveGoals: []` not invented goals
- `mixed-trajectory.json` → some measures improving, others worsening → direction = "mixed"

Each fixture has `input` and `expectedFields` (partial — use Zod parse + key-field equality, not full JSON equality, since LLM output for free-text fields will vary slightly run-to-run).

## 10. Acceptance criteria for Phase 4

- [ ] `BRIEF_SYSTEM_PROMPT` and `buildBriefUserMessage` exported from `src/lib/prompts/brief-prompt.ts`
- [ ] `briefLLMSchema` exported from `src/lib/prompts/brief-schema.ts` and used in the worker
- [ ] `generateBrief()` exported from `src/services/llm/brief-generator.ts`, callable from the BullMQ worker
- [ ] All six fixtures produce output that passes `briefLLMSchema.parse()` and matches expected key fields
- [ ] Cost test: Sonnet generation on the rich fixture costs ≤ $0.05 (logged via Bedrock invocation metrics)
- [ ] PHI flag is `true` on every call (covered by existing PHIGuardedLLMService — verify in unit test)
- [ ] No test fixture causes the model to invent fields not in source (anti-hallucination spot checks in test suite)
- [ ] Schema-violation retry path tested by injecting a malformed first response in a mock provider
- [ ] Haiku fallback path tested by injecting two sequential Sonnet failures in a mock provider

## 11. Things this prompt deliberately does NOT do

- It does not propose follow-ups. That's a separate prompt for Phase 5 (`followup-extractor.ts`).
- It does not generate patient-facing AVS text. That's a future prompt when the AVS workstream begins.
- It does not pull from the EHR / NextGen directly. It only consumes signed OmniScribe notes. When the FHIR pipe lands, the brief generator's input expands to include FHIR resources, and §5 user-message template gets new sections.
- It does not stream. Briefs are short JSON; non-streaming is simpler and the worker doesn't need progressive UI.

## 12. Open questions (deferred — not blocking implementation)

- **`trajectory.summary` style:** should it lead with the direction word ("Improving:") or the measure ("Pain trending down")? Default in the prompt currently leads with direction. Defer to clinician feedback after Phase 4 lands.
- **Diagnosis surfacing:** should `patientOneLine` include ICD-10 codes when present? Default: no — clinicians read narrative faster than codes; codes still appear in the source note via tap-through.
- **Token budget headroom:** if 3 notes regularly exceed 8,000 tokens (long evaluations especially), do we move to 2 prior notes plus a separate "older history snapshot" field? Defer until measured in production.
