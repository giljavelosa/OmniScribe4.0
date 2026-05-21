'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil, RotateCcw, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import type {
  PatientSnapshotStrip as PatientSnapshotStripData,
  SnapshotMeasure,
} from '@/lib/snapshots/types';

type Props = {
  patientId: string;
  strip: PatientSnapshotStripData | null;
};

/**
 * PatientSnapshotStrip — horizontal row of measure cards. Up to 6 cards.
 * Empty state (no extracted + no overrides): renders a single quiet
 * "No measures yet" card so the strip slot doesn't collapse to nothing.
 *
 * The "Edit" pencil on each card opens an inline override form (replaces
 * the card body until cancel/save). Saved → POST /snapshot/override →
 * router.refresh → server re-computes the strip with the new manual row.
 */
export function PatientSnapshotStrip({ patientId, strip }: Props) {
  if (!strip || strip.measures.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
        No snapshot measures yet — they&apos;ll appear after the next signed
        note populates the brief, or you can manually add via the pencil
        action once a measure surfaces.
      </div>
    );
  }

  // For episode-scoped strips, every override must be tagged with the
  // episodeId — otherwise it persists as patient-scoped and never matches the
  // strip's filter (and silently disappears for REHAB patients with an active
  // episode). Pull it once at the parent so each card sends the right body.
  const episodeId = strip.scope.kind === 'episode' ? strip.scope.episodeId : null;

  return (
    <TooltipProvider>
      <div className="flex flex-wrap gap-2">
        {strip.measures.map((m) => (
          <SnapshotCard
            key={m.measureKey}
            patientId={patientId}
            measure={m}
            episodeId={episodeId}
          />
        ))}
      </div>
    </TooltipProvider>
  );
}

function SnapshotCard({
  patientId,
  measure,
  episodeId,
}: {
  patientId: string;
  measure: SnapshotMeasure;
  episodeId: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(measure.value);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    if (!value.trim()) {
      setError('Required.');
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/patients/${patientId}/snapshot/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          measureKey: measure.measureKey,
          valueJson: value.trim(),
          unit: measure.unit ?? null,
          // Episode-scoped strips require the override be tagged with episodeId
          // — without it the saved override is patient-scoped and never matches.
          episodeId: episodeId ?? undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Save failed (${res.status}).`);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function revertOverride() {
    if (!measure.overrideId) return;
    startTransition(async () => {
      const res = await fetch(
        `/api/patients/${patientId}/snapshot/override/${measure.overrideId}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Revert failed (${res.status}).`);
        return;
      }
      router.refresh();
    });
  }

  const trendGlyph = trendInfo(measure.trend);
  const sourceBadge = sourceInfo(measure.source);

  return (
    <div className="min-w-[160px] rounded-lg border border-border bg-card p-3 space-y-1 relative">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{measure.label}</p>
        <Tooltip>
          <TooltipTrigger asChild>
            <StatusBadge variant={sourceBadge.variant} noIcon className="text-[10px]">
              {sourceBadge.label}
            </StatusBadge>
          </TooltipTrigger>
          <TooltipContent>{sourceBadge.tooltip(measure)}</TooltipContent>
        </Tooltip>
      </div>

      {editing ? (
        <div className="space-y-2">
          <Label htmlFor={`val-${measure.measureKey}`} className="sr-only">{measure.label}</Label>
          <Input
            id={`val-${measure.measureKey}`}
            value={value}
            onChange={(e) => setValue(e.target.value.slice(0, 120))}
            disabled={pending}
            autoFocus
          />
          {error && <p className="text-xs text-[var(--status-danger-fg)]">{error}</p>}
          <div className="flex justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                setValue(measure.value);
                setError(null);
              }}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <p className="text-md font-semibold tabular-nums">{measure.value}</p>
            {measure.unit && <span className="text-xs text-muted-foreground">{measure.unit}</span>}
            <span
              className={cn('ml-auto text-sm', trendGlyph.color)}
              aria-label={trendGlyph.label}
              title={trendGlyph.label}
            >
              {trendGlyph.glyph}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            {measure.source === 'extracted' && measure.extractedFromNoteId && (
              <Link
                href={`/visits/${measure.extractedFromNoteId}`}
                className="hover:underline truncate"
              >
                source ↗
              </Link>
            )}
            {measure.source === 'manual' && measure.overriddenAt && (
              <span>edited {formatRelative(measure.overriddenAt)}</span>
            )}
            <div className="flex items-center gap-1 ml-auto">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setEditing(true)}
                aria-label={`Edit ${measure.label}`}
                className="h-6 w-6"
                disabled={pending}
              >
                <Pencil className="size-3" aria-hidden="true" />
              </Button>
              {measure.source === 'manual' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={revertOverride}
                  aria-label={`Revert ${measure.label} override`}
                  className="h-6 w-6"
                  disabled={pending}
                >
                  <X className="size-3" aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function trendInfo(trend: SnapshotMeasure['trend']): { glyph: string; label: string; color: string } {
  switch (trend) {
    case 'improving':
      return { glyph: '↗', label: 'improving', color: 'text-[var(--status-success-fg)]' };
    case 'worsening':
      return { glyph: '↘', label: 'worsening', color: 'text-[var(--status-warning-fg)]' };
    case 'stable':
      return { glyph: '→', label: 'stable', color: 'text-muted-foreground' };
    case 'unknown':
    default:
      return { glyph: '·', label: 'no trend', color: 'text-muted-foreground' };
  }
}

function sourceInfo(source: SnapshotMeasure['source']): {
  label: string;
  variant: 'success' | 'info' | 'warning';
  tooltip: (m: SnapshotMeasure) => string;
} {
  switch (source) {
    case 'manual':
      return {
        label: 'edited',
        variant: 'warning',
        tooltip: (m) =>
          m.extractedFallbackValue
            ? `Manual override. Reverting falls back to extracted value: ${m.extractedFallbackValue}.`
            : 'Manual override.',
      };
    case 'extracted':
      return {
        label: 'extracted',
        variant: 'success',
        tooltip: (m) =>
          m.extractedFromNoteId
            ? 'Extracted from the most-recent signed note via the brief pipeline. Tap source to open.'
            : 'Extracted from a signed note.',
      };
    case 'fhir':
      return {
        label: 'FHIR',
        variant: 'info',
        tooltip: () => 'From the FHIR EHR pipe (Wave 4).',
      };
  }
}

function formatRelative(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

void RotateCcw;
