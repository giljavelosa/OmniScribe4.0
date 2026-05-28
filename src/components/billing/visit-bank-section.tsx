'use client';

import { useEffect, useState, useTransition } from 'react';

import { VisitRequestButton } from '@/components/billing/visit-request-button';
import { TrialStatusBanner } from '@/components/billing/trial-status-banner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBanner } from '@/components/ui/status-banner';

type CapacityView = {
  orgName?: string;
  visitBankBalance: number;
  visitWalletBalance: number;
  availableVisits: number;
  commercialModel: string | null;
  trialEndsAt: string | null;
  trialExpired?: boolean;
  trialDaysLeft?: number;
  trialUrgent?: boolean;
  contractEnd: string | null;
  allowUserVisitRequests: boolean;
  expiryWarning: { daysLeft: number; level: 'warn' | 'urgent' } | null;
};

export function VisitBankSection({ isOrgAdmin = false }: { isOrgAdmin?: boolean }) {
  const [data, setData] = useState<CapacityView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startLoad] = useTransition();

  useEffect(() => {
    startLoad(async () => {
      const res = await fetch('/api/account/capacity');
      if (!res.ok) {
        setError('Could not load visit capacity.');
        return;
      }
      const json = (await res.json()) as { data: CapacityView };
      setData(json.data);
    });
  }, []);

  if (error) {
    return <StatusBanner variant="danger">{error}</StatusBanner>;
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">Loading visit capacity…</p>
        </CardContent>
      </Card>
    );
  }

  if (!data.commercialModel) return null;

  return (
    <div className="space-y-3">
      {data.trialExpired && (
        <TrialStatusBanner
          trialEndsAt={data.trialEndsAt}
          isOrgAdmin={isOrgAdmin}
          expired
        />
      )}

      {!data.trialExpired && data.trialEndsAt && data.trialDaysLeft != null && (
        <TrialStatusBanner
          trialEndsAt={data.trialEndsAt}
          isOrgAdmin={isOrgAdmin}
          daysLeft={data.trialDaysLeft}
          urgent={data.trialUrgent ?? false}
        />
      )}

      {data.expiryWarning && (
        <StatusBanner
          variant={data.expiryWarning.level === 'urgent' ? 'danger' : 'warning'}
        >
          {data.expiryWarning.level === 'urgent'
            ? `Your org contract ends in ${data.expiryWarning.daysLeft} day${data.expiryWarning.daysLeft === 1 ? '' : 's'}. Contact your admin to renew.`
            : `Your org contract ends in ${data.expiryWarning.daysLeft} days.`}
        </StatusBanner>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Visit capacity</CardTitle>
          <CardDescription>
            {data.orgName ?? 'Your org'} — visits available before starting a new encounter.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Available to you</p>
              <p className="text-2xl font-mono tabular-nums">
                {data.availableVisits.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Your wallet</p>
              <p className="text-2xl font-mono tabular-nums">
                {data.visitWalletBalance.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Org bank (shared)</p>
              <p className="text-2xl font-mono tabular-nums">
                {data.visitBankBalance.toLocaleString()}
              </p>
            </div>
          </div>

          {data.allowUserVisitRequests && (
            <VisitRequestButton disabled={data.availableVisits > 10} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
