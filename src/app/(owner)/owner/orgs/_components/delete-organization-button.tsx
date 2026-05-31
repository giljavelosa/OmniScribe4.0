'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
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

type DeleteOrganizationButtonProps = {
  orgId: string;
  orgName: string;
};

export function DeleteOrganizationButton({
  orgId,
  orgName,
}: DeleteOrganizationButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmDelete() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/owner/orgs/${orgId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmName: orgName }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error?.message ?? `Delete failed (${res.status}).`);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(true)}
        aria-label={`Delete organization ${orgName}`}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete organization?</AlertDialogTitle>
            <AlertDialogDescription>
              This hides the organization from owner and app surfaces, deactivates
              its users and seats, and keeps clinical records plus audit history
              retained for compliance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmDelete}
              disabled={pending}
            >
              {pending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
