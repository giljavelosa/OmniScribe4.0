import type { Metadata } from 'next';

import { HealthClient } from './_components/health-client';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Owner — health' };

export default function OwnerHealthPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <div className="space-y-4 pb-6">
      <h1 className="text-2lg font-semibold">Health</h1>
      <HealthClient />
      </div>
    </div>
  );
}
