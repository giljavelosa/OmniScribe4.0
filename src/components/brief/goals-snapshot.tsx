import { SourcePill } from './source-pill';
import { StatusBadge } from '@/components/ui/status-badge';
import type { GoalSnippet } from '@/types/brief';

/**
 * GoalsSnapshot — top-priority active goals (≤3) with status + delta chip.
 * Source pill links to the origin note.
 */
export function GoalsSnapshot({ goals }: { goals: GoalSnippet[] }) {
  if (goals.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No active goals on file in source notes.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {goals.map((g) => {
        const arrow = goalArrow(g.status);
        return (
          <li key={g.text + g.originNoteId} className="space-y-0.5">
            <div className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-[2px] text-muted-foreground">
                {arrow}
              </span>
              <p className="flex-1 text-sm">{g.text}</p>
              {g.delta && (
                <StatusBadge
                  variant={goalDeltaVariant(g.status)}
                  noIcon
                  className="ml-2 shrink-0"
                >
                  {g.delta}
                </StatusBadge>
              )}
            </div>
            <div className="ml-5 flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {g.status}
              </span>
              <SourcePill noteId={g.originNoteId} date="" label="source" />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function goalArrow(status: GoalSnippet['status']): string {
  switch (status) {
    case 'met':
      return '✓';
    case 'carried':
      return '→';
    case 'active':
    default:
      return '○';
  }
}

function goalDeltaVariant(
  status: GoalSnippet['status'],
): 'success' | 'warning' | 'info' | 'neutral' {
  switch (status) {
    case 'met':
      return 'success';
    case 'carried':
      return 'info';
    case 'active':
    default:
      return 'neutral';
  }
}
