/**
 * stripJsonFence — strip ```json … ``` (or bare ``` … ```) wrappers from
 * an LLM response so the downstream JSON.parse can run on the inner text.
 *
 * Sonnet 4.5 and Haiku 4.5 habitually wrap JSON output in markdown code
 * fences even when given `jsonMode: true` AND an explicit "no markdown
 * fences" system-prompt instruction. Without unwrapping:
 *   • BriefGenerator throws and BullMQ exhausts retries (snapshot strip
 *     never populates).
 *   • FollowupExtractor silently returns { items: [] } (follow-ups never
 *     created).
 *   • Post-sign artifact parser silently falls back to stub placeholder
 *     (referral letters / patient instructions render as stub text).
 *   • Copilot draft parser silently returns null.
 *
 * Sole canonical fence stripper for the codebase. Per-parser regex
 * duplicates were converging on the same pattern with slightly different
 * semantics — having one helper means only one place to update if
 * future models change their fencing behavior.
 *
 * Behavior:
 *   • No-op on already-unfenced input.
 *   • Strips opener and closer independently, so a truncated response
 *     (opener present, closer missing because maxTokens cut it off) still
 *     hands the parse step usable JSON (which may itself fail on
 *     truncation — that's a separate, expected failure mode).
 *   • Case-insensitive on the `json` language tag.
 *   • Tolerates CRLF or LF line endings + surrounding whitespace.
 */
export function stripJsonFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*\r?\n?/i, '')
    .replace(/\r?\n?```\s*$/i, '')
    .trim();
}
