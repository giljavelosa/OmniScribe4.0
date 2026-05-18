'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Unlink } from 'lucide-react';

import { Button } from '@/components/ui/button';
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
import { StatusBanner } from '@/components/ui/status-banner';

/**
 * Unlink the patient ↔ FHIR link. AlertDialog (rule 22) so the
 * clinician sees what they're about to destroy before it happens.
 * Hard-deletes the row — the audit log carries the history.
 */
export function UnlinkButton({
  patientId,
  fid,
  ehrSystem,
}: {
  patientId: string;
  fid: string;
  ehrSystem: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function unlink() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/patients/${patientId}/fhir-identities/${fid}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'clinician_initiated' }),
      });
      if (!res.ok) {
        setError(`Unlink failed (${res.status})`);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Unlink className="h-3 w-3 mr-1" aria-hidden />
        Unlink
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink {ehrSystem} record?</AlertDialogTitle>
            <AlertDialogDescription>
              EHR resource fetches for this patient will stop. You can re-link from this same panel
              at any time. This action is audited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={unlink} disabled={pending}>
              {pending ? 'Unlinking…' : 'Unlink'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
