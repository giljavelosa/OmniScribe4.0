'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, UserPlus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  isActive: boolean;
  expiresAt: string;
  createdAt: string;
  assignedToOrgUserId: string | null;
  assignedToName: string | null;
  assignedToEmail: string | null;
};

type AssignableUser = {
  orgUserId: string;
  name: string;
  email: string;
  role: string;
};

type Summary = {
  totalSeats: number;
  activeSeats: number;
  assignedSeats: number;
  byTier: Record<string, number>;
};

type SeatsResponse = {
  data: Seat[];
  assignableUsers: AssignableUser[];
  summary: Summary;
  stripeConfigured: boolean;
  stripeCustomerLinked: boolean;
};

/**
 * SeatsClient — the org-admin seat-management surface. Lists provisioned
 * seats and lets the admin assign each one to a clinician (or revoke it).
 * Seats are CREATED by the Stripe webhook, not here — purchasing capacity
 * happens on /admin/billing.
 */
export function SeatsClient() {
  const router = useRouter();
  const [seats, setSeats] = useState<Seat[]>([]);
  const [assignable, setAssignable] = useState<AssignableUser[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [assignSeatId, setAssignSeatId] = useState<string | null>(null);
  const [revokeSeatId, setRevokeSeatId] = useState<string | null>(null);

  function load() {
    setError(null);
    startLoading(async () => {
      const res = await fetch('/api/admin/seats');
      if (!res.ok) {
        setError('Failed to load seats.');
        return;
      }
      const json = (await res.json()) as SeatsResponse;
      setSeats(json.data);
      setAssignable(json.assignableUsers);
      setSummary(json.summary);
    });
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const revokeSeat = useMemo(
    () => seats.find((s) => s.id === revokeSeatId) ?? null,
    [seats, revokeSeatId],
  );

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-md">Seats</CardTitle>
            <CardDescription>
              {summary
                ? `${summary.activeSeats} active · ${summary.assignedSeats} assigned`
                : 'Loading…'}
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.push('/admin/billing')}
          >
            Manage subscription
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && <StatusBanner variant="danger">{error}</StatusBanner>}

          <p className="text-xs text-muted-foreground">
            A clinician needs an assigned seat to record and create notes. Seats come from your
            subscription — buy capacity on the billing page, then assign a seat to each
            clinician here. Org admins always have full access and never consume a seat.
          </p>

          {summary && seats.length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(summary.byTier).map(([tier, count]) => (
                <StatusBadge key={tier} variant="neutral" noIcon>
                  {tier}: {count}
                </StatusBadge>
              ))}
            </div>
          )}

          {seats.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              {loading
                ? 'Loading seats…'
                : 'No seats yet — start a subscription on the billing page to provision seats.'}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="text-left px-3 py-2 font-medium">Tier</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                    <th className="text-left px-3 py-2 font-medium">Assigned to</th>
                    <th className="text-left px-3 py-2 font-medium">Expires</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {seats.map((s) => (
                    <tr key={s.id} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2">
                        <StatusBadge variant="neutral" noIcon>
                          {s.tier}
                        </StatusBadge>
                      </td>
                      <td className="px-3 py-2">
                        {s.isActive ? (
                          <span className="text-[var(--status-success-fg)]">Active</span>
                        ) : (
                          <span className="text-muted-foreground">Inactive</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {s.assignedToOrgUserId ? (
                          <span>
                            {s.assignedToName ?? s.assignedToEmail}
                            {s.assignedToName && s.assignedToEmail && (
                              <span className="text-muted-foreground"> · {s.assignedToEmail}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">Unassigned</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {new Date(s.expiresAt).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {s.assignedToOrgUserId ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setRevokeSeatId(s.id)}
                            disabled={loading}
                            className="gap-1"
                          >
                            <X className="size-3" aria-hidden="true" />
                            Revoke
                          </Button>
                        ) : s.isActive ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setAssignSeatId(s.id)}
                            disabled={loading}
                            className="gap-1"
                          >
                            <UserPlus className="size-3" aria-hidden="true" />
                            Assign
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {assignSeatId && (
        <AssignModal
          seatId={assignSeatId}
          users={assignable}
          onClose={() => setAssignSeatId(null)}
          onAssigned={() => {
            setAssignSeatId(null);
            load();
          }}
        />
      )}

      <RevokeConfirm
        seat={revokeSeat}
        onCancel={() => setRevokeSeatId(null)}
        onRevoked={() => {
          setRevokeSeatId(null);
          load();
        }}
      />
    </>
  );
}

function AssignModal({
  seatId,
  users,
  onClose,
  onAssigned,
}: {
  seatId: string;
  users: AssignableUser[];
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [orgUserId, setOrgUserId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!orgUserId) {
      setError('Pick a team member to assign this seat to.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/admin/seats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'assign', seatId, orgUserId }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(payload?.error?.message ?? `Assign failed (${res.status}).`);
        return;
      }
      onAssigned();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <CardHeader>
          <CardTitle className="text-md">Assign seat</CardTitle>
          <CardDescription>
            The selected clinician can record and create notes as soon as the seat is assigned.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {users.length === 0 ? (
            <StatusBanner variant="info">
              Every non-admin member already holds a seat. Invite more teammates from the Users
              page, then come back to assign them.
            </StatusBanner>
          ) : (
            <div className="space-y-1.5">
              <Label>Team member</Label>
              <Select value={orgUserId} onValueChange={setOrgUserId}>
                <SelectTrigger disabled={pending}>
                  <SelectValue placeholder="Choose a member…" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.orgUserId} value={u.orgUserId}>
                      {u.name} · {u.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={pending || users.length === 0}
              className="gap-1"
            >
              <Check className="size-3" aria-hidden="true" />
              {pending ? 'Assigning…' : 'Assign seat'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RevokeConfirm({
  seat,
  onCancel,
  onRevoked,
}: {
  seat: Seat | null;
  onCancel: () => void;
  onRevoked: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    if (!seat) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/admin/seats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revoke', seatId: seat.id }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(payload?.error?.message ?? `Revoke failed (${res.status}).`);
        return;
      }
      onRevoked();
    });
  }

  return (
    <AlertDialog open={!!seat} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke this seat?</AlertDialogTitle>
          <AlertDialogDescription>
            {seat?.assignedToName ?? seat?.assignedToEmail ?? 'The current holder'} loses the
            ability to record and create notes. The seat returns to the unassigned pool — your
            subscription and billing are unchanged. The action is audited.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <StatusBanner variant="danger">{error}</StatusBanner>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirm}
            disabled={pending}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {pending ? 'Revoking…' : 'Revoke seat'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
