import type { Metadata } from 'next';

import { HealthClient } from './_components/health-client';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Owner — health' };

export default function OwnerHealthPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2lg font-semibold">Health</h1>
      <HealthClient />
    </div>
  );
}
