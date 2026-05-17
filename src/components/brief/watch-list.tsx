import type { PriorContextBriefContent } from '@/types/brief';

/**
 * WatchList — four sub-arrays from the prior clinician's note:
 *   - recentMedChanges
 *   - recentResults
 *   - precautions
 *   - redFlagsFromPriorNote
 *
 * Each surfaces as a small chip group with a category label. If everything
 * is empty, the component returns null so the caller can drop the section.
 */
export function WatchList({ watch }: { watch: PriorContextBriefContent['watch'] }) {
  const groups: Array<{ label: string; items: string[] }> = [
    { label: 'Med changes', items: watch.recentMedChanges },
    { label: 'Recent results', items: watch.recentResults },
    { label: 'Precautions', items: watch.precautions },
    { label: 'Red flags', items: watch.redFlagsFromPriorNote },
  ].filter((g) => g.items.length > 0);

  if (groups.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No watch items flagged in prior notes.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{g.label}</p>
          <ul className="mt-1 space-y-1 text-sm">
            {g.items.map((item, i) => (
              <li key={`${g.label}-${i}`} className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-[3px] text-muted-foreground">•</span>
                <span className="flex-1">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function isWatchEmpty(watch: PriorContextBriefContent['watch']): boolean {
  return (
    watch.recentMedChanges.length === 0 &&
    watch.recentResults.length === 0 &&
    watch.precautions.length === 0 &&
    watch.redFlagsFromPriorNote.length === 0
  );
}
