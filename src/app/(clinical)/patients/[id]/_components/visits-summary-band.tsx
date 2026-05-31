import { Card, CardContent } from '@/components/ui/card';

type Stat = { label: string; value: number };

/**
 * VisitsSummaryBand — a compact stat strip above the visit history list.
 * Purely additive: surfaces counts the chart already derives (total signed,
 * per-division, late entries). Collapses when there are no signed visits so
 * the list's own empty state isn't doubled. Server-safe.
 */
export function VisitsSummaryBand({
  total,
  divisions,
  lateEntryCount,
}: {
  total: number;
  divisions: Stat[];
  lateEntryCount: number;
}) {
  if (total === 0) return null;

  const stats: Stat[] = [
    { label: total === 1 ? 'Signed visit' : 'Signed visits', value: total },
    ...divisions,
    ...(lateEntryCount > 0 ? [{ label: 'Late entries', value: lateEntryCount }] : []),
  ];

  return (
    <Card variant="quiet" className="gap-0 py-0">
      <CardContent className="px-4 py-3 flex flex-wrap gap-x-8 gap-y-3">
        {stats.map((s) => (
          <div key={s.label} className="space-y-0.5">
            <p className="text-2lg font-semibold tabular-nums leading-none">{s.value}</p>
            <p className="text-2xs uppercase tracking-wide text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
