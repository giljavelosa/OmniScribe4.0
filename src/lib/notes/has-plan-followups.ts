/**
 * Cheap regex check that the Plan section text mentions a follow-up commitment.
 *
 * This is a UI gate only — it decides whether `/review` shows a soft nudge
 * banner asking the clinician to add a follow-up. The source of truth for
 * what becomes a real `FollowUp` row at sign time is still the LLM-based
 * `FollowupExtractor` in [`src/services/brief/FollowupExtractor.ts`].
 *
 * False positives are fine (no banner where one might help — clinician can
 * still add follow-ups via the explicit "Add follow-up" button).
 * False negatives are also fine (banner shows when the AI did capture
 * something obliquely — clinician just confirms what's already there).
 *
 * Patterns intentionally broad:
 *   - "follow-up" / "follow up" / "followup"
 *   - "recheck"
 *   - "return visit", "return in"
 *   - "re-evaluate" / "reevaluate"
 *   - "next visit"
 *   - "in 6 weeks" / "in 3 days" / "in 2 months" (interval phrasings)
 */
const FOLLOWUP_HINT =
  /\b(follow.?up|recheck|return\s+(?:visit|in)|re.?evaluate|next\s+visit|in\s+\d+\s+(?:day|week|month)s?)\b/i;

export function hasPlanFollowUps(planContent: string | null | undefined): boolean {
  if (!planContent || planContent.trim().length === 0) return false;
  return FOLLOWUP_HINT.test(planContent);
}
