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
 * Wraps shadcn AlertDialog (rule 22). Shown when the clinician taps
 * Regenerate on a section they've already edited — confirms they're OK
 * losing their edits before the worker overwrites with a fresh draft.
 */
export function SectionRegenerateConfirmDialog({
  open,
  sectionLabel,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  sectionLabel: string;
  onOpenChange: (next: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Regenerate “{sectionLabel}”?</AlertDialogTitle>
          <AlertDialogDescription>
            You&apos;ve edited this section. Regenerating will overwrite your edits with a fresh
            AI draft from the transcript. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep my edits</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Overwrite + regenerate
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
