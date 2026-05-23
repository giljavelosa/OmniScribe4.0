'use client';

import { useState, useTransition } from 'react';
import { Plug } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBanner } from '@/components/ui/status-banner';
import { Switch } from '@/components/ui/switch';

/**
 * Sprint 0.17 — org-level master toggle for FHIR write-back.
 *
 * Decision 1 / gate (a): the non-negotiable opt-in. Defaults FALSE
 * for every existing org (decision 10 — backward compat). Flipping
 * on requires this admin click + writes
 * `OrgEhrConnection.writebackEnabled = true` plus a
 * `ORG_EHR_WRITEBACK_ENABLED` audit row.
 *
 * Flipping off batch-cancels every PROPOSED / APPROVED proposal for
 * the org (transition to CANCELLED + a per-row FHIR_WRITEBACK_CANCELLED
 * audit with `cancelReason: 'org_disabled'`). The worker ALSO
 * re-checks the flag at job pickup (defense in depth, handler.ts) —
 * so an in-flight EXECUTING write may complete even after the admin
 * flips off; that's the spec's chosen invariant (let in-flight EHR
 * writes finish; cancel everything that hasn't started).
 *
 * Anti-regression rule 22: this is a switch, not a native confirm —
 * but the destructive disable path (with potentially many pending
 * proposals) should ideally also pop an `<AlertDialog>` before
 * batching. We surface the inline cancelledCount banner instead in
 * this first cut; an AlertDialog gate is reserved for a follow-up.
 */
export type WritebackToggleProps = {
  /** OrgEhrConnection.id — drives the PATCH URL. */
  connectionId: string;
  initialEnabled: boolean;
  /** When non-null, surfaces the "enabled since" / "last toggled by"
   *  copy underneath the switch. */
  enabledAt: string | null;
};

export function WritebackToggle({
  connectionId,
  initialEnabled,
  enabledAt,
}: WritebackToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [cancelledCount, setCancelledCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function flip(next: boolean) {
    setError(null);
    setCancelledCount(null);
    startTransition(async () => {
      const res = await fetch(
        `/api/admin/org-settings/ehr-writeback-toggle`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId, enabled: next }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? 'Could not change the setting.');
        return;
      }
      const body = await res.json();
      setEnabled(next);
      if (!next && typeof body?.data?.cancelledCount === 'number') {
        setCancelledCount(body.data.cancelledCount);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-4 w-4" aria-hidden />
          Write-back to EHR
        </CardTitle>
        <CardDescription>
          When enabled, clinicians can opt in to pushing case updates back
          to your EHR. Each write requires explicit clinician
          confirmation. Disabling here cancels all pending writes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">
              {enabled ? 'Enabled' : 'Disabled'}
            </p>
            {enabled && enabledAt && (
              <p className="text-xs text-muted-foreground">
                Enabled {new Date(enabledAt).toLocaleDateString()}
              </p>
            )}
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={flip}
            disabled={pending}
            aria-label="Toggle FHIR write-back"
          />
        </div>
        {cancelledCount !== null && cancelledCount > 0 && (
          <StatusBanner variant="info">
            Cancelled {cancelledCount} pending write
            {cancelledCount === 1 ? '' : 's'}.
          </StatusBanner>
        )}
        {error && <StatusBanner variant="danger">{error}</StatusBanner>}
      </CardContent>
    </Card>
  );
}
