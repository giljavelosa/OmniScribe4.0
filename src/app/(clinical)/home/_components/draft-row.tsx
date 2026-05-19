'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Sparkles, Trash2 } from 'lucide-react';

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

export type DraftRowData = {
  id: string;
  status: string;
  updatedAt: string; // ISO
  patient: { firstName: string; lastName: string; mrn: string };
};

/**
 * One row in the /home drafts queue. The row body links to /review; a
 * trailing trash button discards the draft (soft-delete) behind an
 * AlertDialog confirm — rule 22 (no native confirm in clinical surfaces).
 */
export function DraftRow({ draft }: { draft: DraftRowData }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function discard() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/notes/${draft.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Couldn't delete the draft (${res.status}).`);
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border pr-2 hover:bg-muted/40">
      <Link
        href={`/review/${draft.id}`}
        className="flex flex-1 items-center justify-between px-3 py-2 min-w-0"
      >
        <div className="flex items-center gap-2 text-sm min-w-0">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="font-medium truncate">
            {draft.patient.lastName}, {draft.patient.firstName}
          </span>
          <span className="text-muted-foreground text-xs shrink-0">{draft.patient.mrn}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge variant="neutral" noIcon className="text-[10px]">
            {draft.status}
          </StatusBadge>
          <span className="text-[11px] text-muted-foreground">
            {new Date(draft.updatedAt).toLocaleDateString()}
          </span>
        </div>
      </Link>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        aria-label={`Delete draft for ${draft.patient.lastName}, ${draft.patient.firstName}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger-fg)]"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !o && setConfirmOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              The draft for {draft.patient.lastName}, {draft.patient.firstName} is removed
              from your queue. Any recorded audio is kept. The deletion is audited. This
              can&apos;t be undone from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Suppress Radix auto-close so an async error lands in the
                // still-mounted dialog instead of vanishing with it.
                e.preventDefault();
                discard();
              }}
              disabled={pending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {pending ? 'Deleting…' : 'Delete draft'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
