import type { Metadata } from 'next';

import { SeatsClient } from './_components/seats-client';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Seats' };

export default function AdminSeatsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2lg font-semibold">Seats</h1>
      <SeatsClient />
    </div>
  );
}
