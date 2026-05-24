'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { CalendarDays, PlusCircle } from 'lucide-react';
import { EncounterIntent, type Division } from '@prisma/client';

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
import { sortCasesByViewerRecency } from '@/lib/case-management/sort';
import { NewCaseDialog } from './new-case-dialog';
import { IntentChip, deriveIntentSource } from './intent-chip';

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

export type StartVisitDialogCase = {
  id: string;
  primaryIcd: string | null;
  primaryIcdLabel: string;
  secondaryIcd: string | null;
  /** ISO — most recent signed-note activity on this case overall. */
  lastActivityAt: string | null;
  /** ISO — most recent signed-note activity by *this* viewing clinician.
   *  Drives the "Your active case" pre-selection + pill in the picker so the
   *  chart's hero pattern (cases-panel.tsx) reads consistently in the dialog. */
  viewerLastActivityAt: string | null;
  /** ISO — most recent signed-note activity by anyone in the viewer's
   *  division. Tiebreaker beneath `viewerLastActivityAt`. */
  viewerDivisionLastActivityAt: string | null;
  episodes: StartVisitDialogEpisode[];
};

export type StartVisitDialogSite = {
  id: string;
  name: string;
};

export type StartVisitSubmitArgs = {
  patientId: string;
  /** Sprint 0.13 — null when starting an agent-routed visit. The server
   *  auto-creates a PENDING_ROUTER case in the same tx and Miss Cleo's
   *  case-router worker proposes the destination at review time. */
  caseManagementId: string | null;
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
  /** Unit 48 PR2 — clinical intent for this encounter (Initial Eval /
   *  Daily / Progress / etc.). Omitted when the dialog wasn't fed a
   *  `proposedIntent` prop (legacy callers). Server defaults to
   *  UNSPECIFIED + CLINICIAN when omitted. */
  intent?: EncounterIntent;
  intentSource?: 'CLINICIAN' | 'COPILOT_PROPOSAL_CONFIRMED';
};

/** Unit 48 PR2 — proposal payload from
 *  `GET /api/patients/[id]/proposed-intent`. Drives the IntentChip
 *  rendered inside the dialog. */
export type ProposedIntent = {
  intent: EncounterIntent;
  division: Division;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
};

type Props = {
  patientId: string;
  activeCases: StartVisitDialogCase[];
  /** Clinician division from profession — drives rehab episode picker visibility. */
  viewerDivision: Division | null;
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
  /**
   * Sprint 0.13 override path. When set, the dialog binds the new visit to
   * this case (skipping Miss Cleo's case-router). Used by:
   *   - the chart hero "Continue this case" button (id of the chosen case)
   *   - the routing panel's "Change manually" branch
   * When unset, the default flow posts without a case id and the worker
   * proposes the destination at review time.
   */
  forceCaseId?: string;
  /** Unit 48 PR2 — Cleo's proposed visit-type intent + reason. Optional
   *  for back-compat: legacy callers that haven't been wired to fetch
   *  `GET /api/patients/[id]/proposed-intent` yet pass nothing, no chip
   *  renders, and the server applies `intent = UNSPECIFIED` defaults
   *  (current behavior preserved). When supplied:
   *    - PickerShell renders the chip; clinician confirms or overrides
   *    - AutoPostShell omits the chip but includes intent + intentSource
   *      in the silent POST
   *    - `confidence === 'low'` forces PickerShell to render so the
   *      clinician must explicitly pick (Decision 7) */
  proposedIntent?: ProposedIntent;
};

/** Sentinel — rehab visit without linking an episode of care. */
const NO_EPISODE = '__no_episode__';
const NEW_CASE = '__new_case__';

/**
 * StartVisitDialog — Sheet that starts a visit. Sprint 0.13 made the case
 * picker an OVERRIDE path: the default flow POSTs without a case id and Miss
 * Cleo's case-router worker proposes the destination at review time. Existing
 * surfaces (the chart hero "Continue this case" shortcut, the routing-panel
 * "Change manually" branch) set `forceCaseId` to bind explicitly + still get
 * the site / date / rehab-episode pickers as needed.
 *
 * Picker is forced (vs. auto-post) when ANY of:
 *   - forceDatePicker (late-entry path)
 *   - 2+ pickable sites (clinician needs to pick where they are physically)
 *   - REHAB clinician + forceCaseId points at a case with 2+ active episodes
 */
export function StartVisitDialog(props: Props) {
  const needsSitePicker = (props.sites?.length ?? 0) >= 2;
  // Rehab episode picker only applies when an explicit case is being bound
  // (override flow). The default agent-routed flow doesn't pick an episode
  // — Cleo's proposal handles routing entirely.
  const forcedCase = props.forceCaseId
    ? (props.activeCases.find((c) => c.id === props.forceCaseId) ?? null)
    : null;
  const rehabEpisodes = forcedCase?.episodes ?? [];
  const needsRehabEpisodePicker =
    !!forcedCase &&
    props.viewerDivision === 'REHAB' &&
    rehabEpisodes.length >= 2;

  // Unit 48 PR2 — force PickerShell when Cleo's proposal is low-confidence
  // (Decision 7). The clinician must explicitly pick rather than have the
  // dialog silently auto-post with an uncertain intent.
  const lowConfidenceIntent = props.proposedIntent?.confidence === 'low';
  if (
    props.forceDatePicker ||
    needsRehabEpisodePicker ||
    needsSitePicker ||
    lowConfidenceIntent
  ) {
    return <PickerShell key={String(props.open)} {...props} />;
  }
  return <AutoPostShell {...props} />;
}

function AutoPostShell({
  patientId,
  sites,
  defaultSiteId,
  open,
  onOpenChange,
  onStarted,
  submit,
  forceCaseId,
  proposedIntent,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const submitter = submit ?? defaultEncountersSubmit;
  const sitesGovernedHere = sites !== undefined;
  const autoPost = open && (!sitesGovernedHere || !!defaultSiteId);

  useEffect(() => {
    if (!autoPost) return;
    // Sprint 0.13 — default flow posts WITHOUT a case id. Miss Cleo's
    // case-router worker proposes the destination at review time. The
    // override paths (chart hero "Continue this case" + the routing
    // panel's "Change manually") set forceCaseId to bind explicitly.
    //
    // Unit 48 PR2 — when proposedIntent is supplied with medium/high
    // confidence, include it (+ COPILOT_PROPOSAL_CONFIRMED source) in
    // the silent auto-post. Low confidence forces PickerShell upstream
    // so we never reach this branch with an uncertain intent.
    const includeIntent =
      proposedIntent && proposedIntent.intent !== EncounterIntent.UNSPECIFIED;
    submitter({
      patientId,
      caseManagementId: forceCaseId ?? null,
      episodeOfCareId: null,
      source: forceCaseId ? 'picker' : 'auto-none',
      ...(sitesGovernedHere && defaultSiteId ? { siteId: defaultSiteId } : {}),
      ...(includeIntent
        ? {
            intent: proposedIntent!.intent,
            intentSource: 'COPILOT_PROPOSAL_CONFIRMED' as const,
          }
        : {}),
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
  activeCases,
  viewerDivision,
  sites,
  defaultSiteId,
  open,
  onOpenChange,
  onStarted,
  submit,
  forceDatePicker,
  forceCaseId,
  proposedIntent,
}: Props) {
  const [newCaseOpen, setNewCaseOpen] = useState(false);
  const siteListLen = sites?.length ?? 0;
  const sitesGovernedHere = sites !== undefined;
  // Sprint 0.13 — case picker is reachable only via the explicit
  // "New case management…" button OR when forceCaseId is supplied. In both
  // cases the dialog is bound to a specific case (not Cleo-routed). The
  // default agent flow never enters PickerShell with a case picker visible.
  const sortedCases = useMemo(
    () => sortCasesByViewerRecency(activeCases),
    [activeCases],
  );
  const heroCaseId = sortedCases.length >= 2 ? sortedCases[0]!.id : null;
  const [caseId, setCaseId] = useState<string>(forceCaseId ?? '');
  const selectedCase = activeCases.find((c) => c.id === caseId) ?? null;
  const rehabEpisodes = selectedCase?.episodes ?? [];
  const initialEpisodeChoice =
    viewerDivision === 'REHAB' &&
    rehabEpisodes.length === 1 &&
    (forceDatePicker || siteListLen >= 2)
      ? rehabEpisodes[0]!.id
      : viewerDivision === 'REHAB' && rehabEpisodes.length === 0
        ? NO_EPISODE
        : '';
  const [episodeChoice, setEpisodeChoice] = useState<string>(initialEpisodeChoice);
  const [siteId, setSiteId] = useState<string>(defaultSiteId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submitter = submit ?? defaultEncountersSubmit;
  // Unit 48 PR2 — intent state. Initialized from Cleo's proposal when
  // supplied; falls back to UNSPECIFIED (no chip rendered) for legacy
  // callers. Tracked separately from proposedIntent so the
  // intentSource derivation knows whether the value still equals the
  // proposal.
  const [intent, setIntent] = useState<EncounterIntent>(
    proposedIntent?.intent ?? EncounterIntent.UNSPECIFIED,
  );

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
    if (caseId === NEW_CASE) return;
    if (viewerDivision === 'REHAB' && rehabEpisodes.length >= 2 && !episodeChoice) return;
    if (sitesGovernedHere && !siteId) {
      setError('Pick the site you are at for this visit.');
      return;
    }
    if (dateInvalid) return;
    setError(null);
    startTransition(async () => {
      try {
        // Unit 48 PR2 — include intent + intentSource when the dialog was
        // fed a proposedIntent prop AND the clinician's selection isn't
        // UNSPECIFIED. Legacy callers (no proposedIntent) submit nothing
        // for intent; server applies defaults.
        const includeIntent =
          !!proposedIntent && intent !== EncounterIntent.UNSPECIFIED;
        const res = await submitter({
          patientId,
          // Sprint 0.13 — caseId is empty in the default agent-routed path
          // (no case picker shown); send null and let Cleo propose at review.
          caseManagementId: caseId || null,
          episodeOfCareId:
            viewerDivision === 'REHAB' && episodeChoice && episodeChoice !== NO_EPISODE
              ? episodeChoice
              : null,
          source: !caseId
            ? 'auto-none'
            : episodeChoice === NO_EPISODE || !episodeChoice
              ? 'manual-skip'
              : 'picker',
          ...(sitesGovernedHere && siteId ? { siteId } : {}),
          dateOfService: dateOfServiceIso,
          ...(includeIntent
            ? {
                intent,
                intentSource: deriveIntentSource(intent, proposedIntent!.intent),
              }
            : {}),
        });
        onOpenChange(false);
        onStarted(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start the visit.');
      }
    });
  }

  // Sprint 0.13 — the inline case picker is reachable only when the parent
  // explicitly hits "New case management…" inside the picker (override path).
  // Default agent-routed flow never shows a case list here.
  const showCasePicker = false;
  const showRehabEpisodePicker =
    viewerDivision === 'REHAB' && !!selectedCase && rehabEpisodes.length >= 2;
  const showSitePicker = sitesGovernedHere && siteListLen >= 2;
  const showSiteReadonly = sitesGovernedHere && siteListLen === 1;
  const title = forceDatePicker ? 'Start late entry' : 'Start visit';
  const description =
    'Set the date the visit actually happened. Today is fine for a normal visit — backdate to chart a past one.';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md space-y-4">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <div className="space-y-3 px-4">
          {/* Unit 48 PR2 — Miss Cleo's visit-type intent chip. Renders only
              when the caller supplied a proposedIntent prop AND the
              clinician has a known division to filter the override
              dropdown by. Legacy callers (no proposedIntent) skip this
              block entirely — the dialog renders exactly as before. */}
          {proposedIntent && viewerDivision && (
            <IntentChip
              proposedIntent={proposedIntent}
              value={intent}
              onChange={setIntent}
              division={viewerDivision}
              disabled={pending}
            />
          )}

          {showCasePicker && (
            <fieldset className="space-y-2">
              <legend className="sr-only">Active cases for this patient</legend>
              {sortedCases.map((c) => (
                <CaseRadio
                  key={c.id}
                  caseRow={c}
                  selected={caseId === c.id}
                  isHero={c.id === heroCaseId}
                  onSelect={() => {
                    setCaseId(c.id);
                    setEpisodeChoice('');
                  }}
                  disabled={pending}
                />
              ))}
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start gap-2"
                disabled={pending}
                onClick={() => setNewCaseOpen(true)}
              >
                <PlusCircle className="size-3.5" aria-hidden />
                New case management…
              </Button>
            </fieldset>
          )}

          {activeCases.length === 0 && !showCasePicker && (
            <StatusBanner variant="info">
              No cases on file — Miss Cleo will route this visit when you sign the note.
            </StatusBanner>
          )}

          {showRehabEpisodePicker && (
            <fieldset className="space-y-2 border-t pt-3">
              <legend className="text-sm font-medium">Rehab episode for this case</legend>
              {rehabEpisodes.map((ep) => (
                <EpisodeRadio
                  key={ep.id}
                  episode={ep}
                  selected={episodeChoice === ep.id}
                  onSelect={() => setEpisodeChoice(ep.id)}
                  disabled={pending}
                />
              ))}
              <SkipRadio
                selected={episodeChoice === NO_EPISODE}
                onSelect={() => setEpisodeChoice(NO_EPISODE)}
                disabled={pending}
              />
            </fieldset>
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
            disabled={
              pending ||
              (showCasePicker && (!caseId || caseId === NEW_CASE)) ||
              (showRehabEpisodePicker && !episodeChoice) ||
              (sitesGovernedHere && !siteId) ||
              dateInvalid
            }
          >
            {pending ? 'Starting…' : isBackdated ? 'Start late entry' : 'Start visit'}
          </Button>
        </SheetFooter>
      </SheetContent>
      <NewCaseDialog
        patientId={patientId}
        open={newCaseOpen}
        onOpenChange={setNewCaseOpen}
        onResolved={(id) => {
          setCaseId(id);
          setEpisodeChoice('');
        }}
      />
    </Sheet>
  );
}

function CaseRadio({
  caseRow,
  selected,
  onSelect,
  disabled,
  isHero = false,
}: {
  caseRow: StartVisitDialogCase;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
  /** Marks the algorithmically-recommended case — gets the "Your active case"
   *  / "Most recent case" pill. The radio dot still moves with the user's
   *  selection; the pill stays on the recommendation. */
  isHero?: boolean;
}) {
  // Prefer the viewing clinician's own activity for the subtitle — matches
  // the chart's hero framing. Fall back to overall activity.
  const viewerIso = caseRow.viewerLastActivityAt;
  const subtitle = viewerIso
    ? `your last visit ${relativeTimeAgo(viewerIso)}`
    : caseRow.lastActivityAt
      ? `last activity ${relativeTimeAgo(caseRow.lastActivityAt)} overall`
      : null;
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
        selected ? 'border-foreground/50 bg-muted/40' : 'border-border hover:bg-muted/30'
      } ${disabled ? 'pointer-events-none opacity-60' : ''}`}
    >
      <input
        type="radio"
        name="case-pick"
        checked={selected}
        onChange={onSelect}
        disabled={disabled}
        className="mt-1"
      />
      <div className="space-y-1 flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-sm">
            {caseRow.primaryIcd ? (
              <span className="font-mono text-xs mr-2">{caseRow.primaryIcd}</span>
            ) : null}
            {caseRow.primaryIcdLabel}
          </p>
          {isHero && (
            <StatusBadge
              variant={viewerIso ? 'success' : 'neutral'}
              noIcon
              className="text-[10px]"
            >
              {viewerIso ? 'Your active case' : 'Most recent case'}
            </StatusBadge>
          )}
        </div>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
    </label>
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
  const tail = relativeTimeAgo(iso);
  if (!tail) return '';
  // `relativeTimeAgo` returns "today" / "yesterday" / "3 days ago" etc.;
  // historical `lastVisitLabel` callers (EpisodeRadio) want the "last visit "
  // prefix wrapped around it.
  return `last visit ${tail}`;
}

/**
 * Just the relative-time tail — "today", "yesterday", "3 days ago",
 * "1 month ago", "2 years ago". No prefix; caller composes the phrasing
 * (e.g. "your last visit 3 days ago" vs. "last activity 3 days ago overall").
 */
function relativeTimeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1 month ago';
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(months / 12);
  if (years === 1) return '1 year ago';
  return `${years} years ago`;
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
      // Sprint 0.13 — only send caseManagementId when explicit (override
      // path). Default flow omits the field; the server auto-creates a
      // PENDING_ROUTER case and Miss Cleo proposes the destination at
      // review time.
      ...(args.caseManagementId ? { caseManagementId: args.caseManagementId } : {}),
      ...(args.siteId ? { siteId: args.siteId } : {}),
      ...(args.episodeOfCareId ? { episodeOfCareId: args.episodeOfCareId } : {}),
      ...(args.dateOfService ? { dateOfService: args.dateOfService } : {}),
      // Unit 48 PR2 — forward intent + intentSource when supplied. Omitted
      // by legacy callers; server defaults to UNSPECIFIED + CLINICIAN.
      ...(args.intent ? { intent: args.intent } : {}),
      ...(args.intentSource ? { intentSource: args.intentSource } : {}),
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
