'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';

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
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { StatusBanner } from '@/components/ui/status-banner';

type Props = {
  userId: string;
  orgUserId: string;
  email: string;
  isActive: boolean;
};

type DialogKey = 'reset-mfa' | 'send-reset' | 'deactivate' | null;

export function RowActions({ userId, email, isActive }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState<DialogKey>(null);
  const [reason, setReason] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(null);
    setReason('');
    setAdminToken('');
    setError(null);
  }

  function resetMfa() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/admin/users/${userId}/reset-mfa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, adminMfaToken: adminToken }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (body?.error?.code === 'invalid_admin_mfa') setError('Your MFA code was rejected.');
        else if (body?.error?.code === 'reason_too_short') setError('Reason must be at least 10 characters.');
        else setError('Could not reset MFA.');
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
          <DropdownMenuItem onClick={() => setOpen('reset-mfa')}>Reset MFA</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setOpen('send-reset')}>Send password reset</DropdownMenuItem>
          <DropdownMenuSeparator />
          {isActive ? (
            <DropdownMenuItem onClick={() => setOpen('deactivate')}>Deactivate</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => setActive(true)}>Reactivate</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={open === 'reset-mfa'} onOpenChange={(o) => !o && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset MFA for {email}?</AlertDialogTitle>
            <AlertDialogDescription>
              They&apos;ll be required to re-enroll their authenticator on next sign-in. Their active
              sessions are invalidated immediately. This action is audited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="reason">Reason (≥ 10 characters)</Label>
              <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} disabled={pending} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adminToken">Your current MFA code</Label>
              <Input id="adminToken" inputMode="numeric" value={adminToken} onChange={(e) => setAdminToken(e.target.value)} disabled={pending} />
            </div>
            {error && <StatusBanner variant="danger">{error}</StatusBanner>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={resetMfa} disabled={pending || reason.length < 10 || adminToken.length !== 6}>
              {pending ? 'Resetting…' : 'Reset MFA'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
