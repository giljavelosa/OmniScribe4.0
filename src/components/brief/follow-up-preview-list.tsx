import { SourcePill } from './source-pill';
import type { FollowUpPreview } from '@/types/brief';

/**
 * FollowUpPreviewList — read-only display of open follow-ups for the
 * /prepare surface. /capture wraps the same data in FollowUpQuickAction
 * with Met / Drop / Carry chips.
 */
export function FollowUpPreviewList({ followUps }: { followUps: FollowUpPreview[] }) {
  if (followUps.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No open follow-ups from prior visits.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {followUps.map((fu) => (
        <li key={fu.followUpId} className="flex items-start gap-2">
          <span aria-hidden="true" className="mt-[2px] text-muted-foreground">○</span>
          <div className="flex-1">
            <p className="text-sm">{fu.text}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">from</span>
              <SourcePill noteId={fu.source.noteId} date={fu.source.date} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
