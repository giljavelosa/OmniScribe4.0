'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RotateCw, Unplug } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
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

type Props = {
  id: string;
  ehrSystem: string;
  fhirBaseUrl: string;
  scope: string;
  expiresAtIso: string;
  refreshedAtIso: string | null;
  hasLaunchPatient: boolean;
  clinicianName: string;
  /** Server-rendered request time. Passed in so the row's pure-function
   *  render doesn't reach for Date.now() (React 19 purity rule). The 5-min
   *  "expiring soon" threshold is computed against this snapshot. */
  nowMs: number;
};

/**
 * One row in the active-connections list. Owns the disconnect and
 * refresh action buttons. Disconnect goes through an AlertDialog
 * (rule 22 — no native confirm in admin surfaces).
 */
export function FhirIdentityRow({
  id,
  ehrSystem,
  fhirBaseUrl,
  scope,
  expiresAtIso,
  refreshedAtIso,
  hasLaunchPatient,
  clinicianName,
  nowMs,
}: Props) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshPending, startRefresh] = useTransition();
  const [disconnectPending, startDisconnect] = useTransition();

  const expiresAt = new Date(expiresAtIso);
  const expiringSoon = expiresAt.getTime() - nowMs < 5 * 60 * 1000;
  const expired = expiresAt.getTime() < nowMs;
  const refreshedLabel = refreshedAtIso
    ? `last refreshed ${new Date(refreshedAtIso).toLocaleString()}`
    : 'never refreshed';

  function refresh() {
    setError(null);
    startRefresh(async () => {
      const res = await fetch(`/api/admin/integrations/fhir/${id}/refresh`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(body?.error?.message ?? `refresh failed (${res.status})`);
        return;
      }
      router.refresh();
    });
  }

  function disconnect() {
    setError(null);
    startDisconnect(async () => {
      const res = await fetch(`/api/admin/integrations/fhir/${id}/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'admin_initiated' }),
      });
      if (!res.ok) {
        setError(`disconnect failed (${res.status})`);
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="rounded-md border border-border p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium">{clinicianName}</p>
            <StatusBadge variant="neutral" noIcon>{ehrSystem}</StatusBadge>
            {hasLaunchPatient && (
              <StatusBadge variant="info" noIcon>Patient context</StatusBadge>
            )}
            {expired ? (
              <StatusBadge variant="danger" noIcon>Expired</StatusBadge>
            ) : expiringSoon ? (
              <StatusBadge variant="warning" noIcon>Expiring soon</StatusBadge>
            ) : (
              <StatusBadge variant="success" noIcon>Active</StatusBadge>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-mono truncate">{fhirBaseUrl}</p>
          <p className="text-xs text-muted-foreground">
            Expires {expiresAt.toLocaleString()} · {refreshedLabel}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={refreshPending}
            className="gap-1"
          >
            {refreshPending ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <RotateCw className="h-3 w-3" aria-hidden />
            )}
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={disconnectPending}
            className="gap-1"
          >
            <Unplug className="h-3 w-3" aria-hidden />
            Disconnect
          </Button>
        </div>
      </div>
      {scope && (
        <p className="text-[11px] text-muted-foreground font-mono break-all">scope: {scope}</p>
      )}
      {error && <p className="text-xs text-[var(--status-danger-fg)]">⚠ {error}</p>}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {ehrSystem} for {clinicianName}?</AlertDialogTitle>
            <AlertDialogDescription>
              The encrypted access + refresh tokens will be wiped. The clinician will need to
              re-launch from their EHR to re-authorize. This action is audited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnectPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={disconnect} disabled={disconnectPending}>
              {disconnectPending ? 'Disconnecting…' : 'Disconnect'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
