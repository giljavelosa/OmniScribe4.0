import type { Metadata } from 'next';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OpsQueuesClient } from './_components/ops-queues-client';

export const metadata: Metadata = { title: 'Ops Queues' };
export const dynamic = 'force-dynamic';

/**
 * /ops/queues — Unit 33 BullMQ queue depth view.
 *
 * Per-queue waiting/active/failed/completed/delayed counts. Polls
 * `/api/ops/queues` every 30 seconds. Rows for unreachable queues
 * show "Redis unavailable" in the detail column.
 */
export default function OpsQueuesPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2lg font-semibold">Queue Depths</h1>
        <p className="text-sm text-muted-foreground">
          BullMQ counts per queue. Surface for triaging backed-up workers
          and runaway failed-job sets.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-md">Live queue counts</CardTitle>
        </CardHeader>
        <CardContent>
          <OpsQueuesClient />
        </CardContent>
      </Card>
    </div>
  );
}
