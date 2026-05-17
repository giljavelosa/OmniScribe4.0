'use client';

import { useEffect, useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type Seat = {
  id: string;
  tier: 'SOLO' | 'TEAM' | 'ENTERPRISE';
  expiresAt: string;
  createdAt: string;
  assignedToOrgUserId: string | null;
  assignedToEmail: string | null;
};

type Summary = {
  totalSeats: number;
  assignedSeats: number;
  byTier: Record<string, number>;
};

type Props = {
  /** When true, hides the "Allocate seats" button. /admin/seats sees the
   *  list but only the owner console allocates new seats. */
  readOnly?: boolean;
};

export function SeatsClient({ readOnly = false }: Props) {
  const [seats, setSeats] = useState<Seat[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [stripeStubMode, setStripeStubMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [allocating, setAllocating] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);

  function load() {
    setError(null);
    startLoading(async () => {
      const res = await fetch('/api/admin/seats');
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
  }, []);

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
          {!readOnly && (
            <Button onClick={() => setAllocating(true)} disabled={loading}>
              <Plus className="size-4" aria-hidden="true" />
              Allocate seats
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {stripeStubMode && (
            <StatusBanner variant="info">
              Stripe is in stub mode (no STRIPE_SECRET_KEY). Seat allocations are persisted
              and audited, but the real billing subscription update is deferred until the
              integration lands.
            </StatusBanner>
          )}
          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
          {summary && (
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(summary.byTier).map(([tier, count]) => (
                <StatusBadge key={tier} variant="neutral" noIcon>
                  {tier}: {count}
                </StatusBadge>
              ))}
            </div>
          )}

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="text-left px-3 py-2 font-medium">Tier</th>
                  <th className="text-left px-3 py-2 font-medium">Assigned to</th>
                  <th className="text-left px-3 py-2 font-medium">Expires</th>
                  <th className="text-left px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {seats.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      {loading ? 'Loading…' : 'No seats allocated yet.'}
                    </td>
                  </tr>
                ) : (
                  seats.map((s) => (
                    <tr key={s.id} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2"><StatusBadge variant="neutral" noIcon>{s.tier}</StatusBadge></td>
                      <td className="px-3 py-2 font-mono text-[11px]">{s.assignedToEmail ?? <span className="text-muted-foreground italic">unassigned</span>}</td>
                      <td className="px-3 py-2 text-muted-foreground">{new Date(s.expiresAt).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-muted-foreground">{new Date(s.createdAt).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-right">
                        {!readOnly && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setRevokeId(s.id)}
                            disabled={loading}
                            aria-label={`Revoke seat ${s.id}`}
                          >
                            <Trash2 className="size-4 text-[var(--status-danger-fg)]" aria-hidden="true" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {allocating && !readOnly && (
        <AllocateSheet onClose={() => setAllocating(false)} onAllocated={() => { setAllocating(false); load(); }} />
      )}
      <RevokeConfirm
        id={revokeId}
        onCancel={() => setRevokeId(null)}
        onRevoked={() => { setRevokeId(null); load(); }}
      />
    </>
  );
}

function AllocateSheet({ onClose, onAllocated }: { onClose: () => void; onAllocated: () => void }) {
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
      const res = await fetch('/api/admin/seats', {
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
          <CardDescription>Subscription will recalculate to match the new total.</CardDescription>
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
            <Label htmlFor="seat-count">Count</Label>
            <Input id="seat-count" type="number" min={1} max={500} value={count} onChange={(e) => setCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} disabled={pending} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="seat-expires">Expires</Label>
            <Input id="seat-expires" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} disabled={pending} />
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

function RevokeConfirm({
  id,
  onCancel,
  onRevoked,
}: {
  id: string | null;
  onCancel: () => void;
  onRevoked: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    if (!id) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/admin/seats/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error?.message ?? `Revoke failed (${res.status}).`);
        return;
      }
      onRevoked();
    });
  }

  return (
    <AlertDialog open={!!id} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke this seat?</AlertDialogTitle>
          <AlertDialogDescription>
            If the seat is currently assigned, the assignee loses their seat. The action is
            audited.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <StatusBanner variant="danger">{error}</StatusBanner>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={pending} className="bg-destructive text-white hover:bg-destructive/90">
            {pending ? 'Revoking…' : 'Revoke seat'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
