'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { UserAvatar } from '@/components/ui/user-avatar';
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

/**
 * DraftsList — the home "Drafts" surface, rendered in both the mobile section
 * and the desktop card. It lists two kinds of unfinished work:
 *
 *   • in-progress drafts (DRAFT / REVIEWING / PENDING_REVIEW) → tap opens
 *     /review to keep editing;
 *   • unfinished recordings (RECORDING / PAUSED) → tap opens /capture to
 *     resume the walked-away-from capture session.
 *
 * Every row carries a delete (discard) affordance that soft-deletes the note
 * via DELETE /api/notes/[id], behind an <AlertDialog> confirm (anti-regression
 * rule 22 — never native confirm()/alert() in a clinical surface). The list is
 * server-rendered, so on success we router.refresh() to drop the row. Audio is
 * never removed from S3 and signed notes are never deletable (enforced server-
 * side); the dialog copy says so.
 */
export type DraftListItem = {
  id: string;
  status: 'RECORDING' | 'PAUSED' | 'DRAFT' | 'REVIEWING' | 'PENDING_REVIEW';
  patientFirstName: string;
  patientLastName: string;
  mrn: string | null;
  /** Pre-formatted on the server to avoid client/server locale hydration drift. */
  updatedAtLabel: string;
};

const RECORDING_STATUSES = new Set<DraftListItem['status']>(['RECORDING', 'PAUSED']);

function statusLabel(status: DraftListItem['status']): string {
  switch (status) {
    case 'PAUSED':
      return 'Paused';
    case 'RECORDING':
      return 'Recording';
    case 'PENDING_REVIEW':
      return 'Pending review';
    case 'REVIEWING':
      return 'Reviewing';
    default:
      return 'Draft';
  }
}

export function DraftsList({ items }: { items: DraftListItem[] }) {
  return (
    <>
      {items.map((item) => (
        <DraftRow key={item.id} item={item} />
      ))}
    </>
  );
}

function DraftRow({ item }: { item: DraftListItem }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRecording = RECORDING_STATUSES.has(item.status);
  const href = isRecording ? `/capture/${item.id}` : `/review/${item.id}`;
  const patientName = `${item.patientLastName}, ${item.patientFirstName}`;

  async function handleDelete() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/notes/${item.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(body?.error?.message ?? 'Could not delete this item. Please try again.');
        setPending(false);
        return;
      }
      setOpen(false);
      // The Drafts list is server-rendered — refresh to drop the deleted row.
      router.refresh();
    } catch {
      setError('Could not delete this item. Please try again.');
      setPending(false);
    }
  }

  return (
    <div
      role="listitem"
      className="flex items-center gap-2 rounded-md border border-border px-3 py-2 hover:bg-muted/40 min-h-[var(--touch-min)]"
    >
      <Link
        href={href}
        className="flex items-center gap-2 flex-1 min-w-0 text-sm"
        aria-label={`${isRecording ? 'Resume recording' : 'Open draft'} for ${patientName}`}
      >
        <UserAvatar firstName={item.patientFirstName} lastName={item.patientLastName} size="sm" />
        <span className="font-medium truncate">{patientName}</span>
        {item.mrn && <span className="text-muted-foreground text-xs shrink-0">{item.mrn}</span>}
        <span className="ml-auto flex items-center gap-2 shrink-0">
          <StatusBadge
            variant={isRecording ? 'warning' : 'neutral'}
            noIcon
            className="text-[10px]"
          >
            {statusLabel(item.status)}
          </StatusBadge>
          <span className="text-[11px] text-muted-foreground">{item.updatedAtLabel}</span>
        </span>
      </Link>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        className="shrink-0 min-h-[var(--touch-min)] min-w-[var(--touch-min)] text-muted-foreground hover:text-destructive"
        aria-label={`Delete ${isRecording ? 'recording' : 'draft'} for ${patientName}`}
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </Button>

      <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isRecording ? 'Discard this recording?' : 'Delete this draft?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isRecording
                ? 'This unfinished recording will be removed from your Drafts. The audio is retained on file and an administrator can restore it.'
                : 'This draft will be removed from your Drafts. It is soft-deleted — retained for audit and restorable by an administrator. Signed notes are never affected.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
            >
              {pending ? 'Deleting…' : isRecording ? 'Discard' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
