import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';

export type VisitHistoryRow = {
  id: string;
  signedAt: string | null;
  templateName: string | null;
  division: string;
  assessmentSnippet: string | null;
};

/**
 * VisitHistoryList — Unit 12. 10 most-recent SIGNED notes for the
 * patient with a 2-line assessment snippet per row + tap-through to
 * /review/[noteId]. Snippet derived server-side from finalJson (no
 * client-side note parsing).
 */
export function VisitHistoryList({ visits }: { visits: VisitHistoryRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-md">Visit history</CardTitle>
        <CardDescription>
          10 most-recent signed notes. Each row links to the signed note for full detail.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-0 p-0">
        {visits.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No signed visits yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {visits.map((v) => (
              <li key={v.id}>
                <Link
                  href={`/review/${v.id}`}
                  className="flex flex-col gap-1 px-4 py-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="font-medium truncate">
                        {v.signedAt
                          ? new Date(v.signedAt).toLocaleDateString(undefined, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })
                          : 'unsigned'}
                      </p>
                      <StatusBadge variant="neutral" noIcon>{v.division}</StatusBadge>
                      {v.templateName && (
                        <span className="text-xs text-muted-foreground truncate">
                          · {v.templateName}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">open ↗</span>
                  </div>
                  {v.assessmentSnippet && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {v.assessmentSnippet}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
