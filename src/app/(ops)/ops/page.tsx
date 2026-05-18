import type { Metadata } from 'next';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OpsDashboardClient } from './_components/ops-dashboard-client';

export const metadata: Metadata = { title: 'Ops Dashboard' };
export const dynamic = 'force-dynamic';

/**
 * /ops — Unit 33 platform-wide ops dashboard.
 *
 * Server shell + client fetch loop. Server component is intentionally
 * thin: layout enforces the PLATFORM_STAFF gate, the client polls
 * `/api/ops/dashboard` at a 30s cadence so cache hits halve the audit
 * row volume (cache TTL is 60s).
 */
export default function OpsDashboardPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2lg font-semibold">Ops Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Platform-wide metrics. Refreshes every 30 seconds; backend cache
          TTL is 60 seconds so adjacent reads share the same computation.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-md">Live metrics</CardTitle>
        </CardHeader>
        <CardContent>
          <OpsDashboardClient />
        </CardContent>
      </Card>
    </div>
  );
}
