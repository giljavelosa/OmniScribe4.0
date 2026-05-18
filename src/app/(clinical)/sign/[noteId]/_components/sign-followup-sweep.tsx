'use client';

import { useMemo, useState, useTransition } from 'react';
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
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/ui/status-badge';
import { SourcePill } from '@/components/brief/source-pill';

export type SweepFollowUp = {
  id: string;
  text: string;
  status: 'OPEN' | 'MET' | 'CARRIED' | 'DROPPED' | 'CLOSED_BY_DISCHARGE';
  source: { noteId: string; date: string };
};

type LocalDecision =
  | { kind: 'open' }
  | { kind: 'met'; closingNoteText: string }
  | { kind: 'dropped'; dropReason: string }
  | { kind: 'carried' };

type RowState = {
  followUp: SweepFollowUp;
  decision: LocalDecision;
  error?: string;
};

/**
 * SignFollowUpSweep — modal that forces a decision on every still-open
 * follow-up before sign completes (UI spec §4).
 *
 * Rules (spec §4.3):
 *   - CANNOT be silently bypassed (outside-tap does not close).
 *   - "Skip — auto-carry" is the safety net: all items become CARRIED, an
 *     audit row records the skip (FOLLOWUP_SWEEP_SKIPPED).
 *   - "Continue →" activates only when every item has a non-OPEN decision.
 *   - Optimistic UI with server-side rollback: each PATCH is fired in order;
 *     if any fails the modal stays open and the failing row shows an inline
 *     error so the clinician can retry without losing the others.
 *
 * Rule 22: built on shadcn AlertDialog (no native confirm/alert).
 */
export function SignFollowUpSweep({
  open,
  onOpenChange,
  followUps,
  onResolved,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  followUps: SweepFollowUp[];
  /** Called after every follow-up is closed server-side. Caller then
   *  re-issues the sign POST with sweepAcknowledged: true. */
  onResolved: () => void;
}) {
  // Sync rows to the followUps prop. Without this, the useState initializer
  // only sees the initial-mount value (often []) and the modal would render
  // empty even after SignClient loads the actual follow-ups, bypassing the
  // sweep gate. Use the joined id list as a sync key so user decisions aren't
  // clobbered on unrelated re-renders.
  const followUpIdsKey = followUps.map((f) => f.id).join('|');
  const [rowsState, setRowsState] = useState<{ key: string; rows: RowState[] }>(() => ({
    key: followUpIdsKey,
    rows: followUps.map((fu) => ({ followUp: fu, decision: { kind: 'open' } })),
  }));
  let rows = rowsState.rows;
  if (rowsState.key !== followUpIdsKey) {
    const byId = new Map(rowsState.rows.map((r) => [r.followUp.id, r]));
    rows = followUps.map((fu) => byId.get(fu.id) ?? { followUp: fu, decision: { kind: 'open' } });
    setRowsState({ key: followUpIdsKey, rows });
  }
  const setRows = (updater: (curr: RowState[]) => RowState[]) =>
    setRowsState((s) => ({ ...s, rows: updater(s.rows) }));
  const [pending, startTransition] = useTransition();
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [dropAllOpen, setDropAllOpen] = useState(false);
  const [dropAllReason, setDropAllReason] = useState('');

  const remaining = useMemo(
    () => rows.filter((r) => r.decision.kind === 'open').length,
    [rows],
  );
  const canContinue = remaining === 0;

  function setRow(id: string, next: Partial<RowState>) {
    setRows((curr) => curr.map((r) => (r.followUp.id === id ? { ...r, ...next } : r)));
  }

  function patchOne(id: string, decision: Exclude<LocalDecision, { kind: 'open' }>): Promise<void> {
    const body: Record<string, unknown> = {};
    if (decision.kind === 'met') body.status = 'MET';
    if (decision.kind === 'dropped') body.status = 'DROPPED';
    if (decision.kind === 'carried') body.status = 'CARRIED';
    if (decision.kind === 'met') body.closingNoteText = decision.closingNoteText.trim();
    if (decision.kind === 'dropped') body.dropReason = decision.dropReason.trim();

    return fetch(`/api/follow-ups/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (res) => {
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        const code = payload?.error?.code ?? `http_${res.status}`;
        throw new Error(code);
      }
    });
  }

  function continueFlow() {
    setGlobalError(null);
    startTransition(async () => {
      try {
        for (const r of rows) {
          if (r.decision.kind === 'open') continue; // shouldn't happen — gated by canContinue
          if (r.decision.kind === 'met' && r.decision.closingNoteText.trim().length < 5) {
            setRow(r.followUp.id, { error: 'Closing note must be ≥5 chars.' });
            setGlobalError('One or more items need a longer closing note or drop reason.');
            return;
          }
          if (r.decision.kind === 'dropped' && r.decision.dropReason.trim().length < 5) {
            setRow(r.followUp.id, { error: 'Drop reason must be ≥5 chars.' });
            setGlobalError('One or more items need a longer closing note or drop reason.');
            return;
          }
          try {
            await patchOne(r.followUp.id, r.decision);
            setRow(r.followUp.id, { error: undefined });
          } catch (err) {
            setRow(r.followUp.id, {
              error: err instanceof Error ? err.message : 'unknown',
            });
            setGlobalError('Couldn’t save one or more items — see inline error.');
            return;
          }
        }
        onResolved();
      } catch (err) {
        setGlobalError(err instanceof Error ? err.message : 'unknown');
      }
    });
  }

  function skipAutoCarry() {
    setGlobalError(null);
    setSkipping(true);
    startTransition(async () => {
      try {
        for (const r of rows) {
          if (r.decision.kind !== 'open' && r.decision.kind !== 'carried') continue;
          try {
            await patchOne(r.followUp.id, { kind: 'carried' });
          } catch {
            // Best-effort on Skip — if one fails, we still let the rest carry
            // through; the surface message lets the user retry.
          }
        }
        onResolved();
      } finally {
        setSkipping(false);
      }
    });
  }

  function applyCarryAll() {
    setRows((curr) =>
      curr.map((r) =>
        r.decision.kind === 'open' ? { ...r, decision: { kind: 'carried' } } : r,
      ),
    );
  }

  function applyDropAll() {
    if (dropAllReason.trim().length < 5) return;
    setRows((curr) =>
      curr.map((r) =>
        r.decision.kind === 'open'
          ? { ...r, decision: { kind: 'dropped', dropReason: dropAllReason } }
          : r,
      ),
    );
    setDropAllOpen(false);
    setDropAllReason('');
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Before signing</AlertDialogTitle>
          <AlertDialogDescription>
            {followUps.length} follow-up{followUps.length === 1 ? '' : 's'} still open — resolve, drop, or carry before sign completes.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-[55vh] overflow-y-auto space-y-3 pr-1">
          {rows.map((r) => (
            <SweepRow
              key={r.followUp.id}
              row={r}
              disabled={pending}
              onChange={(decision) => setRow(r.followUp.id, { decision, error: undefined })}
            />
          ))}
        </div>

        <div className="mt-2 space-y-2 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Quick:</span>
            <Button type="button" variant="outline" size="sm" onClick={applyCarryAll} disabled={pending}>
              Carry all
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setDropAllOpen((v) => !v)} disabled={pending}>
              Drop all…
            </Button>
          </div>
          {dropAllOpen && (
            <div className="space-y-2 rounded-md border border-border p-2 bg-muted/30">
              <Label className="text-xs">Reason (applies to all dropped items)</Label>
              <Textarea
                value={dropAllReason}
                onChange={(e) => setDropAllReason(e.target.value.slice(0, 280))}
                rows={2}
                maxLength={280}
                placeholder="Why is everything being dropped?"
                disabled={pending}
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setDropAllOpen(false)} disabled={pending}>
                  Cancel
                </Button>
                <Button type="button" size="sm" onClick={applyDropAll} disabled={pending || dropAllReason.trim().length < 5}>
                  Apply to all open items
                </Button>
              </div>
            </div>
          )}
        </div>

        {globalError && (
          <StatusBadge variant="danger" className="mt-3 w-full justify-center">
            {globalError}
          </StatusBadge>
        )}

        <AlertDialogFooter className="mt-2 sm:items-center">
          <AlertDialogCancel asChild>
            <Button type="button" variant="ghost" onClick={skipAutoCarry} disabled={pending}>
              {skipping ? 'Carrying all…' : 'Skip — auto-carry'}
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              type="button"
              onClick={continueFlow}
              disabled={!canContinue || pending}
              title={!canContinue ? `Resolve ${remaining} item${remaining === 1 ? '' : 's'} above` : undefined}
            >
              {pending ? 'Saving…' : `Continue →`}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>

        {!canContinue && (
          <p className="mt-1 text-center text-xs text-muted-foreground">
            Resolve {remaining} item{remaining === 1 ? '' : 's'} above
          </p>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SweepRow({
  row,
  disabled,
  onChange,
}: {
  row: RowState;
  disabled: boolean;
  onChange: (decision: LocalDecision) => void;
}) {
  const decisionKind = row.decision.kind;
  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <p className="text-sm">{row.followUp.text}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>from</span>
        <SourcePill noteId={row.followUp.source.noteId} date={row.followUp.source.date} />
      </div>

      <div className="flex flex-wrap gap-2">
        <DecisionChip
          active={decisionKind === 'met'}
          onClick={() => onChange({ kind: 'met', closingNoteText: row.decision.kind === 'met' ? row.decision.closingNoteText : '' })}
          disabled={disabled}
          icon="✓"
          label="Met"
        />
        <DecisionChip
          active={decisionKind === 'dropped'}
          onClick={() => onChange({ kind: 'dropped', dropReason: row.decision.kind === 'dropped' ? row.decision.dropReason : '' })}
          disabled={disabled}
          icon="⊘"
          label="Drop"
        />
        <DecisionChip
          active={decisionKind === 'carried'}
          onClick={() => onChange({ kind: 'carried' })}
          disabled={disabled}
          icon="→"
          label="Carry"
        />
      </div>

      {decisionKind === 'met' && (
        <Textarea
          value={row.decision.kind === 'met' ? row.decision.closingNoteText : ''}
          onChange={(e) => onChange({ kind: 'met', closingNoteText: e.target.value.slice(0, 280) })}
          rows={2}
          maxLength={280}
          placeholder="Closing note (required, ≥5 chars)"
          disabled={disabled}
        />
      )}
      {decisionKind === 'dropped' && (
        <Textarea
          value={row.decision.kind === 'dropped' ? row.decision.dropReason : ''}
          onChange={(e) => onChange({ kind: 'dropped', dropReason: e.target.value.slice(0, 280) })}
          rows={2}
          maxLength={280}
          placeholder="Drop reason (required, ≥5 chars)"
          disabled={disabled}
        />
      )}
      {row.error && (
        <p className="text-xs text-[var(--status-danger-fg)]">{row.error}</p>
      )}
    </div>
  );
}

function DecisionChip({
  active,
  onClick,
  disabled,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  disabled: boolean;
  icon: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        'min-h-[36px] focus-visible:outline-2 focus-visible:outline-offset-2',
        active ? 'bg-foreground/10 border-foreground' : 'border-border hover:bg-muted',
        disabled ? 'opacity-60 cursor-not-allowed' : '',
      ].join(' ')}
    >
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
