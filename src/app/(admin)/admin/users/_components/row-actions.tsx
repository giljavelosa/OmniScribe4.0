'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';
import type { OrgRole } from '@prisma/client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StatusBanner } from '@/components/ui/status-banner';

type Props = {
  userId: string;
  orgUserId: string;
  email: string;
  isActive: boolean;
  role: OrgRole;
  orgSites: Array<{ id: string; name: string }>;
  currentEnrollments: Array<{ siteId: string; isPrimary: boolean }>;
};

type DialogKey = 'send-reset' | 'deactivate' | 'sites' | null;

export function RowActions({
  userId,
  email,
  isActive,
  role,
  orgSites,
  currentEnrollments,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState<DialogKey>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [selectedSites, setSelectedSites] = useState<string[]>(
    currentEnrollments.map((e) => e.siteId),
  );
  const [primarySite, setPrimarySite] = useState<string | null>(
    currentEnrollments.find((e) => e.isPrimary)?.siteId ?? null,
  );

  // ORG_ADMIN+ are always "all sites" — no enrollment UI needed.
  const showSitesItem = role !== 'ORG_ADMIN';

  function close() {
    setOpen(null);
    setError(null);
    setSelectedSites(currentEnrollments.map((e) => e.siteId));
    setPrimarySite(currentEnrollments.find((e) => e.isPrimary)?.siteId ?? null);
  }

  function toggleSite(siteId: string) {
    setSelectedSites((prev) => {
      if (prev.includes(siteId)) {
        const next = prev.filter((s) => s !== siteId);
        if (primarySite === siteId) {
          setPrimarySite(next[0] ?? null);
        }
        return next;
      }
      const next = [...prev, siteId];
      if (!primarySite) setPrimarySite(siteId);
      return next;
    });
  }

  function saveSites() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/admin/users/${userId}/sites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteIds: selectedSites,
          primarySiteId: primarySite,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (body?.error?.code === 'primary_not_in_set') {
          setError('Pick the primary site from the checked list.');
        } else if (body?.error?.code === 'invalid_site') {
          setError('One or more sites are not in your org.');
        } else {
          setError('Could not save site enrollment.');
        }
        return;
      }
      close();
      router.refresh();
    });
  }

  function sendReset() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/admin/users/${userId}/send-password-reset`, { method: 'POST' });
      if (!res.ok) {
        setError('Could not send password-reset email.');
        return;
      }
      close();
      router.refresh();
    });
  }

  function setActive(active: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: active }),
      });
      if (!res.ok) {
        setError('Could not update.');
        return;
      }
      close();
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={`Actions for ${email}`}>
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {showSitesItem && (
            <DropdownMenuItem onClick={() => setOpen('sites')}>Manage sites</DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setOpen('send-reset')}>Send password reset</DropdownMenuItem>
          <DropdownMenuSeparator />
          {isActive ? (
            <DropdownMenuItem onClick={() => setOpen('deactivate')}>Deactivate</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => setActive(true)}>Reactivate</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open === 'sites'} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Site enrollment for {email}</DialogTitle>
            <DialogDescription>
              Pick the sites this person works at. Pick one primary — schedule
              filters and patient-creation defaults use it. Org admins always
              cover every site automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {orgSites.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No sites yet — add one on the Sites page first.
              </p>
            ) : (
              orgSites.map((site) => {
                const checked = selectedSites.includes(site.id);
                return (
                  <div
                    key={site.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                  >
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSite(site.id)}
                        disabled={pending}
                        className="h-4 w-4"
                      />
                      <span>{site.name}</span>
                    </label>
                    <label
                      className={`flex items-center gap-1 text-xs ${
                        checked ? 'text-muted-foreground cursor-pointer' : 'text-muted-foreground/40'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`primary-${userId}`}
                        checked={primarySite === site.id}
                        onChange={() => setPrimarySite(site.id)}
                        disabled={!checked || pending}
                        className="h-3 w-3"
                      />
                      Primary
                    </label>
                  </div>
                );
              })
            )}
          </div>
          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
          <DialogFooter>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={saveSites} disabled={pending}>
              {pending ? 'Saving…' : 'Save enrollment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={open === 'send-reset'} onOpenChange={(o) => !o && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send password reset to {email}?</AlertDialogTitle>
            <AlertDialogDescription>
              They&apos;ll receive an email with a one-hour reset link. This action is audited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={sendReset} disabled={pending}>
              {pending ? 'Sending…' : 'Send reset link'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={open === 'deactivate'} onOpenChange={(o) => !o && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {email}?</AlertDialogTitle>
            <AlertDialogDescription>
              They lose access immediately. Reactivate later from the same menu.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => setActive(false)} disabled={pending}>
              {pending ? 'Deactivating…' : 'Deactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
