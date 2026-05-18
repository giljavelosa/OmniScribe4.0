import type { Metadata } from 'next';

import { HealthClient } from '@/app/(owner)/owner/health/_components/health-client';

export const metadata: Metadata = { title: 'Ops Health' };
export const dynamic = 'force-dynamic';

/**
 * /ops/health — Unit 33.
 *
 * Reuses the existing `HealthClient` (which calls `/api/owner/health`
 * — now PLATFORM_STAFF-gated, so PLATFORM_OPS can call it). Single
 * source for the UI shape; the only difference between this page and
 * `/owner/health` is which layout chrome wraps it.
 *
 * If `HealthClient` evolves (e.g. queue depths merge into the same
 * surface), both consoles pick the change up for free.
 */
export default function OpsHealthPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2lg font-semibold">System Health</h1>
        <p className="text-sm text-muted-foreground">
          Provider connectivity probes. Same checks as /owner/health; the
          gate is the only difference (PLATFORM_STAFF here, OWNER there).
        </p>
      </div>
      <HealthClient />
    </div>
  );
}
