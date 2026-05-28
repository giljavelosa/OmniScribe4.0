'use client';

import { useEffect, useState, useTransition } from 'react';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge, type StatusBadgeProps } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';

type OrgRole = 'ORG_ADMIN' | 'SITE_ADMIN' | 'CLINICIAN' | 'VIEWER';

type Seat = {
  id: string;
  tier: 'SOLO' | 'TEAM' | 'ENTERPRISE';
  expiresAt: string;
  createdAt: string;
  assignedToOrgUserId: string | null;
  assignedToEmail: string | null;
  assignedToRole: OrgRole | null;
};

const ROLE_ORDER: Record<OrgRole, number> = {
  ORG_ADMIN: 0,
  SITE_ADMIN: 1,
  CLINICIAN: 2,
  VIEWER: 3,
};

const ROLE_LABEL: Record<OrgRole, string> = {
  ORG_ADMIN: 'Org admin',
  SITE_ADMIN: 'Site admin',
  CLINICIAN: 'Clinician',
  VIEWER: 'Viewer',
};

const ROLE_VARIANT: Record<OrgRole, StatusBadgeProps['variant']> = {
  ORG_ADMIN: 'violet',
  SITE_ADMIN: 'info',
  CLINICIAN: 'neutral',
  VIEWER: 'neutral',
};

type Summary = { totalSeats: number; assignedSeats: number };

export function OwnerSeatsCard({ orgId }: { orgId: string }) {
  const [seats, setSeats] = useState<Seat[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [stripeStubMode, setStripeStubMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [allocating, setAllocating] = useState(false);

  function load() {
    setError(null);
    startLoading(async () => {
      const res = await fetch(`/api/owner/orgs/${orgId}/seats`);
      if (!res.ok) {
        setError('Failed to load seats.');
        return;
      }
      const json = (await res.json()) as {
        data: Seat[];
        summary: Summary;
        stripeStubMode: boolean;
      };
      setSeats(json.data);
      setSummary(json.summary);
      setStripeStubMode(json.stripeStubMode);
    });
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-md">Seats</CardTitle>
            <CardDescription>
              {summary
                ? `${summary.totalSeats} total · ${summary.assignedSeats} assigned`
                : 'Loading…'}
            </CardDescription>
          </div>
          <Button onClick={() => setAllocating(true)} disabled={loading}>
            <Plus className="size-4" aria-hidden="true" />
            Allocate
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {stripeStubMode && (
            <StatusBanner variant="info">
              Stripe in stub mode — allocations are persisted + audited; the real
              subscription update lands when STRIPE_SECRET_KEY is configured.
            </StatusBanner>
          )}
          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
          {seats.length === 0 ? (
            <p className="text-sm text-muted-foreground">No seats allocated yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {[...seats]
                .sort((a, b) => {
                  // Unassigned seats sink to the bottom; otherwise sort by
                  // role (org admins first), then email.
                  const aRole = a.assignedToRole;
                  const bRole = b.assignedToRole;
                  if (aRole === null && bRole === null) return 0;
                  if (aRole === null) return 1;
                  if (bRole === null) return -1;
                  const roleDiff = ROLE_ORDER[aRole] - ROLE_ORDER[bRole];
                  if (roleDiff !== 0) return roleDiff;
                  return (a.assignedToEmail ?? '').localeCompare(b.assignedToEmail ?? '');
                })
                .map((s) => (
                  <li key={s.id} className="flex items-center gap-2">
                    {s.assignedToRole ? (
                      <StatusBadge variant={ROLE_VARIANT[s.assignedToRole]} noIcon>
                        {ROLE_LABEL[s.assignedToRole]}
                      </StatusBadge>
                    ) : (
                      <StatusBadge variant="neutral" noIcon>
                        Unassigned
                      </StatusBadge>
                    )}
                    <span className="font-mono text-xs">
                      {s.assignedToEmail ?? '(unassigned)'}
                    </span>
                    <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="rounded border border-border px-1.5 py-0.5 uppercase tracking-wide">
                        {s.tier}
                      </span>
                      <span>expires {new Date(s.expiresAt).toLocaleDateString()}</span>
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {allocating && (
        <AllocateSheet
          orgId={orgId}
          onClose={() => setAllocating(false)}
          onAllocated={() => { setAllocating(false); load(); }}
        />
      )}
    </>
  );
}

function AllocateSheet({
  orgId,
  onClose,
  onAllocated,
}: {
  orgId: string;
  onClose: () => void;
  onAllocated: () => void;
}) {
  const [tier, setTier] = useState<'SOLO' | 'TEAM' | 'ENTERPRISE'>('TEAM');
  const [count, setCount] = useState(1);
  const [expiresAt, setExpiresAt] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/owner/orgs/${orgId}/seats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier,
          count,
          expiresAt: new Date(expiresAt).toISOString(),
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error?.message ?? `Allocate failed (${res.status}).`);
        return;
      }
      onAllocated();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <CardHeader>
          <CardTitle className="text-md">Allocate seats</CardTitle>
          <CardDescription>For this org. Auditable both on the org side and the platform side.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Tier</Label>
            <Select value={tier} onValueChange={(v) => setTier(v as 'SOLO' | 'TEAM' | 'ENTERPRISE')}>
              <SelectTrigger disabled={pending}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SOLO">Solo</SelectItem>
                <SelectItem value="TEAM">Team</SelectItem>
                <SelectItem value="ENTERPRISE">Enterprise</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="osc-count">Count</Label>
            <Input id="osc-count" type="number" min={1} max={500} value={count} onChange={(e) => setCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} disabled={pending} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="osc-expires">Expires</Label>
            <Input id="osc-expires" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} disabled={pending} />
          </div>
          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="button" onClick={submit} disabled={pending}>
              {pending ? 'Allocating…' : `Allocate ${count} seat${count === 1 ? '' : 's'}`}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
