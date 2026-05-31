'use client';

import { useState, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBanner } from '@/components/ui/status-banner';

type Props = {
  patientId: string;
  patientName: string;
  canDeletePatient: boolean;
};

export function PatientDeleteCard({ patientId, patientName, canDeletePatient }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canDeletePatient) return null;

  async function deletePatient(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);
    const res = await fetch(`/api/patients/${patientId}`, { method: 'DELETE' });

    if (!res.ok) {
      setPending(false);
      setError(
        res.status === 403
          ? 'Only organization admins can delete patient records.'
          : 'The patient record could not be deleted. Try again.',
      );
      return;
    }

    setOpen(false);
    router.push('/patients');
    router.refresh();
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-md">Organization admin controls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Danger zone: delete this patient record from active clinical views. Audit history and
          retained source files remain governed by organization retention policy.
        </p>
        {error && <StatusBanner variant="danger">{error}</StatusBanner>}
        <AlertDialog open={open} onOpenChange={(next) => {
          if (pending) return;
          setOpen(next);
          if (!next) setError(null);
        }}>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <Trash2 className="size-4" aria-hidden />
              Delete patient record
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {patientName}?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the patient from active registries, chart search, and clinical workflows.
                This action is restricted to organization admins and is audited.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={pending}
                onClick={deletePatient}
              >
                {pending ? 'Deleting...' : 'Delete patient record'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
