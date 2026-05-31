import { Skeleton } from '@/components/ui/skeleton';

/**
 * Route-level loading shell for the patient chart. The page is
 * `force-dynamic` and awaits a Promise.all, so without this the router
 * shows the previous screen then a white gap. This renders the dashboard
 * silhouette instantly. Geometry mirrors PatientChartTabs (same
 * `mx-auto max-w-6xl px-4` wrappers + min-heights) so the hand-off to real
 * content doesn't shift. Reduced-motion is honored globally.
 */
export default function PatientChartLoading() {
  return (
    <div aria-busy="true" aria-label="Loading patient chart">
      {/* Sticky identity header silhouette */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b">
        <div className="mx-auto max-w-6xl px-4 py-3">
          <div className="flex items-start gap-3">
            <Skeleton className="size-12 shrink-0 rounded-full" />
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <Skeleton className="h-5 w-44" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-9 w-28 rounded-md" />
              </div>
            </div>
          </div>
          <Skeleton className="mt-3 h-7 w-full rounded-md" />
        </div>
      </div>

      {/* Tab rail + Overview grid silhouette */}
      <div className="mx-auto max-w-6xl px-4 py-5 space-y-5">
        <div className="flex gap-1.5">
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-20 rounded-md" />
          <Skeleton className="h-9 w-20 rounded-md" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:items-start">
          {/* Vitals board */}
          <div className="min-w-0 lg:col-span-8">
            <div className="rounded-xl border bg-card p-5 shadow-sm min-h-[var(--min-card-h-board)] space-y-4">
              <div className="flex items-center gap-2.5">
                <Skeleton className="size-8 rounded-lg" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-2.5 w-24" />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-2.5 w-12" />
                    <Skeleton className="h-6 w-16" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Intelligence rail */}
          <div className="min-w-0 lg:col-span-4 space-y-4">
            <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3 min-h-[var(--min-card-h-rail)]">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-9 w-full rounded-lg" />
              <Skeleton className="h-9 w-full rounded-lg" />
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm space-y-2">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
