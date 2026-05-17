'use client';

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
 * Wrapping <AlertDialog> per anti-regression rule 22 — NEVER native
 * confirm()/alert() in clinical surfaces. Title and body lifted from
 * design-critique-capture-flow.md "leave without saving" finding.
 *
 * "Keep recording" is the primary teal default. "Discard" is destructive red
 * — the ONE place in the capture flow where red is appropriate (you're
 * losing audio + draft).
 */
export function LeaveConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard recording?</AlertDialogTitle>
          <AlertDialogDescription>
            The audio and any in-progress draft will be lost. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep recording</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
