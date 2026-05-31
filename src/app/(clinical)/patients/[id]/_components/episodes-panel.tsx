'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, Plus, RotateCw, XCircle } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import { MeterBar } from '@/components/ui/meter-bar';
import { Sparkline } from '@/components/ui/sparkline';
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
import { GoalDetailSheet } from './goal-detail-sheet';
import type { GoalProgressEntryRow } from './goal-detail-sheet';

type EpisodeGoal = {
  id: string;
  goalType: 'STG' | 'LTG';
  goalText: string;
  status: 'ACTIVE' | 'MET' | 'NOT_MET' | 'MODIFIED' | 'DISCONTINUED' | 'PARTIALLY_MET';
  currentMeasure: string | null;
  targetMeasure: string | null;
  progressEntries: GoalProgressEntryRow[];
};

type Episode = {
  id: string;
  diagnosis: string;
  bodyPart: string | null;
  division: string;
  status: 'ACTIVE' | 'RECERT_DUE' | 'DISCHARGED' | 'CANCELLED';
  recertDueAt: string | null;
  recertIntervalDays: number;
  visitsAuthorized: number | null;
  visitsCompleted: number;
  closeReason: string | null;
  reopenReason: string | null;
  department: { name: string };
  goals: EpisodeGoal[];
};

const STATUS_REQUIRING_DELTA = new Set(['MODIFIED', 'DISCONTINUED']);

const GOAL_STATUS_OPTIONS: EpisodeGoal['status'][] = [
  'ACTIVE',
  'MET',
  'PARTIALLY_MET',
  'MODIFIED',
  'NOT_MET',
  'DISCONTINUED',
];

/**
 * EpisodesPanel — Sprint 0.10 update to the Unit 11 surface.
 *
 * New in Sprint 0.10:
 *   - "Add goal" inline form (POST /api/episodes/[id]/goals).
 *   - `currentMeasure` input in the GoalRow editor.
 *   - "History (N)" button opens GoalDetailSheet (right-side sheet, ChartDetailSheet pattern).
 *   - `canEdit` prop hides mutating controls for VIEWER role.
 */
export function EpisodesPanel({
  patientId,
  episodes,
  canEdit = true,
  embedded = false,
}: {
  patientId: string;
  episodes: Episode[];
  canEdit?: boolean;
  /** When nested inside a Case card, omit the outer Card chrome. */
  embedded?: boolean;
}) {
  const list = (
    <>
      {episodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No episodes on file.</p>
      ) : (
        episodes.map((ep) => (
          <EpisodeCard
            key={ep.id}
            patientId={patientId}
            episode={ep}
            defaultExpanded={episodes.length === 1}
            canEdit={canEdit}
          />
        ))
      )}
    </>
  );

  if (embedded) {
    return <div className="space-y-3">{list}</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-md">Rehab episodes of care</CardTitle>
        <CardDescription>
          Plans of care under this case — recert, visit auth, and goals.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">{list}</CardContent>
    </Card>
  );
}

function EpisodeCard({
  patientId,
  episode,
  defaultExpanded,
  canEdit,
}: {
  patientId: string;
  episode: Episode;
  defaultExpanded: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [closeOpen, setCloseOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recertCells = recertCellInfo(episode.recertDueAt, episode.status);
  const visitCells = visitCellInfo(episode.visitsCompleted, episode.visitsAuthorized);
  const recertMeter = recertMeterInfo(
    episode.recertDueAt,
    episode.recertIntervalDays,
    episode.status,
  );
  const visitMeter = visitMeterInfo(episode.visitsCompleted, episode.visitsAuthorized);
  const isClosed = episode.status === 'DISCHARGED' || episode.status === 'CANCELLED';

  async function recertify() {
    setError(null);
    const res = await fetch(`/api/episodes/${episode.id}/recertify`, { method: 'POST' });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? `Recertify failed (${res.status}).`);
      return;
    }
    void patientId;
    router.refresh();
  }

  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          className="flex items-start gap-2 text-left flex-1 min-w-0"
        >
          {expanded ? (
            <ChevronDown className="size-4 mt-1 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRight className="size-4 mt-1 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{episode.diagnosis}</p>
              {episode.bodyPart && (
                <span className="text-muted-foreground text-sm">({episode.bodyPart})</span>
              )}
              <StatusBadge variant="neutral" noIcon>{episode.division}</StatusBadge>
              <StatusBadge variant={statusVariant(episode.status)} noIcon>
                {episode.status}
              </StatusBadge>
            </div>
            <p className="text-xs text-muted-foreground">{episode.department.name}</p>
          </div>
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 pl-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <StatusBadge variant={recertCells.variant} noIcon>{recertCells.label}</StatusBadge>
              <StatusBadge variant={visitCells.variant} noIcon>{visitCells.label}</StatusBadge>
            </div>
            {(recertMeter || visitMeter) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 max-w-md">
                {recertMeter && (
                  <MeterBar
                    value={recertMeter.value}
                    max={recertMeter.max}
                    variant={recertMeter.variant}
                    aria-label={recertCells.label}
                  />
                )}
                {visitMeter && (
                  <MeterBar
                    value={visitMeter.value}
                    max={visitMeter.max}
                    variant={visitMeter.variant}
                    aria-label={visitCells.label}
                  />
                )}
              </div>
            )}
          </div>

          {error && <StatusBanner variant="danger">{error}</StatusBanner>}

          {canEdit && !isClosed && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={recertify} className="gap-1">
                <RotateCw className="size-3" aria-hidden />
                Recertify
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setCloseOpen(true)}
                className="gap-1 text-[var(--status-danger-fg)]"
              >
                <XCircle className="size-3" aria-hidden />
                Close episode
              </Button>
            </div>
          )}

          {canEdit && isClosed && (
            <div className="space-y-2">
              {episode.closeReason && (
                <p className="text-xs text-muted-foreground italic">
                  Closed: {episode.closeReason}
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setReopenOpen(true)}
                className="gap-1"
              >
                <RotateCw className="size-3" aria-hidden />
                Reopen
              </Button>
            </div>
          )}

          <GoalsSection
            episodeId={episode.id}
            goals={episode.goals}
            disabled={isClosed}
            canEdit={canEdit}
            onChange={() => router.refresh()}
          />
        </div>
      )}

      <CloseDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        episodeId={episode.id}
        episodeLabel={episode.diagnosis}
        onClosed={() => router.refresh()}
      />
      <ReopenDialog
        open={reopenOpen}
        onOpenChange={setReopenOpen}
        episodeId={episode.id}
        episodeLabel={episode.diagnosis}
        onReopened={() => router.refresh()}
      />
    </div>
  );
}

function recertCellInfo(dueAt: string | null, status: Episode['status']) {
  if (!dueAt) return { label: 'no recert set', variant: 'neutral' as const };
  const days = Math.floor((new Date(dueAt).getTime() - Date.now()) / 86_400_000);
  if (status === 'DISCHARGED' || status === 'CANCELLED') {
    return { label: 'recert n/a', variant: 'neutral' as const };
  }
  if (days < 0) return { label: `recert overdue ${-days}d`, variant: 'danger' as const };
  if (days < 7) return { label: `recert in ${days}d`, variant: 'danger' as const };
  if (days < 30) return { label: `recert in ${days}d`, variant: 'warning' as const };
  return { label: `recert in ${days}d`, variant: 'success' as const };
}

function visitCellInfo(completed: number, authorized: number | null) {
  if (authorized == null) return { label: `${completed} visits`, variant: 'neutral' as const };
  if (completed >= authorized) return { label: `${completed} / ${authorized} at cap`, variant: 'danger' as const };
  const pct = completed / authorized;
  if (pct >= 0.8) return { label: `${completed} / ${authorized}`, variant: 'warning' as const };
  return { label: `${completed} / ${authorized}`, variant: 'success' as const };
}

type MeterInfo = { value: number; max: number; variant: 'primary' | 'success' | 'warning' | 'danger' };

/**
 * Recert window as a meter — fill grows as the recert deadline approaches.
 * Thresholds mirror recertCellInfo so meter color matches the badge.
 * Null when there's no recert date or the episode is closed (no badge meter).
 */
function recertMeterInfo(
  dueAt: string | null,
  intervalDays: number,
  status: Episode['status'],
): MeterInfo | null {
  if (!dueAt || status === 'DISCHARGED' || status === 'CANCELLED') return null;
  const max = intervalDays > 0 ? intervalDays : 1;
  const days = Math.floor((new Date(dueAt).getTime() - Date.now()) / 86_400_000);
  const elapsed = Math.max(0, Math.min(max, max - days));
  const variant: MeterInfo['variant'] = days < 7 ? 'danger' : days < 30 ? 'warning' : 'success';
  return { value: elapsed, max, variant };
}

/**
 * Visit-cap usage as a meter — fill grows toward the authorized cap.
 * Thresholds mirror visitCellInfo. Null when no authorization is on file.
 */
function visitMeterInfo(completed: number, authorized: number | null): MeterInfo | null {
  if (authorized == null || authorized <= 0) return null;
  const pct = completed / authorized;
  const variant: MeterInfo['variant'] =
    completed >= authorized ? 'danger' : pct >= 0.8 ? 'warning' : 'success';
  return { value: completed, max: authorized, variant };
}

function statusVariant(status: Episode['status']): 'success' | 'warning' | 'neutral' | 'danger' {
  switch (status) {
    case 'ACTIVE':
      return 'success';
    case 'RECERT_DUE':
      return 'warning';
    case 'DISCHARGED':
      return 'neutral';
    case 'CANCELLED':
      return 'danger';
  }
}

// ---------------------------------------------------------------------------
// Goals section
// ---------------------------------------------------------------------------

function GoalsSection({
  episodeId,
  goals,
  disabled,
  canEdit,
  onChange,
}: {
  episodeId: string;
  goals: EpisodeGoal[];
  disabled: boolean;
  canEdit: boolean;
  onChange: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  // Track which goal's detail sheet is open (null = none).
  const [detailGoalId, setDetailGoalId] = useState<string | null>(null);
  const detailGoal = goals.find((g) => g.id === detailGoalId) ?? null;

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Goals</p>
        {canEdit && !disabled && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 text-xs"
            onClick={() => setAddOpen((x) => !x)}
          >
            <Plus className="size-3" aria-hidden />
            Add goal
          </Button>
        )}
      </div>

      {/* Add goal form */}
      {addOpen && canEdit && !disabled && (
        <AddGoalForm
          episodeId={episodeId}
          onAdded={() => {
            setAddOpen(false);
            onChange();
          }}
          onCancel={() => setAddOpen(false)}
        />
      )}

      {goals.length === 0 && !addOpen ? (
        <p className="text-xs text-muted-foreground italic">No goals on this episode yet.</p>
      ) : (
        <ul className="space-y-2">
          {goals.map((g) => (
            <li key={g.id} className="rounded border border-border bg-muted/30 p-2 text-sm">
              <GoalRow
                goal={g}
                episodeId={episodeId}
                disabled={disabled}
                canEdit={canEdit}
                onOpenDetail={() => setDetailGoalId(g.id)}
                onChange={onChange}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Goal detail sheet — right-side drill-down for the progression trail */}
      {detailGoal && (
        <GoalDetailSheet
          open={!!detailGoalId}
          onOpenChange={(open) => { if (!open) setDetailGoalId(null); }}
          goalText={detailGoal.goalText}
          goalType={detailGoal.goalType}
          currentMeasure={detailGoal.currentMeasure}
          targetMeasure={detailGoal.targetMeasure}
          progressEntries={detailGoal.progressEntries}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add goal form — inline, calls POST /api/episodes/[id]/goals
// ---------------------------------------------------------------------------

function AddGoalForm({
  episodeId,
  onAdded,
  onCancel,
}: {
  episodeId: string;
  onAdded: () => void;
  onCancel: () => void;
}) {
  const [goalType, setGoalType] = useState<'STG' | 'LTG'>('LTG');
  const [goalText, setGoalText] = useState('');
  const [baseline, setBaseline] = useState('');
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!goalText.trim()) {
      setError('Goal text is required.');
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/episodes/${episodeId}/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goalType,
          goalText: goalText.trim(),
          baselineMeasure: baseline.trim() || null,
          targetMeasure: target.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Failed to add goal (${res.status}).`);
        return;
      }
      setGoalText('');
      setBaseline('');
      setTarget('');
      onAdded();
    });
  }

  return (
    <div className="rounded border border-border bg-card p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Label className="text-xs">Type</Label>
        {(['STG', 'LTG'] as const).map((t) => (
          <Button
            key={t}
            type="button"
            variant={goalType === t ? 'default' : 'outline'}
            size="sm"
            className="h-6 text-xs px-2"
            onClick={() => setGoalType(t)}
            disabled={pending}
          >
            {t}
          </Button>
        ))}
      </div>
      <div className="space-y-1">
        <Label htmlFor="new-goal-text" className="text-xs">Goal text</Label>
        <Textarea
          id="new-goal-text"
          value={goalText}
          onChange={(e) => setGoalText(e.target.value.slice(0, 500))}
          rows={2}
          maxLength={500}
          disabled={pending}
          placeholder="e.g. Achieve 120° shoulder flexion with full ADL function within 8 weeks."
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="new-goal-baseline" className="text-xs">Baseline (optional)</Label>
          <Input
            id="new-goal-baseline"
            value={baseline}
            onChange={(e) => setBaseline(e.target.value.slice(0, 120))}
            maxLength={120}
            disabled={pending}
            placeholder="e.g. 80°"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-goal-target" className="text-xs">Target (optional)</Label>
          <Input
            id="new-goal-target"
            value={target}
            onChange={(e) => setTarget(e.target.value.slice(0, 120))}
            maxLength={120}
            disabled={pending}
            placeholder="e.g. 170°"
          />
        </div>
      </div>
      {error && <p className="text-xs text-[var(--status-danger-fg)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={submit} disabled={pending}>
          {pending ? 'Adding…' : 'Add goal'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Goal row — status + measure editor + history button
// ---------------------------------------------------------------------------

function GoalRow({
  goal,
  episodeId,
  disabled,
  canEdit,
  onOpenDetail,
  onChange,
}: {
  goal: EpisodeGoal;
  episodeId: string;
  disabled: boolean;
  canEdit: boolean;
  onOpenDetail: () => void;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [nextStatus, setNextStatus] = useState<EpisodeGoal['status']>(goal.status);
  const [currentMeasure, setCurrentMeasure] = useState(goal.currentMeasure ?? '');
  const [deltaNote, setDeltaNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const needsDelta = STATUS_REQUIRING_DELTA.has(nextStatus) && nextStatus !== goal.status;

  function commit() {
    setError(null);
    if (needsDelta && deltaNote.trim().length < 1) {
      setError('Delta note required for MODIFIED / DISCONTINUED.');
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/episodes/${episodeId}/goals/${goal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: nextStatus,
          currentMeasure: currentMeasure.trim() || null,
          ...(deltaNote.trim() ? { deltaNote: deltaNote.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Save failed (${res.status}).`);
        return;
      }
      setEditing(false);
      setDeltaNote('');
      onChange();
    });
  }

  const trailCount = goal.progressEntries.length;
  const goalSeries = buildGoalSeries(goal.progressEntries);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start gap-2">
        <StatusBadge variant="neutral" noIcon>{goal.goalType}</StatusBadge>
        <p className="flex-1 min-w-0">{goal.goalText}</p>
        <StatusBadge variant={goalStatusVariant(goal.status)} noIcon>
          {goal.status}
        </StatusBadge>
      </div>
      {(goal.currentMeasure || goal.targetMeasure) && (
        <p className="text-xs text-muted-foreground">
          {goal.currentMeasure ?? '—'} → target {goal.targetMeasure ?? '—'}
        </p>
      )}

      {/* Action row */}
      {!editing && (
        <div className="flex items-center gap-1 flex-wrap">
          {canEdit && !disabled && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditing(true)}
              className="text-xs"
            >
              Update
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onOpenDetail}
            className="text-xs text-muted-foreground"
          >
            History{trailCount > 0 ? ` (${trailCount})` : ''}
          </Button>
          {goalSeries && <Sparkline points={goalSeries} className="ml-auto" />}
        </div>
      )}

      {editing && (
        <div className="space-y-2 rounded border border-border bg-card p-2">
          {/* Measure field — backend already supported, now surfaced in UI */}
          <div className="space-y-1">
            <Label htmlFor={`measure-${goal.id}`} className="text-xs">
              Current measure
            </Label>
            <Input
              id={`measure-${goal.id}`}
              value={currentMeasure}
              onChange={(e) => setCurrentMeasure(e.target.value.slice(0, 120))}
              maxLength={120}
              disabled={pending}
              placeholder={goal.targetMeasure ? `Target: ${goal.targetMeasure}` : 'e.g. 110°'}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">New status</Label>
            <Select
              value={nextStatus}
              onValueChange={(v) => setNextStatus(v as EpisodeGoal['status'])}
            >
              <SelectTrigger disabled={pending}><SelectValue /></SelectTrigger>
              <SelectContent>
                {GOAL_STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {needsDelta && (
            <>
              <Label className="text-xs">
                Reason (required for {nextStatus.toLowerCase()})
              </Label>
              <Textarea
                value={deltaNote}
                onChange={(e) => setDeltaNote(e.target.value.slice(0, 500))}
                rows={2}
                maxLength={500}
                disabled={pending}
                placeholder="Why is this goal being changed?"
              />
            </>
          )}
          {error && <p className="text-xs text-[var(--status-danger-fg)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                setNextStatus(goal.status);
                setCurrentMeasure(goal.currentMeasure ?? '');
                setDeltaNote('');
                setError(null);
              }}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={commit} disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function goalStatusVariant(status: EpisodeGoal['status']) {
  switch (status) {
    case 'MET':
    case 'ACTIVE':
      return 'success' as const;
    case 'PARTIALLY_MET':
    case 'MODIFIED':
      return 'warning' as const;
    case 'DISCONTINUED':
    case 'NOT_MET':
      return 'danger' as const;
  }
}

/** First number in a free-text measure (e.g. "110°" → 110, "4/10" → 4). */
function parseFirstNumber(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Chronological numeric series from a goal's progression trail. Entries arrive
 * newest-first (recordedAt desc), so reverse to oldest→newest. Real data only:
 * returns undefined with fewer than 2 numeric points (auditor lens — never
 * fabricate a trend line).
 */
function buildGoalSeries(entries: GoalProgressEntryRow[]): number[] | undefined {
  const nums = [...entries]
    .reverse()
    .map((e) => parseFirstNumber(e.measureValue))
    .filter((n): n is number => n !== null);
  return nums.length >= 2 ? nums : undefined;
}

// ---------------------------------------------------------------------------
// Close / Reopen dialogs (unchanged from Unit 11)
// ---------------------------------------------------------------------------

function CloseDialog({
  open,
  onOpenChange,
  episodeId,
  episodeLabel,
  onClosed,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  episodeId: string;
  episodeLabel: string;
  onClosed: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmClose() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/episodes/${episodeId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Close failed (${res.status}).`);
        return;
      }
      setReason('');
      onOpenChange(false);
      onClosed();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Close &ldquo;{episodeLabel}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            DISCHARGED status preserves all history. Open follow-ups for this episode are
            cascaded to CLOSED_BY_DISCHARGE automatically.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 px-1">
          <Label htmlFor="close-reason" className="text-xs">
            Reason (optional, ≤500 chars)
          </Label>
          <Textarea
            id="close-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            rows={2}
            maxLength={500}
            disabled={pending}
          />
          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              confirmClose();
            }}
            disabled={pending}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {pending ? 'Closing…' : 'Close episode'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ReopenDialog({
  open,
  onOpenChange,
  episodeId,
  episodeLabel,
  onReopened,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  episodeId: string;
  episodeLabel: string;
  onReopened: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmReopen() {
    setError(null);
    if (reason.trim().length < 10) {
      setError('Reason required (≥10 chars).');
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/episodes/${episodeId}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Reopen failed (${res.status}).`);
        return;
      }
      setReason('');
      onOpenChange(false);
      onReopened();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reopen &ldquo;{episodeLabel}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            Reopen sets status ACTIVE and resets the recert cycle.
            Closed-by-discharge follow-ups stay closed (re-create manually if needed).
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 px-1">
          <Label htmlFor="reopen-reason" className="text-xs">
            Reason (required, ≥10 chars)
          </Label>
          <Input
            id="reopen-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            maxLength={500}
            disabled={pending}
          />
          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              confirmReopen();
            }}
            disabled={pending}
          >
            {pending ? 'Reopening…' : 'Reopen episode'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
