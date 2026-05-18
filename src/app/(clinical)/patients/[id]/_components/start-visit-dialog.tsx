'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { PlusCircle } from 'lucide-react';
import type { Division } from '@prisma/client';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';

export type StartVisitDialogEpisode = {
  id: string;
  diagnosis: string;
  bodyPart: string | null;
  division: Division;
  lastVisitAt: string | null; // ISO; null if no prior visits
  visitCount: number;
};

export type StartVisitSubmitArgs = {
  patientId: string;
  episodeOfCareId: string | null;
  source: 'picker' | 'auto-single' | 'auto-none' | 'manual-skip';
};

type Props = {
  patientId: string;
  activeEpisodes: StartVisitDialogEpisode[];
  /** Controls when dialog opens. If activeEpisodes.length < 2 the dialog
   * auto-skips and immediately POSTs at open time. */
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onStarted: (result: { encounterId: string; noteId: string }) => void;
  /** Optional custom submitter. Defaults to POST /api/encounters; the
   * scheduling-card overrides this to POST /api/schedules/[id]/start so the
   * schedule's status flips to IN_PROGRESS as a side effect. Must throw on
   * failure (the dialog catches + surfaces). */
  submit?: (args: StartVisitSubmitArgs) => Promise<{ encounterId: string; noteId: string }>;
};

/** Sentinel for the "skip — start without an episode link" choice. */
const NO_EPISODE = '__no_episode__';

/**
 * StartVisitDialog — Sheet that picks which episode an ad-hoc / scheduled visit
 * is for, so Note.division resolves to the right value (REHAB CPT codes, BH
 * lens, MEDICAL fallback).
 *
 * Four cases:
 *   - 0 active episodes:   POST { patientId } immediately, no UI.
 *   - 1 active episode:    POST { patientId, episodeOfCareId } immediately.
 *   - 2+ active episodes:  open the picker; clinician picks an episode OR the
 *                          "skip" option OR navigates to /episodes/new.
 *   - new-episode flow:    link out to /patients/[id]/episodes/new; clinician
 *                          comes back and starts again from the patient page.
 */
export function StartVisitDialog(props: Props) {
  // The 0/1 auto-post effect lives on the auto-poster shell. The picker UI is
  // a child keyed by `open` so reopening always starts with fresh state — no
  // setState-in-effect (React 19 strict).
  if (props.activeEpisodes.length < 2) {
    return <AutoPostShell {...props} />;
  }
  return <PickerShell key={String(props.open)} {...props} />;
}

function AutoPostShell({
  patientId,
  activeEpisodes,
  open,
  onOpenChange,
  onStarted,
  submit,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const submitter = submit ?? defaultEncountersSubmit;
  const autoPost = open && activeEpisodes.length < 2;

  useEffect(() => {
    if (!autoPost) return;
    const explicit = activeEpisodes.length === 1 ? activeEpisodes[0]!.id : null;
    submitter({
      patientId,
      episodeOfCareId: explicit,
      source: explicit ? 'auto-single' : 'auto-none',
    })
      .then((res) => {
        onOpenChange(false);
        onStarted(res);
      })
      .catch((err: Error) => {
        setError(err.message);
        onOpenChange(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPost]);

  return error ? (
    <p className="text-sm text-[var(--status-danger-fg)]" role="alert">
      {error}
    </p>
  ) : null;
}

function PickerShell({
  patientId,
  activeEpisodes,
  open,
  onOpenChange,
  onStarted,
  submit,
}: Props) {
  const [choice, setChoice] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submitter = submit ?? defaultEncountersSubmit;

  function submitChoice() {
    if (!choice) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await submitter({
          patientId,
          episodeOfCareId: choice === NO_EPISODE ? null : choice,
          source: choice === NO_EPISODE ? 'manual-skip' : 'picker',
        });
        onOpenChange(false);
        onStarted(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start the visit.');
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md space-y-4">
        <SheetHeader>
          <SheetTitle>Which episode is this visit for?</SheetTitle>
          <SheetDescription>
            Linking the visit to the right episode keeps division-specific behavior (REHAB
            CPT codes, BH and MEDICAL prompts) correct.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-2 px-4">
          <fieldset className="space-y-2">
            <legend className="sr-only">Active episodes for this patient</legend>
            {activeEpisodes.map((ep) => (
              <EpisodeRadio
                key={ep.id}
                episode={ep}
                selected={choice === ep.id}
                onSelect={() => setChoice(ep.id)}
                disabled={pending}
              />
            ))}

            <SkipRadio
              selected={choice === NO_EPISODE}
              onSelect={() => setChoice(NO_EPISODE)}
              disabled={pending}
            />
          </fieldset>

          <div className="pt-1">
            <Link
              href={`/patients/${patientId}/episodes/new`}
              className="inline-flex items-center gap-1 text-sm text-foreground hover:underline"
              aria-label="Create a new episode"
            >
              <PlusCircle className="size-3.5" aria-hidden />
              Create a new episode
            </Link>
          </div>

          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
        </div>

        <SheetFooter className="flex-row justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={submitChoice} disabled={pending || !choice}>
            {pending ? 'Starting…' : 'Start visit'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function EpisodeRadio({
  episode,
  selected,
  onSelect,
  disabled,
}: {
  episode: StartVisitDialogEpisode;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
        selected
          ? 'border-foreground/50 bg-muted/40'
          : 'border-border hover:bg-muted/30'
      } ${disabled ? 'pointer-events-none opacity-60' : ''}`}
    >
      <input
        type="radio"
        name="episode-pick"
        value={episode.id}
        checked={selected}
        onChange={onSelect}
        disabled={disabled}
        className="mt-1"
        aria-describedby={`ep-meta-${episode.id}`}
      />
      <div className="space-y-1 flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{episode.diagnosis}</p>
          {episode.bodyPart && (
            <span className="text-muted-foreground text-sm">({episode.bodyPart})</span>
          )}
        </div>
        <div
          id={`ep-meta-${episode.id}`}
          className="flex flex-wrap items-center gap-2 text-xs"
        >
          <StatusBadge variant={divisionVariant(episode.division)} noIcon>
            {episode.division}
          </StatusBadge>
          <StatusBadge variant="neutral" noIcon>
            {visitCountLabel(episode.visitCount)}
          </StatusBadge>
          <span className="text-muted-foreground">
            {lastVisitLabel(episode.lastVisitAt)}
          </span>
        </div>
      </div>
    </label>
  );
}

function SkipRadio({
  selected,
  onSelect,
  disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-md border border-dashed p-3 transition-colors ${
        selected
          ? 'border-foreground/50 bg-muted/40'
          : 'border-border hover:bg-muted/30'
      } ${disabled ? 'pointer-events-none opacity-60' : ''}`}
    >
      <input
        type="radio"
        name="episode-pick"
        value={NO_EPISODE}
        checked={selected}
        onChange={onSelect}
        disabled={disabled}
        className="mt-1"
      />
      <div className="space-y-1">
        <p className="text-sm font-medium">Skip — start without an episode link</p>
        <p className="text-xs text-muted-foreground">
          Use for drop-ins or chart-only visits. Division falls back to the organization
          default.
        </p>
      </div>
    </label>
  );
}

function divisionVariant(d: Division): 'success' | 'info' | 'violet' | 'neutral' {
  switch (d) {
    case 'REHAB':
      return 'success';
    case 'BEHAVIORAL_HEALTH':
      return 'violet';
    case 'MEDICAL':
      return 'info';
    case 'MULTI':
    default:
      return 'neutral';
  }
}

function visitCountLabel(count: number): string {
  if (count === 0) return 'no prior visits';
  if (count === 1) return '1 prior visit';
  return `${count} prior visits`;
}

function lastVisitLabel(iso: string | null): string {
  if (!iso) return 'no prior visits';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'last visit today';
  if (days === 1) return 'last visit yesterday';
  if (days < 30) return `last visit ${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return 'last visit 1 month ago';
  if (months < 12) return `last visit ${months} months ago`;
  const years = Math.floor(months / 12);
  if (years === 1) return 'last visit 1 year ago';
  return `last visit ${years} years ago`;
}

/**
 * Default submitter — POST /api/encounters. The schedule-card overrides this
 * with a POST to /api/schedules/[id]/start so the schedule's status moves to
 * IN_PROGRESS in the same transaction.
 */
async function defaultEncountersSubmit(
  args: StartVisitSubmitArgs,
): Promise<{ encounterId: string; noteId: string }> {
  const res = await fetch('/api/encounters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      patientId: args.patientId,
      ...(args.episodeOfCareId ? { episodeOfCareId: args.episodeOfCareId } : {}),
      pickerSource: args.source,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      body?.error?.message ?? `Could not start the visit (${res.status}).`,
    );
  }
  const body = await res.json();
  if (!body?.data?.noteId || !body?.data?.encounterId) {
    throw new Error('Server response missing encounter or note id.');
  }
  return { encounterId: body.data.encounterId, noteId: body.data.noteId };
}

// Re-export the sentinel for tests / siblings that need to drive the picker
// without importing the internal literal.
export const SKIP_EPISODE_VALUE = NO_EPISODE;
