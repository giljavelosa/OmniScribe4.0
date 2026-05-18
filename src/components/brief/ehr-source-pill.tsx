'use client';

import { useCallback, useState } from 'react';
import { AlertTriangle, ExternalLink, Plug } from 'lucide-react';

import { cn } from '@/lib/cn';
import { stalenessTier, type StalenessTier } from '@/lib/fhir/staleness';
import { ProvenanceDrawer } from './provenance-drawer';

/**
 * EhrSourcePill — Unit 23 / F5 counterpart to SourcePill. Note-sourced
 * brief fields keep SourcePill (links to /review); EHR-sourced fields
 * use THIS pill (opens ProvenanceDrawer with the raw FHIR resource).
 *
 * Three staleness tiers visible inline:
 *   - fresh (<7d): just the relative time
 *   - stale (7-30d): yellow chip "stale" + relative time
 *   - very_stale (>30d): red chip "very stale" + relative time
 *
 * Clicking opens the drawer; the drawer's fetch fires the
 * FHIR_RESOURCE_VIEWED audit (one per open).
 */
export function EhrSourcePill({
  ehrSystem,
  resourceType,
  fhirResourceId,
  fetchedAt,
  nowMs,
  className,
}: {
  ehrSystem: string;
  resourceType: string;
  fhirResourceId: string;
  /** ISO timestamp from the hydrated brief content. */
  fetchedAt: string;
  /** Caller-passed "now" so render stays pure (matches the brief footer
   *  + EhrLinkPanel patterns elsewhere in the app). */
  nowMs: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const onOpenChange = useCallback((next: boolean) => setOpen(next), []);

  const fetchedDate = new Date(fetchedAt);
  const tier = stalenessTier(fetchedDate, new Date(nowMs));
  const relative = formatRelative(fetchedDate, nowMs);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground hover:underline',
          className,
        )}
        aria-label={`Open ${resourceType} from ${ehrSystem}, fetched ${relative}`}
      >
        <Plug className="h-2.5 w-2.5" aria-hidden />
        <span>{ehrSystem}</span>
        <span aria-hidden="true">·</span>
        <span>{relative}</span>
        {tier !== 'fresh' && <StalenessChip tier={tier} />}
        <ExternalLink className="h-2.5 w-2.5" aria-hidden />
      </button>
      <ProvenanceDrawer
        open={open}
        onOpenChange={onOpenChange}
        ehrSystem={ehrSystem}
        resourceType={resourceType}
        fhirResourceId={fhirResourceId}
      />
    </>
  );
}

function StalenessChip({ tier }: { tier: StalenessTier }) {
  if (tier === 'fresh') return null;
  const isVery = tier === 'very_stale';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[9px] uppercase tracking-wide',
        isVery
          ? 'bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]'
          : 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]',
      )}
    >
      <AlertTriangle className="h-2 w-2" aria-hidden />
      {isVery ? 'very stale' : 'stale'}
    </span>
  );
}

function formatRelative(fetchedAt: Date, nowMs: number): string {
  const ageMs = nowMs - fetchedAt.getTime();
  if (ageMs < 0) return 'just now';
  const hours = ageMs / (60 * 60 * 1000);
  if (hours < 1) {
    const minutes = Math.max(1, Math.round(ageMs / (60 * 1000)));
    return `${minutes}m ago`;
  }
  if (hours < 24) {
    const h = Math.round(hours);
    return `${h}h ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 60) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}
