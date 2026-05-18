'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';

type Status = {
  lastSyncedAt: string | null;
  counts: Record<string, number>;
  staleResourceTypes: string[];
};

type SyncResult = {
  ok: boolean;
  totalFetched: number;
  totalCached: number;
  perResourceType: Record<string, { count: number; error: string | null }>;
};

/**
 * SyncStatus — Unit 21 surface on the verified EhrLinkPanel.
 *
 * Fetches the current sync status on mount + after every successful
 * sync. "Sync EHR data" button POSTs to /api/patients/[id]/fhir-sync
 * synchronously; the request is bounded to ~10s in real-mode (per spec)
 * so blocking the button is reasonable UX. On success the per-type
 * summary chip shows briefly so the clinician sees what was fetched.
 */
export function SyncStatus({ patientId }: { patientId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/patients/${patientId}/fhir-sync`, { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as { data: Status };
      setStatus(body.data);
    } catch {
      /* ignore — surface failure happens on the next sync attempt */
    }
  }, [patientId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStatus();
  }, [loadStatus]);

  function sync() {
    setError(null);
    setLastResult(null);
    startTransition(async () => {
      const res = await fetch(`/api/patients/${patientId}/fhir-sync`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { code?: string; message?: string } }
          | null;
        const code = body?.error?.code;
        if (code === 'not_linked') {
          setError('This patient isn’t linked to an EHR record yet. Confirm the match above first.');
        } else if (code === 'ehr_not_connected') {
          setError('Connect to NextGen via /admin/integrations/fhir before syncing.');
        } else {
          setError(body?.error?.message ?? `Sync failed (${res.status})`);
        }
        return;
      }
      const body = (await res.json()) as { data: SyncResult };
      setLastResult(body.data);
      await loadStatus();
      router.refresh();
    });
  }

  const failedTypes = lastResult
    ? Object.entries(lastResult.perResourceType).filter(([, v]) => v.error)
    : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 space-y-1">
          {status?.lastSyncedAt ? (
            <p className="text-xs text-muted-foreground">
              Last synced {new Date(status.lastSyncedAt).toLocaleString()}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground italic">No EHR data cached yet.</p>
          )}
          {status?.staleResourceTypes.length ? (
            <p className="text-xs text-[var(--status-warning-fg)] flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              Stale: {status.staleResourceTypes.join(', ')}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={sync}
          disabled={pending}
          className="gap-1"
        >
          {pending ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <RefreshCcw className="h-3 w-3" aria-hidden />
          )}
          {pending ? 'Syncing…' : 'Sync EHR data'}
        </Button>
      </div>

      {lastResult && (
        <div className="rounded-md border border-border p-3 space-y-2 bg-muted/30">
          <p className="text-xs font-medium flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-[var(--status-success-fg)]" aria-hidden />
            Synced {lastResult.totalCached} records {failedTypes.length > 0 ? `· ${failedTypes.length} type${failedTypes.length === 1 ? '' : 's'} failed` : ''}
          </p>
          <div className="flex flex-wrap gap-1">
            {Object.entries(lastResult.perResourceType).map(([type, info]) => (
              <StatusBadge
                key={type}
                variant={info.error ? 'danger' : info.count > 0 ? 'success' : 'neutral'}
                noIcon
              >
                {type}: {info.count}
              </StatusBadge>
            ))}
          </div>
        </div>
      )}

      {status && !lastResult && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(status.counts).map(([type, count]) => (
            <StatusBadge
              key={type}
              variant={count > 0 ? 'neutral' : 'neutral'}
              noIcon
              className={count === 0 ? 'opacity-60' : undefined}
            >
              {type}: {count}
            </StatusBadge>
          ))}
        </div>
      )}

      {error && <StatusBanner variant="danger">{error}</StatusBanner>}
    </div>
  );
}
