'use client';

import { useEffect, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';

type CachedResponse = {
  id: string;
  ehrSystem: string;
  resourceType: string;
  fhirResourceId: string;
  fetchedAt: string;
  sensitivityLevel: string | null;
  raw: unknown;
  simplified: unknown;
};

/**
 * ProvenanceDrawer — Unit 23 / F5 detail surface for an
 * EhrSourcePill. Fetches the cached FHIR row on open via the
 * by-fhir-id endpoint (which audits FHIR_RESOURCE_VIEWED). Renders:
 *
 *   - sensitivityLevel chip when present ("Restricted source" — 42
 *     CFR Part 2 propagation, see Unit 21 extractSensitivityLevel)
 *   - simplified shape (the projection F4 reads into the brief)
 *   - raw FHIR JSON (the EHR's untouched payload — what the auditor
 *     wants to see)
 *   - explicit fetchedAt timestamp
 *
 * Read-only. Sync-now lives on the EhrLinkPanel; this drawer is
 * single-purpose (inspect).
 */
export function ProvenanceDrawer({
  open,
  onOpenChange,
  ehrSystem,
  resourceType,
  fhirResourceId,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  ehrSystem: string;
  resourceType: string;
  fhirResourceId: string;
}) {
  const [data, setData] = useState<CachedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setError(null);
    setLoading(true);
    const params = new URLSearchParams({ ehrSystem, resourceType, fhirResourceId });
    void fetch(`/api/fhir/cached-resources/by-fhir-id?${params.toString()}`, { cache: 'no-store' })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setError(res.status === 404 ? 'This resource is no longer cached.' : `Lookup failed (${res.status}).`);
          return;
        }
        const body = (await res.json()) as { data: CachedResponse };
        setData(body.data);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, ehrSystem, resourceType, fhirResourceId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {resourceType}{' '}
            <span className="font-normal text-sm text-muted-foreground">from {ehrSystem}</span>
          </DialogTitle>
          <DialogDescription>
            Provenance for the brief field above — the cached FHIR resource as the EHR returned it.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
          </div>
        )}

        {error && <StatusBanner variant="danger">{error}</StatusBanner>}

        {data && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <StatusBadge variant="neutral" noIcon>id: {data.fhirResourceId}</StatusBadge>
              <StatusBadge variant="neutral" noIcon>
                fetched {new Date(data.fetchedAt).toLocaleString()}
              </StatusBadge>
              {data.sensitivityLevel && (
                <StatusBadge variant="danger" noIcon>
                  <ShieldAlert className="h-3 w-3 mr-1" aria-hidden /> Restricted source
                </StatusBadge>
              )}
            </div>

            <section>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                Simplified (what the brief used)
              </h3>
              <pre className="rounded-md border border-border bg-muted/30 p-3 text-xs overflow-x-auto whitespace-pre-wrap break-words">
                {JSON.stringify(data.simplified, null, 2)}
              </pre>
            </section>

            <section>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Raw FHIR (as returned by {ehrSystem})
                </h3>
                <Button variant="ghost" size="sm" onClick={() => setShowRaw((s) => !s)}>
                  {showRaw ? 'Hide' : 'Show'}
                </Button>
              </div>
              {showRaw && (
                <pre className="rounded-md border border-border bg-muted/30 p-3 text-xs overflow-x-auto whitespace-pre-wrap break-words">
                  {JSON.stringify(data.raw, null, 2)}
                </pre>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
