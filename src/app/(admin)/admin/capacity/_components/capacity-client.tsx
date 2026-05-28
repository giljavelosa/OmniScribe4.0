'use client';

import { useEffect, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBanner } from '@/components/ui/status-banner';
import { TrialStatusBanner } from '@/components/billing/trial-status-banner';
import { contractExpiryWarning } from '@/lib/billing/monthly-allowance';
import { getTrialExpiryState } from '@/lib/billing/commercial-mode';

type UserRow = {
  orgUserId: string;
  email: string;
  role: string;
  visitWalletBalance: number;
};

type PendingRequest = {
  id: string;
  requesterEmail: string;
  requestedVisits: number;
  message: string | null;
};

type CapacityState = {
  orgName: string;
  visitBankBalance: number;
  users: UserRow[];
  pendingRequests: PendingRequest[];
  contract: {
    commercialModel: string;
    contractEnd: string | null;
    trialEndsAt: string | null;
  } | null;
};

export function CapacityClient() {
  const [state, setState] = useState<CapacityState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [, startLoad] = useTransition();
  const [pending, startAction] = useTransition();

  function load() {
    setError(null);
    startLoad(async () => {
      const res = await fetch('/api/admin/capacity');
      if (!res.ok) {
        setError('Failed to load capacity.');
        return;
      }
      const json = (await res.json()) as {
        data: CapacityState & {
          contract?: {
            commercialModel: string;
            contractEnd: string | Date | null;
            trialEndsAt: string | Date | null;
          } | null;
        };
      };
      const raw = json.data;
      setState({
        orgName: raw.orgName,
        visitBankBalance: raw.visitBankBalance,
        users: raw.users,
        pendingRequests: raw.pendingRequests,
        contract: raw.contract
          ? {
              commercialModel: raw.contract.commercialModel,
              contractEnd: raw.contract.contractEnd
                ? new Date(raw.contract.contractEnd).toISOString()
                : null,
              trialEndsAt: raw.contract.trialEndsAt
                ? new Date(raw.contract.trialEndsAt).toISOString()
                : null,
            }
          : null,
      });
    });
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  function runTransfer(action: 'allocate' | 'reclaim', orgUserId: string) {
    const amount = Number(amounts[orgUserId] ?? '0');
    if (!Number.isFinite(amount) || amount < 1) return;
    setError(null);
    startAction(async () => {
      const res = await fetch('/api/admin/capacity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, orgUserId, amount }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } };
        setError(json.error?.message ?? 'Transfer failed.');
        return;
      }
      load();
    });
  }

  function resolveRequest(id: string, action: 'approve' | 'deny') {
    startAction(async () => {
      const res = await fetch(`/api/admin/capacity/requests/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        setError('Could not resolve request.');
        return;
      }
      load();
    });
  }

  if (!state) {
    return <p className="text-sm text-muted-foreground">Loading capacity…</p>;
  }

  const expiry = state.contract?.contractEnd
    ? contractExpiryWarning(new Date(state.contract.contractEnd))
    : { level: 'none' as const, daysLeft: Infinity };

  const trialExpiry = state.contract
    ? getTrialExpiryState({
        commercialModel: state.contract.commercialModel,
        trialEndsAt: state.contract.trialEndsAt
          ? new Date(state.contract.trialEndsAt)
          : null,
      } as Parameters<typeof getTrialExpiryState>[0])
    : null;

  return (
    <div className="space-y-6">
      {error && <StatusBanner variant="danger">{error}</StatusBanner>}

      {trialExpiry && (
        <TrialStatusBanner
          trialEndsAt={state.contract?.trialEndsAt ?? null}
          isOrgAdmin
          expired={trialExpiry.expired}
          daysLeft={trialExpiry.daysLeft}
          urgent={trialExpiry.urgent}
        />
      )}

      {expiry.level !== 'none' && (
        <StatusBanner variant={expiry.level === 'urgent' ? 'danger' : 'warning'}>
          Contract ends in {expiry.daysLeft} day{expiry.daysLeft === 1 ? '' : 's'}
          {state.contract?.contractEnd
            ? ` (${new Date(state.contract.contractEnd).toLocaleDateString()})`
            : ''}
          . Renew via your owner contact or purchase a plan under Billing.
        </StatusBanner>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Org visit bank</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-mono tabular-nums">
            {state.visitBankBalance.toLocaleString()} visits
          </p>
          <p className="text-sm text-muted-foreground mt-1">{state.orgName}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">User wallets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.users.map((u) => (
            <div
              key={u.orgUserId}
              className="flex flex-wrap items-end gap-3 border-b border-border pb-3 last:border-0"
            >
              <div className="min-w-[200px]">
                <p className="text-sm font-medium">{u.email}</p>
                <p className="text-xs text-muted-foreground">
                  {u.role} · wallet {u.visitWalletBalance}
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Amount</Label>
                <Input
                  className="w-24"
                  type="number"
                  min={1}
                  value={amounts[u.orgUserId] ?? '10'}
                  onChange={(e) =>
                    setAmounts((prev) => ({ ...prev, [u.orgUserId]: e.target.value }))
                  }
                />
              </div>
              <Button
                size="sm"
                disabled={pending}
                onClick={() => runTransfer('allocate', u.orgUserId)}
              >
                Allocate
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => runTransfer('reclaim', u.orgUserId)}
              >
                Reclaim
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {state.pendingRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-md">Pending visit requests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {state.pendingRequests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 text-sm">
                <span>
                  {r.requesterEmail} — {r.requestedVisits} visits
                  {r.message ? `: ${r.message}` : ''}
                </span>
                <Button size="sm" disabled={pending} onClick={() => resolveRequest(r.id, 'approve')}>
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => resolveRequest(r.id, 'deny')}
                >
                  Deny
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
