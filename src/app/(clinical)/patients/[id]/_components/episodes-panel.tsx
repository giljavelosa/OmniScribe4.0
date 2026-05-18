'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, RotateCw, XCircle } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

type EpisodeGoal = {
  id: string;
  goalType: 'STG' | 'LTG';
  goalText: string;
  status: 'ACTIVE' | 'MET' | 'NOT_MET' | 'MODIFIED' | 'DISCONTINUED' | 'PARTIALLY_MET';
  currentMeasure: string | null;
  targetMeasure: string | null;
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
 * EpisodesPanel — Unit 11 surface for episode lifecycle + goal progression
 * on /patients/[id]. Inline-editable goal status + per-episode actions
 * (recertify / close / reopen). Patient's primary division is shown so a
 * per-episode division override surfaces clearly.
 */
export function EpisodesPanel({
  patientId,
  patientDivision,
  episodes,
}: {
  patientId: string;
  patientDivision: string;
  episodes: Episode[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-md">Episodes of care</CardTitle>
        <CardDescription>
          Active + recert-due + discharged. Per-episode division override flagged when it
          differs from the patient&apos;s primary division ({patientDivision}).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {episodes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No episodes on file.</p>
        ) : (
          episodes.map((ep) => (
            <EpisodeCard
              key={ep.id}
              patientId={patientId}
              patientDivision={patientDivision}
              episode={ep}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function EpisodeCard({
  patientId,
  patientDivision,
  episode,
}: {
  patientId: string;
  patientDivision: string;
  episode: Episode;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(true);
  const [closeOpen, setCloseOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const divisionOverride = episode.division !== patientDivision;
  const recertCells = recertCellInfo(episode.recertDueAt, episode.status);
  const visitCells = visitCellInfo(episode.visitsCompleted, episode.visitsAuthorized);
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
              {divisionOverride && (
                <StatusBadge variant="warning" noIcon>
                  ≠ patient ({patientDivision})
                </StatusBadge>
              )}
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
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <StatusBadge variant={recertCells.variant} noIcon>{recertCells.label}</StatusBadge>
            <StatusBadge variant={visitCells.variant} noIcon>{visitCells.label}</StatusBadge>
          </div>

          {error && <StatusBanner variant="danger">{error}</StatusBanner>}

          {!isClosed && (
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

          {isClosed && (
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

function GoalsSection({
  episodeId,
  goals,
  disabled,
  onChange,
}: {
  episodeId: string;
  goals: EpisodeGoal[];
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Goals</p>
      {goals.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No goals on this episode yet.</p>
      ) : (
        <ul className="space-y-2">
          {goals.map((g) => (
            <li key={g.id} className="rounded border border-border bg-muted/30 p-2 text-sm">
              <GoalRow goal={g} episodeId={episodeId} disabled={disabled} onChange={onChange} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GoalRow({
  goal,
  episodeId,
  disabled,
  onChange,
}: {
  goal: EpisodeGoal;
  episodeId: string;
  disabled: boolean;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [nextStatus, setNextStatus] = useState<EpisodeGoal['status']>(goal.status);
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
      {!editing && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setEditing(true)}
          className="text-xs"
        >
          Update status
        </Button>
      )}
      {editing && (
        <div className="space-y-2 rounded border border-border bg-card p-2">
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

  function confirm() {
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
            // Suppress Radix auto-close so async errors land in the still-mounted
            // dialog instead of disappearing with it.
            onClick={(e) => {
              e.preventDefault();
              confirm();
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

  function confirm() {
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
              confirm();
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
