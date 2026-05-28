'use client';

import { useEffect, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBanner } from '@/components/ui/status-banner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CommercialModel } from '@prisma/client';

type CommercialData = {
  visitBankBalance: number;
  catalogDefaults?: {
    seatPriceCents: number;
    visitsPerSeatPerMonth: number;
    committedSeats: number;
  };
  contract: {
    commercialModel: CommercialModel;
    committedSeats: number;
    visitsPerSeatPerMonth: number | null;
    seatPriceCents: number | null;
    contractEnd: string | null;
    capacityEnforcementEnabled: boolean;
  };
};

export function CommercialContractCard({ orgId }: { orgId: string }) {
  const [data, setData] = useState<CommercialData | null>(null);
  const [creditAmount, setCreditAmount] = useState('1000');
  const [creditReason, setCreditReason] = useState('Manual top-up');
  const [error, setError] = useState<string | null>(null);
  const [, startLoad] = useTransition();
  const [pending, startSave] = useTransition();

  function load() {
    startLoad(async () => {
      const res = await fetch(`/api/owner/orgs/${orgId}/commercial`);
      if (!res.ok) {
        setError('Failed to load commercial contract.');
        return;
      }
      const json = (await res.json()) as { data: CommercialData };
      setData(json.data);
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load is stable; orgId is the trigger
  }, [orgId]);

  function creditBank() {
    setError(null);
    startSave(async () => {
      const res = await fetch(`/api/owner/orgs/${orgId}/commercial/credit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(creditAmount),
          reason: creditReason,
        }),
      });
      if (!res.ok) {
        setError('Credit failed.');
        return;
      }
      load();
    });
  }

  if (!data) return <p className="text-sm text-muted-foreground">Loading commercial…</p>;

  return (
    <div className="space-y-4 text-sm">
      {error && <StatusBanner variant="danger">{error}</StatusBanner>}
      <p>
        <span className="text-muted-foreground">Bank balance:</span>{' '}
        <span className="font-mono">{data.visitBankBalance.toLocaleString()}</span>
      </p>
      <div className="space-y-2">
        <Label>Commercial model</Label>
        <Select
          value={data.contract.commercialModel}
          onValueChange={(v) =>
            setData((d) =>
              d
                ? {
                    ...d,
                    contract: { ...d.contract, commercialModel: v as CommercialModel },
                  }
                : d,
            )
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.values(CommercialModel).map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Committed seats</Label>
          <Input
            type="number"
            value={data.contract.committedSeats}
            onChange={(e) =>
              setData((d) =>
                d
                  ? {
                      ...d,
                      contract: { ...d.contract, committedSeats: Number(e.target.value) },
                    }
                  : d,
              )
            }
          />
        </div>
        <div className="space-y-1">
          <Label>Visits / seat / month</Label>
          <Input
            type="number"
            value={data.contract.visitsPerSeatPerMonth ?? ''}
            onChange={(e) =>
              setData((d) =>
                d
                  ? {
                      ...d,
                      contract: {
                        ...d.contract,
                        visitsPerSeatPerMonth: Number(e.target.value) || null,
                      },
                    }
                  : d,
              )
            }
          />
        </div>
      </div>
      {data.catalogDefaults && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            setData((d) =>
              d && d.catalogDefaults
                ? {
                    ...d,
                    contract: {
                      ...d.contract,
                      committedSeats: d.catalogDefaults.committedSeats,
                      seatPriceCents: d.catalogDefaults.seatPriceCents,
                      visitsPerSeatPerMonth: d.catalogDefaults.visitsPerSeatPerMonth,
                    },
                  }
                : d,
            )
          }
        >
          Apply catalog enterprise defaults
        </Button>
      )}
      <Button
        disabled={pending}
        onClick={() => {
          startSave(async () => {
            const res = await fetch(`/api/owner/orgs/${orgId}/commercial`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data.contract),
            });
            if (!res.ok) setError('Save failed.');
            else load();
          });
        }}
      >
        Save contract
      </Button>
      <div className="border-t border-border pt-4 space-y-2">
        <Label>Credit visit bank</Label>
        <div className="flex gap-2">
          <Input type="number" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} />
          <Input value={creditReason} onChange={(e) => setCreditReason(e.target.value)} />
          <Button variant="outline" disabled={pending} onClick={creditBank}>
            Credit
          </Button>
        </div>
      </div>
    </div>
  );
}
