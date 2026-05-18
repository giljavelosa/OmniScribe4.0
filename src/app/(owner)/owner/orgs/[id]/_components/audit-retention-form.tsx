'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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

type Props = {
  orgId: string;
  initial: { auditRetentionDays: number | null };
};

type PurgeResult = {
  retentionDays: number | null;
  cutoffDate: string | null;
  rowsDeleted: number;
  durationMs: number;
  skipped: 'no_retention' | 'no_rows_to_delete' | null;
};

/**
 * AuditRetentionForm — Unit 34.
 *
 * Owner-only card on the org page. Two controls:
 *   1. Toggle "Enforce retention" + numeric days input (30-3650).
 *      Submit PATCHes /api/owner/orgs/[id]/audit-retention → audit
 *      writes before/after via singleFieldChange.
 *   2. "Run purge now" → AlertDialog confirms → POSTs /audit-purge →
 *      shows the PurgeResult (rowsDeleted + duration) and refreshes
 *      the page so the transactions timeline picks up the AUDIT_PURGE_RUN
 *      receipt.
 *
 * Purge button disabled when retention is unset (server returns
 * 409 no_retention; UI prevents the round-trip).
 */
export function AuditRetentionForm({ orgId, initial }: Props) {
  const router = useRouter();
  const [enforced, setEnforced] = useState(initial.auditRetentionDays !== null);
  const [days, setDays] = useState<string>(String(initial.auditRetentionDays ?? 730));
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [purgeResult, setPurgeResult] = useState<PurgeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);

  const initialEnforced = initial.auditRetentionDays !== null;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const numDays = enforced ? Number.parseInt(days, 10) : null;
    if (enforced && (Number.isNaN(numDays ?? NaN) || numDays! < 30 || numDays! > 3650)) {
      setError('Days must be an integer between 30 and 3650.');
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/owner/orgs/${orgId}/audit-retention`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auditRetentionDays: numDays }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { code?: string } }
          | null;
        setError(body?.error?.code ?? `Save failed (${res.status})`);
        return;
      }
      setSavedAt(new Date().toLocaleTimeString());
      router.refresh();
    });
  }

  function runPurge() {
    setPurgeDialogOpen(false);
    setPurgeResult(null);
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/owner/orgs/${orgId}/audit-purge`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { code?: string } }
          | null;
        setError(body?.error?.code ?? `Purge failed (${res.status})`);
        return;
      }
      const body = (await res.json()) as { data: PurgeResult };
      setPurgeResult(body.data);
      router.refresh();
    });
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="flex items-center gap-3">
        <Switch
          id="ret-toggle"
          checked={enforced}
          onCheckedChange={setEnforced}
          disabled={pending}
        />
        <Label htmlFor="ret-toggle" className="cursor-pointer">
          Enforce audit retention
        </Label>
        {initial.auditRetentionDays === null && (
          <StatusBadge variant="neutral" noIcon className="text-[10px]">
            Currently: forever
          </StatusBadge>
        )}
      </div>
      {enforced && (
        <div className="space-y-2">
          <Label htmlFor="ret-days">Retention (days)</Label>
          <Input
            id="ret-days"
            type="number"
            min={30}
            max={3650}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            disabled={pending}
          />
          <p className="text-[11px] text-muted-foreground">
            30 (min) – 3650 (10 years). AuditLog rows older than N days are
            deleted on the next purge run. PlatformAuditLog (governance trail)
            + AUDIT_PURGE_RUN receipts are NEVER deleted.
          </p>
        </div>
      )}
      {error && <StatusBanner variant="danger">{error}</StatusBanner>}
      {savedAt && <StatusBanner variant="success">Saved at {savedAt}.</StatusBanner>}
      {purgeResult && (
        <StatusBanner variant={purgeResult.rowsDeleted > 0 ? 'success' : 'neutral'}>
          Purge complete · {purgeResult.rowsDeleted} row
          {purgeResult.rowsDeleted === 1 ? '' : 's'} deleted in{' '}
          {purgeResult.durationMs} ms
          {purgeResult.cutoffDate
            ? ` (cutoff ${purgeResult.cutoffDate.slice(0, 10)})`
            : ''}
          .
        </StatusBanner>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save retention'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || !initialEnforced}
          onClick={() => setPurgeDialogOpen(true)}
          className="gap-1"
          title={
            !initialEnforced
              ? 'Configure retention first (save with the toggle on).'
              : ''
          }
        >
          <Trash2 className="h-3 w-3" aria-hidden />
          Run purge now
        </Button>
      </div>

      <AlertDialog open={purgeDialogOpen} onOpenChange={setPurgeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run audit purge for this org?</AlertDialogTitle>
            <AlertDialogDescription>
              Deletes AuditLog rows older than {initial.auditRetentionDays} days.
              PlatformAuditLog + AUDIT_PURGE_RUN receipts are preserved. The
              purge writes a new AUDIT_PURGE_RUN row capturing
              what was deleted. <strong>This cannot be undone.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={runPurge}
              disabled={pending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Run purge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
