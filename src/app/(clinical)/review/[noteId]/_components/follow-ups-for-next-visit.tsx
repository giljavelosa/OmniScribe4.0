'use client';

import { useState, useTransition } from 'react';
import { Plus, X, AlertCircle } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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

export type NextVisitFollowUp = {
  id: string;
  text: string;
  status: 'PROPOSED' | 'OPEN' | 'MET' | 'CARRIED' | 'DROPPED' | 'CLOSED_BY_DISCHARGE';
  createdAt: string;
};

type Props = {
  noteId: string;
  /** Rows whose originNoteId === this note. Server-fetched on first render. */
  initialRows: NextVisitFollowUp[];
  /** True when the Plan section has at least one follow-up keyword. Used to
   *  decide whether the soft nudge banner shows. */
  planHasFollowUps: boolean;
  /** False once the note is signed — disables add/delete affordances. */
  editable: boolean;
};

/**
 * FollowUpsForNextVisit — the "small box" on /review that lists follow-up
 * commitments TIED TO THIS NOTE. Sister card to `OpenFollowUpsCard` (which
 * shows commitments inherited from PRIOR notes).
 *
 * Empty + Plan has no follow-up keywords → soft nudge banner. Clinician can
 * still sign without adding anything (per the "soft nudge" scoping decision);
 * the banner just makes the gap visible.
 *
 * Adds POST /api/notes/[id]/followups; deletes set status DROPPED via PATCH
 * /api/follow-ups/[id] so audit history is preserved (Rule 7 spirit).
 */
export function FollowUpsForNextVisit({
  noteId,
  initialRows,
  planHasFollowUps,
  editable,
}: Props) {
  const [rows, setRows] = useState<NextVisitFollowUp[]>(initialRows);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startSave] = useTransition();
  const [deletePending, startDelete] = useTransition();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const openRows = rows.filter((r) => r.status === 'OPEN');
  const showNudge = editable && openRows.length === 0 && !planHasFollowUps;

  function saveDraft() {
    const text = draft.trim();
    if (text.length < 5) {
      setError('Add at least a few words so the next visit clinician knows what to check.');
      return;
    }
    setError(null);
    startSave(async () => {
      const res = await fetch(`/api/notes/${noteId}/followups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [text] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? 'Could not save follow-up. Please try again.');
        return;
      }
      const body = (await res.json()) as { data: { items: NextVisitFollowUp[] } };
      setRows((prev) => [...prev, ...body.data.items]);
      setDraft('');
      setAddOpen(false);
    });
  }

  function requestDelete(id: string) {
    setConfirmDeleteId(id);
  }

  function performDelete(id: string) {
    setConfirmDeleteId(null);
    startDelete(async () => {
      const res = await fetch(`/api/follow-ups/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'DROPPED',
          dropReason: 'Removed during review',
        }),
      });
      if (!res.ok) {
        // Best-effort: keep the row visible if the server rejected; surface
        // a brief inline banner via error state.
        setError('Could not remove that follow-up. Refresh and try again.');
        return;
      }
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: 'DROPPED' } : r)),
      );
    });
  }

  const confirmDeleteRow = confirmDeleteId
    ? rows.find((r) => r.id === confirmDeleteId)
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-md">Follow-ups for next visit</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {showNudge && (
          <StatusBanner variant="warning" title="No follow-up detected">
            <span className="text-xs">
              The AI didn&apos;t pick up a follow-up plan in this visit. Add one so the
              next clinician sees what to check.
            </span>
          </StatusBanner>
        )}

        {openRows.length === 0 && !showNudge && (
          <p className="text-sm text-muted-foreground">
            {editable
              ? 'No follow-ups yet. Add a commitment for the next visit.'
              : 'No follow-ups recorded for next visit.'}
          </p>
        )}

        {openRows.length > 0 && (
          <ul className="space-y-2">
            {openRows.map((row) => (
              <li
                key={row.id}
                className="flex items-start gap-2 rounded-lg border border-border p-3"
              >
                <span aria-hidden className="mt-0.5 text-muted-foreground">
                  ○
                </span>
                <p className="flex-1 text-sm">{row.text}</p>
                {editable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => requestDelete(row.id)}
                    disabled={deletePending}
                    aria-label="Remove this follow-up"
                    title="Remove"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {error && !addOpen && (
          <StatusBanner variant="danger" className="text-xs">
            <span className="inline-flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" aria-hidden />
              {error}
            </span>
          </StatusBanner>
        )}

        {editable && !addOpen && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setAddOpen(true);
              setError(null);
            }}
            className="w-full gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add follow-up
          </Button>
        )}

        {editable && addOpen && (
          <div className="space-y-2 rounded-md border border-border p-2 bg-muted/30">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, 500))}
              rows={3}
              maxLength={500}
              autoFocus
              placeholder="e.g. Check ROM and recheck functional capacity with treadmill ambulation next visit"
              disabled={pending}
            />
            {error && (
              <p className="text-xs text-[var(--status-danger-fg)]">{error}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAddOpen(false);
                  setDraft('');
                  setError(null);
                }}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={saveDraft}
                disabled={pending || draft.trim().length < 5}
              >
                {pending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <AlertDialog
        open={!!confirmDeleteRow}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove follow-up?</AlertDialogTitle>
            <AlertDialogDescription>
              This commitment won&apos;t appear on the next visit. The action is logged
              in the audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDeleteRow && performDelete(confirmDeleteRow.id)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
