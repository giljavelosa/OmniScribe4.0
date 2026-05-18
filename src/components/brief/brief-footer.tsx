import { StatusBadge } from '@/components/ui/status-badge';

/**
 * BriefFooter — generation timestamp + version chip + provenance hint.
 * Surfaces the trust signal: the clinician sees how fresh the brief is and
 * which model produced it. Stale (>30 days old) gets a warning chip.
 *
 * Pure: takes daysOld + a pre-formatted relative label from the caller so
 * the component doesn't call Date.now() at render time (React 19 purity rule).
 */
export function BriefFooter({
  generatorVersion,
  sourceNoteCount,
  daysOld,
  relativeLabel,
}: {
  generatorVersion: string;
  sourceNoteCount: number;
  daysOld: number;
  /** Pre-computed label, e.g. "today", "2 days ago", "Mar 14, 2026" */
  relativeLabel: string;
}) {
  const stale = daysOld > 30;
  const isFallback = generatorVersion.includes('fallback');

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
      <span>
        Brief generated {relativeLabel} · {sourceNoteCount} signed note
        {sourceNoteCount === 1 ? '' : 's'}
      </span>
      <StatusBadge
        variant={isFallback ? 'warning' : 'neutral'}
        noIcon
        className="text-[10px]"
      >
        {generatorVersion}
      </StatusBadge>
      {stale && (
        <StatusBadge variant="warning" noIcon className="text-[10px]">
          {daysOld} days old
        </StatusBadge>
      )}
      <span className="ml-auto italic">tap any line for source</span>
    </div>
  );
}

/**
 * Pure helper — call this from a server component or other non-render context
 * to compute (daysOld, relativeLabel) once, then pass into BriefFooter.
 */
export function formatBriefAge(generatedAt: string, nowMs: number): {
  daysOld: number;
  relativeLabel: string;
} {
  const date = new Date(generatedAt);
  const daysOld = Math.max(0, Math.floor((nowMs - date.getTime()) / 86_400_000));
  let relativeLabel: string;
  if (daysOld === 0) relativeLabel = 'today';
  else if (daysOld === 1) relativeLabel = 'yesterday';
  else if (daysOld < 7) relativeLabel = `${daysOld} days ago`;
  else if (daysOld < 30) relativeLabel = `${Math.round(daysOld / 7)} weeks ago`;
  else relativeLabel = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return { daysOld, relativeLabel };
}
