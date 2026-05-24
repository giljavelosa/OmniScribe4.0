/**
 * Unit 48 PR4 — MEDICAL Annual Wellness Visit brief spine.
 *
 * Sibling pattern (Decision 11): appended to BRIEF_SYSTEM_PROMPT for the
 * MEDICAL_ANNUAL_WELLNESS intent. Medicare AWV (G0438 initial / G0439
 * subsequent) is a preventive-care visit; the clinician's task is to
 * cover the personalized prevention plan elements (HRA, screenings,
 * immunizations, prior plan follow-ups).
 *
 * Source rules:
 *   - references/visit-type-taxonomy.md §5.1 — MEDICAL_ANNUAL_WELLNESS
 *     "HRA, cognitive screen, depression screen, functional ability,
 *     vitals, BMI, personalized prevention plan."
 *   - taxonomy §7 — AWV spine: care gaps + screenings due + immunizations
 *     due + prior AWV plan items.
 *   - FHIR enrichment context (Unit 22) feeds the gap analysis when the
 *     patient is FHIR-linked; the LLM is instructed to read the
 *     <external_ehr_context> block.
 */

import type { Division } from '@prisma/client';

import {
  MedicalAwvBriefShapeSchema,
  type MedicalAwvBriefShape,
} from '@/types/brief-intent-shapes';
import type { BuildBriefPromptInput } from '@/lib/notes/build-brief-prompt';

export const MEDICAL_AWV_SYSTEM_FRAGMENT = `
=== UNIT 48 — MEDICAL ANNUAL WELLNESS VISIT SPINE ===

This visit is a Medicare AWV (G0438/G0439). The clinician needs FOUR
things you don't include in a generic brief — all preventive-care
oriented:

(1) CARE GAPS
Add a top-level "careGaps" array. ONE entry per evidence-based service
the patient is missing or overdue for (BP check trend, A1c if diabetic,
cholesterol panel, etc.). Each entry:
  - label              (short label — "BP check trend", "A1c", "BMI delta")
  - dueStatus          ("overdue" | "due_now" | "due_soon")
  - lastCompletedDate  (ISO date string or null if never done)
  - source             ({ noteId, date } — note or external context
                        that establishes the gap)

Read <external_ehr_context> when present; care gaps are largely derived
from EHR observations + conditions, not signed notes alone.

(2) SCREENINGS DUE
Add a top-level "screeningsDue" array — same shape as careGaps but
specifically for USPSTF-graded screening services (colorectal,
mammography, lung cancer, depression annual, alcohol use, etc.).
Splitting screeningsDue out from careGaps lets the renderer surface them
under their own heading; the schema is intentionally identical so the
clinician can scan both in one mental model.

(3) IMMUNIZATIONS DUE
Add a top-level "immunizationsDue" array. ONE entry per vaccine the
patient is missing or due for. Each entry:
  - vaccine                  ("Influenza", "Pneumococcal PCV20",
                              "Shingrix", "COVID-19 booster", etc.)
  - dueStatus                ("overdue" | "due_now" | "due_soon")
  - lastAdministeredDate     (ISO or null if never received)
  - source                   ({ noteId, date })

(4) PRIOR AWV PLAN ITEMS
Add a top-level "priorAwvItems" array. ONE entry per plan item from the
patient's prior AWV note (if any), so the clinician can confirm what was
followed through on. Each entry:
  - text          (verbatim plan item from the prior AWV's plan section)
  - sourceNoteId  (the prior AWV note)
  - resolved      (true | false | null — null when unknown from the
                   intervening notes)

If this is the patient's FIRST AWV, emit an empty array.

OUTPUT FORMAT
Base-schema fields PLUS the four above. No markdown fences. JSON only.
`.trim();

export function synthesizeStubMedicalAwvBrief(
  input: BuildBriefPromptInput,
  baseStub: Omit<MedicalAwvBriefShape, 'careGaps' | 'screeningsDue' | 'immunizationsDue' | 'priorAwvItems'>,
): MedicalAwvBriefShape {
  const sourceNoteId =
    input.priorNotes[input.priorNotes.length - 1]?.noteId ?? 'stub-source';
  const todayDate = input.todayIso.slice(0, 10);
  return {
    ...baseStub,
    careGaps: [
      {
        label: '[stub care gap]',
        dueStatus: 'due_now' as const,
        lastCompletedDate: null,
        source: { noteId: sourceNoteId, date: todayDate },
      },
    ],
    screeningsDue: [
      {
        label: '[stub screening]',
        dueStatus: 'due_soon' as const,
        lastCompletedDate: null,
        source: { noteId: sourceNoteId, date: todayDate },
      },
    ],
    immunizationsDue: [
      {
        vaccine: '[stub vaccine]',
        dueStatus: 'overdue' as const,
        lastAdministeredDate: null,
        source: { noteId: sourceNoteId, date: todayDate },
      },
    ],
    priorAwvItems: [],
  };
}

export const MEDICAL_AWV_SPINE = {
  division: 'MEDICAL' as Division,
  intent: 'MEDICAL_ANNUAL_WELLNESS' as const,
  systemPromptFragment: MEDICAL_AWV_SYSTEM_FRAGMENT,
  outputSchema: MedicalAwvBriefShapeSchema,
  stubSynthesizer: synthesizeStubMedicalAwvBrief,
} as const;
