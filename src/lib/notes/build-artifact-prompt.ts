import type { PatientProjection, EpisodeProjection } from './projections';

/**
 * Prompt builders for the two post-sign artifacts (spec §I).
 *
 * Both artifacts derive from finalJson (the FROZEN signed note — anti-
 * regression rule 3). They never touch draftJson because draftJson can keep
 * mutating after sign if a workflow ever needs it (today it doesn't, but
 * keeping the discipline lets us evolve safely).
 *
 * The projections passed in are the same PHI-aware shapes used by the
 * note-generation pipeline (firstName / age / sex / division / preferred-
 * language / MRN). DOB / SSN / phone / email NEVER reach the model.
 */

export type FinalSection = {
  id: string;
  label: string;
  content: string;
  required: boolean;
};

export type FinalJsonShape = {
  sections: FinalSection[];
  signedAt: string;
  schemaVersion: number;
};

export type ArtifactPromptParts = {
  system: string;
  user: string;
};

function renderSignedNoteForArtifact(finalJson: FinalJsonShape): string {
  return finalJson.sections
    .filter((s) => s.content.trim().length > 0)
    .map((s) => `## ${s.label}\n${s.content.trim()}`)
    .join('\n\n');
}

function renderPatientHeader(patient: PatientProjection): string {
  return [
    `Patient first name: ${patient.firstName}`,
    `Age: ${patient.age}`,
    `Sex (assigned at birth): ${patient.sex}`,
    `Preferred language: ${patient.preferredLanguage ?? 'English'}`,
    `MRN (for header only, do NOT speak the number to the patient): ${patient.mrn}`,
  ].join('\n');
}

function renderEpisode(episode?: EpisodeProjection): string {
  if (!episode) return 'Episode of care: (not linked)';
  const goals = episode.goals.length
    ? `Goals:\n${episode.goals.map((g) => `  - [${g.type}] ${g.text} (${g.status})`).join('\n')}`
    : 'Goals: (none recorded)';
  return [
    `Episode: ${episode.diagnosis}${episode.bodyPart ? ` (${episode.bodyPart})` : ''}`,
    `Department: ${episode.departmentName}`,
    `Status: ${episode.status}`,
    goals,
  ].join('\n');
}

export function buildPatientInstructionsPrompt(
  finalJson: FinalJsonShape,
  patient: PatientProjection,
  episode?: EpisodeProjection,
): ArtifactPromptParts {
  const system = [
    'You are writing patient-facing care instructions derived from a signed clinical note.',
    '',
    'Voice + reading level:',
    '  - Second person ("you"). Warm, plain, conversational.',
    '  - Target a 6th-grade reading level. Short sentences. Concrete verbs.',
    '  - Avoid jargon. If a clinical term must appear, define it in parentheses.',
    '  - Never instruct the patient to take actions that were not explicitly',
    '    documented in the signed note. Do not invent dosages, frequencies,',
    '    follow-up intervals, or red-flag symptoms — only restate what the',
    '    signed note already documented.',
    '',
    'Safety constraints:',
    '  - Do NOT provide medical advice that diverges from the signed note.',
    '  - Do NOT speculate on diagnoses the note did not state.',
    '  - If a section in the note hints at a red flag, restate it verbatim or',
    '    near-verbatim in the "what to watch for" list.',
    '  - This artifact is HANDED to the patient — it is not internal',
    '    documentation. Do not include MRN, internal codes, billing notes,',
    '    or anything you would not want the patient to read aloud.',
    '',
    `Localization: the patient prefers ${patient.preferredLanguage ?? 'English'}. If the`,
    '  preferred language is something other than English, write the instructions',
    '  in that language (you may produce a parallel English version below it ONLY if',
    '  the language is not English).',
    '',
    'Output: return a single JSON object with this exact shape — no markdown fences:',
    '{',
    '  "plainLanguage": "<one short paragraph (3-5 sentences) summarizing the visit and the plan>",',
    '  "bulletPoints":  ["<concrete action or instruction>", ...],',
    '  "whatToWatchFor": ["<red flag or warning sign>", ...],',
    '  "whenToCallUs":   ["<situation that warrants calling the clinic>", ...]',
    '}',
    'Every array must have at least 1 item. plainLanguage must be non-empty.',
  ].join('\n');

  const user = [
    'CONTEXT FOR YOU (do not echo this verbatim to the patient):',
    renderPatientHeader(patient),
    '',
    renderEpisode(episode),
    '',
    'SIGNED CLINICAL NOTE (source of truth — derive only from what is here):',
    '"""',
    renderSignedNoteForArtifact(finalJson),
    '"""',
    '',
    'Now produce the patient instructions JSON object.',
  ].join('\n');

  return { system, user };
}

export function buildReferralLetterPrompt(
  finalJson: FinalJsonShape,
  patient: PatientProjection,
  episode?: EpisodeProjection,
): ArtifactPromptParts {
  const system = [
    'You are drafting a clinician-to-clinician referral letter derived from a',
    'signed clinical note. The receiving clinician is a specialist; the sending',
    'clinician is the author of the signed note.',
    '',
    'Voice + structure:',
    '  - Professional, concise, third-person where the patient is concerned.',
    '  - Lead with the reason for referral (one short paragraph).',
    '  - Then a "Relevant findings" section grounded in the signed note.',
    '  - Then a "Requested action" section spelling out what you would like the',
    '    receiving clinician to evaluate, perform, or co-manage.',
    '  - Close with a one-line thank-you and an offer to provide records.',
    '',
    'Safety constraints:',
    '  - The signed note is the SOLE source of clinical detail. Do not invent',
    '    history, comorbidities, medications, or imaging findings.',
    '  - If the signed note does not specify a recipient specialty, infer the',
    '    most clinically appropriate specialty from the documented findings and',
    '    state it explicitly in "recipient" (e.g., "Cardiology", "Orthopedics —',
    '    Sports Medicine"). Do not invent a clinician name.',
    '  - If the note contains no clear referral signal, set "recipient" to',
    '    "General — please direct as appropriate" and write a brief body',
    '    summarizing the documented concern.',
    '',
    'Output: return a single JSON object with this exact shape — no markdown fences:',
    '{',
    '  "recipient": "<specialty name (and subspecialty if appropriate)>",',
    '  "subject":   "<short subject line, e.g. Referral: persistent right shoulder pain>",',
    '  "body":      "<full letter body, plain text with \\n line breaks; 4-8 short paragraphs>"',
    '}',
    'recipient, subject, and body must all be non-empty strings.',
  ].join('\n');

  const user = [
    'CONTEXT FOR YOU (do not echo this header verbatim into the letter body):',
    renderPatientHeader(patient),
    '',
    renderEpisode(episode),
    '',
    'SIGNED CLINICAL NOTE (source of truth — derive only from what is here):',
    '"""',
    renderSignedNoteForArtifact(finalJson),
    '"""',
    '',
    'Now produce the referral letter JSON object.',
  ].join('\n');

  return { system, user };
}
