import type { Metadata } from 'next';

import { CapacityClient } from './_components/capacity-client';

export const metadata: Metadata = { title: 'Visit capacity' };

export default function AdminCapacityPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2lg font-semibold">Visit capacity</h1>
        <p className="text-sm text-muted-foreground">
          Manage the org visit bank, allocate visits to clinicians, and resolve visit requests.
        </p>
      </header>
      <CapacityClient />
    </div>
  );
}
