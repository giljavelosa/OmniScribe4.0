import { Division } from '@prisma/client';
import type { TranscriptClean } from '@/services/transcription';
import type { PatientProjection, EpisodeProjection } from './projections';
import { buildMedicalMasterPrompt } from '@/lib/note-medical-prompt';
import { buildBehavioralHealthMasterPrompt } from '@/lib/note-behavioral-health-prompt';
import { buildRehabMasterPrompt } from '@/lib/note-rehab-master-prompt';

export type NoteSectionDef = {
  id: string;
  label: string;
  required?: boolean;
  promptHint?: string;
};

export type NoteTemplateLite = {
  id: string;
  name: string;
  sections: NoteSectionDef[];
  promptHints?: Record<string, unknown> | null;
};

export type BuildPromptInput = {
  division: Division;
  transcriptClean: TranscriptClean | null;
  template: NoteTemplateLite;
  noteStyle: string; // NARRATIVE / HYBRID / HYBRID_BULLET / STRUCTURED
  patient: PatientProjection;
  episode?: EpisodeProjection;
  /** Set in Unit 06 once BriefGenerator lands. Plain text summary. */
  priorContext?: string | null;
};

export type MasterPromptParts = {
  system: string;
  user: string;
};

/**
 * Master prompt dispatch by division. Each division module owns the clinical
 * voice + division-specific section nuance. Common scaffolding (patient
 * projection, transcript framing, template-driven section list, output-
 * schema reminder) lives in lib/notes/sections.ts + the division builders.
 */
export function buildMasterPrompt(input: BuildPromptInput): MasterPromptParts {
  switch (input.division) {
    case Division.MEDICAL:
    case Division.MULTI:
      return buildMedicalMasterPrompt(input);
    case Division.BEHAVIORAL_HEALTH:
      return buildBehavioralHealthMasterPrompt(input);
    case Division.REHAB:
      return buildRehabMasterPrompt(input);
    default: {
      // exhaustive check
      const _exhaustive: never = input.division;
      throw new Error(`buildMasterPrompt: unhandled division ${String(_exhaustive)}`);
    }
  }
}

/**
 * Per-section prompt for streaming generation. Reuses the master prompt's
 * `user` payload but appends a "now write ONE section: …" instruction so the
 * model returns JUST that section as a string (jsonMode=true wraps it).
 */
export function buildSectionPrompt(
  baseUser: string,
  section: NoteSectionDef,
  noteStyle: string,
): string {
  const styleHint =
    noteStyle === 'NARRATIVE'
      ? 'Write in flowing prose, full sentences, no bullets.'
      : noteStyle === 'HYBRID_BULLET'
        ? 'Write in bullet form with short, complete bullets; sub-bullets allowed.'
        : noteStyle === 'STRUCTURED'
          ? 'Write in tight structured key/value or short labeled lines.'
          : 'Write in a hybrid style: short narrative paragraphs with bullets where they fit.';

  return [
    baseUser,
    '',
    '---',
    `NOW WRITE THIS ONE SECTION ONLY: "${section.label}" (id: ${section.id})`,
    section.required ? '(This section is REQUIRED — do not leave empty.)' : '(This section is optional but should be filled when relevant.)',
    section.promptHint ? `Section guidance: ${section.promptHint}` : '',
    styleHint,
    '',
    'Return a JSON object with exactly two keys:',
    '  - "sectionId": the literal id above',
    '  - "content":   the section text (string; embed line breaks with \\n)',
    '',
    'Do NOT wrap the response in markdown fences. Do NOT include any other keys.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Shared "user-prompt body" used by every division builder so the patient +
 * transcript framing is identical across MEDICAL / BH / REHAB. Division
 * builders prepend a division-specific system prompt + appended a division
 * hint to the user body.
 */
export function buildSharedUserBody(input: BuildPromptInput): string {
  const transcriptText = input.transcriptClean
    ? input.transcriptClean.structured.map((s) => `${s.speaker}: ${s.text}`).join('\n')
    : '[no transcript captured]';

  const episodeBlock = input.episode
    ? [
        `Episode: ${input.episode.diagnosis}` +
          (input.episode.bodyPart ? ` (${input.episode.bodyPart})` : ''),
        `Department: ${input.episode.departmentName}`,
        `Status: ${input.episode.status}`,
        input.episode.goals.length
          ? 'Active goals:\n' + input.episode.goals.map((g) => `  - [${g.type}] ${g.text} (${g.status})`).join('\n')
          : 'Active goals: (none recorded)',
      ].join('\n')
    : 'No episode of care linked.';

  const priorBlock =
    input.priorContext && input.priorContext.trim()
      ? `Prior-visit context (from precomputed brief):\n${input.priorContext.trim()}`
      : 'Prior-visit context: (none — first visit or brief not yet computed)';

  return [
    `PATIENT (de-identified projection for prompt safety):`,
    `  First name: ${input.patient.firstName}`,
    `  Age: ${input.patient.age}`,
    `  Sex (assigned at birth): ${input.patient.sex}`,
    `  Division (this note): ${input.division}`,
    `  Preferred language: ${input.patient.preferredLanguage ?? 'unspecified'}`,
    `  MRN: ${input.patient.mrn}`,
    '',
    episodeBlock,
    '',
    priorBlock,
    '',
    `Template: ${input.template.name}`,
    `Sections to fill (in order):`,
    ...input.template.sections.map((s) => `  - ${s.label} (id=${s.id})${s.required ? ' [REQUIRED]' : ''}`),
    '',
    'FULL VISIT TRANSCRIPT (cleaned + diarized):',
    '"""',
    transcriptText,
    '"""',
  ].join('\n');
}
