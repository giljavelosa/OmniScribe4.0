/**
 * Note-text helpers — Unit 12 §6 visit-history snippet derivation.
 *
 * Pure functions over Note.finalJson. Used by GET /api/patients/[id]/visits
 * to populate `assessmentSnippet` per visit-history row.
 */

import type { FinalJsonShape } from './build-artifact-prompt';

const MAX_SNIPPET_CHARS = 280;

/**
 * Find the most-clinically-useful section content for a row snippet.
 * Falls back through Assessment → Subjective → first non-empty section.
 * Returns null when the note has no useful content (e.g., empty draft).
 */
export function deriveAssessmentSnippet(finalJson: FinalJsonShape | null): string | null {
  if (!finalJson?.sections?.length) return null;
  const sections = finalJson.sections.filter((s) => s.content?.trim());

  const assessment = sections.find((s) => /assessment/i.test(s.label));
  if (assessment?.content) return truncate(assessment.content.trim(), MAX_SNIPPET_CHARS);

  const subjective = sections.find((s) => /subjective|hpi|history/i.test(s.label));
  if (subjective?.content) return truncate(subjective.content.trim(), MAX_SNIPPET_CHARS);

  const first = sections[0];
  if (first?.content) return truncate(first.content.trim(), MAX_SNIPPET_CHARS);
  return null;
}

function truncate(s: string, cap: number): string {
  if (s.length <= cap) return s;
  return `${s.slice(0, cap).trimEnd()}…`;
}
