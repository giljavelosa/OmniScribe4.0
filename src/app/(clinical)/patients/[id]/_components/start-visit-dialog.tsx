'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { CalendarDays, PlusCircle } from 'lucide-react';
import type { Division } from '@prisma/client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

/** Hard-coded backdating window (spec § Goals — 30 days, org-configurable later). */
const LATE_ENTRY_MAX_DAYS = 30;
const MS_PER_DAY = 86_400_000;

export type StartVisitDialogEpisode = {
  id: string;
  diagnosis: string;
  bodyPart: string | null;
  division: Division;
  lastVisitAt: string | null; // ISO; null if no prior visits
  visitCount: number;
};

export type StartVisitDialogSite = {
  id: string;
  name: string;
};

export type StartVisitSubmitArgs = {
  patientId: string;
  episodeOfCareId: string | null;
  source: 'picker' | 'auto-single' | 'auto-none' | 'manual-skip';
  /** Site-of-record for THIS visit. Required for the ad-hoc path
   *  (`defaultEncountersSubmit` sends it in the POST body); the scheduled
   *  path overrides the submitter and uses `schedule.siteId` server-side,
   *  so siteId may be undefined for that flow. */
  siteId?: string;
  /** ISO 8601 (full datetime, midnight local). Omit for normal same-day visits.
   * The route still validates the 30-day floor + today ceiling. */
  dateOfService?: string;
};

type Props = {
  patientId: string;
  activeEpisodes: StartVisitDialogEpisode[];
  /** Sites the clinician can record at. Optional — when omitted the dialog
   *  hides the Site picker and the submitter handles site selection
   *  externally (the scheduling-card flow uses `schedule.siteId`). When
   *  provided, the dialog enforces a site choice as a recording precondition. */
  sites?: StartVisitDialogSite[];
  /** Pre-selected site for the picker. Required when `sites` is provided
   *  (the picker can't open with no default). */
  defaultSiteId?: string | null;
  /** Controls when dialog opens. If activeEpisodes.length < 2 the dialog
   * auto-skips and immediately POSTs at open time — UNLESS
   * `forceDatePicker` is true, which surfaces the picker for the late-entry
   * dropdown entry-path. */
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onStarted: (result: { encounterId: string; noteId: string }) => void;
  /** Optional custom submitter. Defaults to POST /api/encounters; the
   * scheduling-card overrides this to POST /api/schedules/[id]/start so the
   * schedule's status flips to IN_PROGRESS as a side effect. Must throw on
   * failure (the dialog catches + surfaces). */
  submit?: (args: StartVisitSubmitArgs) => Promise<{ encounterId: string; noteId: string }>;
  /**
   * Force the date-picker surface even when there are 0 or 1 active episodes
   * (where the dialog would otherwise auto-post without UI). Used by the
   * "Start late entry…" entry path on the patient chart so backdating works
   * for single-episode and no-episode patients.
   *
   * When true, the picker UI renders unconditionally; the "Visit date" field
   * defaults to today and the clinician picks the actual date-of-service.
   */
  forceDatePicker?: boolean;
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
  // The picker shell now ALSO carries the Site dropdown when sites are
  // provided. We still keep the auto-post path for the everyday "0/1
  // episode + 0 or 1 pickable site" case — it auto-uses defaultSiteId
  // (when set) and skips UI entirely.
  //
  // Forced picker when: late entry, 2+ episodes, OR 2+ pickable sites
  // (clinician needs to choose where they are physically).
  const needsSitePicker = (props.sites?.length ?? 0) >= 2;
  if (props.forceDatePicker || props.activeEpisodes.length >= 2 || needsSitePicker) {
    return <PickerShell key={String(props.open)} {...props} />;
  }
  return <AutoPostShell {...props} />;
}

function AutoPostShell({
  patientId,
  activeEpisodes,
  sites,
  defaultSiteId,
  open,
  onOpenChange,
  onStarted,
  submit,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const submitter = submit ?? defaultEncountersSubmit;
  // When the dialog isn't governing site selection (sites omitted, e.g.
  // scheduling-card flow), the submitter handles siteId externally.
  // Otherwise we need a defaultSiteId before auto-posting.
  const sitesGovernedHere = sites !== undefined;
  const autoPost =
    open &&
    activeEpisodes.length < 2 &&
    (!sitesGovernedHere || !!defaultSiteId);

  useEffect(() => {
    if (!autoPost) return;
    const explicit = activeEpisodes.length === 1 ? activeEpisodes[0]!.id : null;
    submitter({
      patientId,
      episodeOfCareId: explicit,
      source: explicit ? 'auto-single' : 'auto-none',
      ...(sitesGovernedHere && defaultSiteId ? { siteId: defaultSiteId } : {}),
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
  sites,
  defaultSiteId,
  open,
  onOpenChange,
  onStarted,
  submit,
  forceDatePicker,
}: Props) {
  const siteListLen = sites?.length ?? 0;
  const sitesGovernedHere = sites !== undefined;
  // Preselect the only episode (or the skip option) when forceDatePicker is on
  // and the patient has 0 or 1 active episode — the clinician shouldn't have
  // to re-pick an episode just to backdate the visit.
  const initialChoice =
    activeEpisodes.length === 1 && (forceDatePicker || siteListLen >= 2)
      ? activeEpisodes[0]!.id
      : activeEpisodes.length === 0 && (forceDatePicker || siteListLen >= 2)
        ? NO_EPISODE
        : '';
  const [choice, setChoice] = useState<string>(initialChoice);
  const [siteId, setSiteId] = useState<string>(defaultSiteId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submitter = submit ?? defaultEncountersSubmit;

  const { todayIso, floorIso, todayLabel } = useMemo(() => {
    const today = startOfLocalDay(new Date());
    const floor = new Date(today.getTime() - LATE_ENTRY_MAX_DAYS * MS_PER_DAY);
    return {
      todayIso: toDateInputValue(today),
      floorIso: toDateInputValue(floor),
      todayLabel: today.toLocaleDateString(undefined, {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    };
  }, []);

  const [visitDate, setVisitDate] = useState<string>(todayIso);
  const today = useMemo(() => startOfLocalDay(new Date()), []);
  const picked = useMemo(() => parseDateInputValue(visitDate), [visitDate]);
  const daysBack = picked ? Math.round((today.getTime() - picked.getTime()) / MS_PER_DAY) : 0;
  const isFuture = daysBack < 0;
  const isTooFarBack = daysBack > LATE_ENTRY_MAX_DAYS;
  const isBackdated = !isFuture && !isTooFarBack && daysBack >= 1;
  const dateInvalid = !picked || isFuture || isTooFarBack;
  const dateOfServiceIso = picked && !dateInvalid && daysBack !== 0 ? picked.toISOString() : undefined;

  function submitChoice() {
    if (!choice) return;
    if (sitesGovernedHere && !siteId) {
      setError('Pick the site you are at for this visit.');
      return;
    }
    if (dateInvalid) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await submitter({
          patientId,
          episodeOfCareId: choice === NO_EPISODE ? null : choice,
          source: choice === NO_EPISODE ? 'manual-skip' : 'picker',
          ...(sitesGovernedHere && siteId ? { siteId } : {}),
          dateOfService: dateOfServiceIso,
        });
        onOpenChange(false);
        onStarted(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start the visit.');
      }
    });
  }

  const showEpisodePicker = activeEpisodes.length >= 2;
  const showSitePicker = sitesGovernedHere && siteListLen >= 2;
  const showSiteReadonly = sitesGovernedHere && siteListLen === 1;
  const title = showEpisodePicker
    ? forceDatePicker
      ? 'Start late entry'
      : 'Which episode is this visit for?'
    : forceDatePicker
      ? 'Start late entry'
      : 'Start visit';
  const description = showEpisodePicker
    ? 'Linking the visit to the right episode keeps division-specific behavior (REHAB CPT codes, BH and MEDICAL prompts) correct.'
    : 'Set the date the visit actually happened. Today is fine for a normal visit — backdate to chart a past one.';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md space-y-4">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <div className="space-y-3 px-4">
          {showEpisodePicker && (
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
          )}

          {showEpisodePicker && (
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
          )}

          {/* Site-of-record for this visit. Shown only when the dialog is
              governing site selection (the ad-hoc path). The scheduling-card
              flow omits `sites` because the server uses `schedule.siteId`. */}
          {sitesGovernedHere && (
            <div className="space-y-2 pt-1">
              <Label htmlFor="visit-site">Site (where you are)</Label>
              {showSitePicker ? (
                <Select
                  value={siteId}
                  onValueChange={(v) => setSiteId(v)}
                  disabled={pending}
                >
                  <SelectTrigger id="visit-site">
                    <SelectValue placeholder="Pick a site" />
                  </SelectTrigger>
                  <SelectContent>
                    {sites!.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : showSiteReadonly ? (
                <p className="text-sm">{sites![0]!.name}</p>
              ) : (
                <StatusBanner variant="danger">
                  You aren&apos;t enrolled at any site — ask your admin to enroll you before recording.
                </StatusBanner>
              )}
              <p className="text-xs text-muted-foreground">
                The note is tied to this site so visits can be pulled by location.
              </p>
            </div>
          )}

          {/* Visit date — same UI for all entry paths so clinicians don't see
              a context-sensitive picker. Defaults to today (same effective
              behavior as before for the normal-flow path). */}
          <div className="space-y-2 pt-1">
            <Label htmlFor="visit-date" className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5" aria-hidden />
              Visit date
            </Label>
            <Input
              id="visit-date"
              type="date"
              value={visitDate}
              min={floorIso}
              max={todayIso}
              onChange={(e) => setVisitDate(e.target.value)}
              disabled={pending}
              aria-describedby="visit-date-help"
            />
            <p id="visit-date-help" className="text-xs text-muted-foreground">
              Today is {todayLabel}. Backdate up to {LATE_ENTRY_MAX_DAYS} days for a late entry.
            </p>
            {isBackdated && (
              <StatusBanner variant="warning">
                Late entry — sign attestation will reflect this date.
              </StatusBanner>
            )}
            {isFuture && (
              <StatusBanner variant="danger">
                Visit date cannot be in the future.
              </StatusBanner>
            )}
            {isTooFarBack && (
              <StatusBanner variant="danger">
                Visit date cannot be more than {LATE_ENTRY_MAX_DAYS} days ago.
              </StatusBanner>
            )}
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
          <Button
            onClick={submitChoice}
            disabled={pending || !choice || (sitesGovernedHere && !siteId) || dateInvalid}
          >
            {pending ? 'Starting…' : isBackdated ? 'Start late entry' : 'Start visit'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** Snap a Date to the start of the local calendar day (00:00 in the runtime TZ). */
function startOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Date → `YYYY-MM-DD` (the format <input type="date"> accepts/emits). */
function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse `YYYY-MM-DD` back to a Date at local-day-start (avoids UTC drift). */
function parseDateInputValue(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  return d;
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
          {/* Skip the redundant "no prior visits" span when the badge already
              says it (visitCount === 0 + no lastVisitAt). */}
          {episode.lastVisitAt && (
            <span className="text-muted-foreground">
              {lastVisitLabel(episode.lastVisitAt)}
            </span>
          )}
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
      ...(args.siteId ? { siteId: args.siteId } : {}),
      ...(args.episodeOfCareId ? { episodeOfCareId: args.episodeOfCareId } : {}),
      ...(args.dateOfService ? { dateOfService: args.dateOfService } : {}),
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
