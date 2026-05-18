'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { StatusBanner } from '@/components/ui/status-banner';

type Props = {
  siteId: string;
  siteName: string;
  isArchived: boolean;
};

/**
 * SiteRowActions — dropdown with Archive / Unarchive (rule 22: AlertDialog
 * for destructive flows; no native confirm). Archive captures an optional
 * reason ≥10 chars when supplied; unarchive is a single tap.
 */
export function SiteRowActions({ siteId, siteName, isArchived }: Props) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function commit(action: 'archive' | 'unarchive') {
    setError(null);
    const body: Record<string, string> = { action };
    if (action === 'archive' && reason.trim()) {
      if (reason.trim().length < 10) {
        setError('Reason must be at least 10 characters (or leave blank).');
        return;
      }
      body.reason = reason.trim();
    }
    startTransition(async () => {
      const res = await fetch(`/api/admin/sites/${siteId}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error?.message ?? `Action failed (${res.status}).`);
        return;
      }
      setDialogOpen(false);
      setReason('');
      router.refresh();
    });
  }

  if (isArchived) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => commit('unarchive')}
        disabled={pending}
      >
        Unarchive
      </Button>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Row actions for ${siteName}`}>
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialogOpen(true)} className="text-[var(--status-danger-fg)]">
            Archive site
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{siteName}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Archiving hides the site from active lists but preserves all its history. Patients,
              schedules, and rooms remain unchanged. You can unarchive at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2 px-1">
            <Label htmlFor={`reason-${siteId}`} className="text-xs">
              Reason (optional, ≥10 chars when supplied — captured in audit log)
            </Label>
            <Textarea
              id={`reason-${siteId}`}
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 500))}
              rows={2}
              maxLength={500}
              placeholder="e.g., consolidating into the main office for 2026 Q3"
              disabled={pending}
            />
            {error && <StatusBanner variant="danger">{error}</StatusBanner>}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              // Prevent Radix's default auto-close so the dialog stays open
              // until the async commit resolves — otherwise an error setState
              // fires after the dialog has already unmounted and the user
              // never sees the failure message.
              onClick={(e) => {
                e.preventDefault();
                commit('archive');
              }}
              disabled={pending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {pending ? 'Archiving…' : 'Archive site'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
