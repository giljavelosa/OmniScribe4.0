import type { Metadata } from 'next';
import { Suspense } from 'react';

import { BillingClient } from './_components/billing-client';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Billing' };

export default function AdminBillingPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2lg font-semibold">Billing</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <BillingClient />
      </Suspense>
    </div>
  );
}
