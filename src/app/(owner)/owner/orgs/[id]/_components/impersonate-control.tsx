'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Eye } from 'lucide-react';

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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { StatusBanner } from '@/components/ui/status-banner';

type TargetOption = {
  userId: string;
  email: string;
  role: string;
};

type Props = {
  orgId: string;
  orgName: string;
  targets: TargetOption[];
};

/**
 * ImpersonateControl — Unit 32 owner console.
 *
 * Button → AlertDialog with target user select + reason textarea. On
 * submit:
 *   1. POST /api/owner/orgs/[id]/impersonate → returns ImpersonationContext.
 *   2. Apply via session.update({ impersonation: ctx }) — NextAuth
 *      re-issues the JWT cookie with the new field.
 *   3. Navigate to /home — owner now sees the target user's view; the
 *      ImpersonationBanner (mounted globally) becomes visible.
 *
 * Reason is required ≥10 chars (server-side enforced; client-side
 * validation just keeps the dialog UX tight).
 *
 * Targets list is provided by the parent server component (already
 * filtered to active OrgUsers of this org). Empty list disables the
 * button.
 */
export function ImpersonateControl({ orgId, orgName, targets }: Props) {
  const router = useRouter();
  const { update } = useSession();
  const [open, setOpen] = useState(false);
  const [targetUserId, setTargetUserId] = useState<string>(targets[0]?.userId ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reasonOk = reason.trim().length >= 10;

  function submit() {
    if (!reasonOk || !targetUserId) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/owner/orgs/${orgId}/impersonate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId, reason: reason.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { code?: string } }
          | null;
        setError(body?.error?.code ?? `Begin failed (${res.status})`);
        return;
      }
      const body = (await res.json()) as {
        data: { impersonation: unknown };
      };
      // Refresh the NextAuth JWT cookie with the new impersonation
      // field. update() round-trips through the jwt + session
      // callbacks, which validate the TTL + surface the context as
      // session.impersonation.
      await update({ impersonation: body.data.impersonation });
      // Hard navigate so the page re-renders against the new session
      // (and the ImpersonationBanner shows up).
      router.push('/home');
      router.refresh();
    });
  }

  if (targets.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground italic">
        No active OrgUsers to impersonate.
      </p>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1"
      >
        <Eye className="h-3 w-3" aria-hidden />
        Begin impersonation
      </Button>
      <AlertDialog open={open} onOpenChange={(o) => !o && !pending && setOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Impersonate a user in {orgName}?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;ll see the app as this user sees it. <strong>All mutations
              are blocked</strong> during impersonation — reads only. Session
              auto-expires after 60 minutes.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Target user</Label>
              <Select
                value={targetUserId}
                onValueChange={setTargetUserId}
                disabled={pending}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a user" />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((t) => (
                    <SelectItem key={t.userId} value={t.userId}>
                      {t.email} — {t.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="imp-reason">Reason (≥10 chars, required)</Label>
              <Textarea
                id="imp-reason"
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={pending}
                placeholder="Customer support — investigating signed-note bug per ticket #1234"
              />
              <p className="text-[11px] text-muted-foreground">
                {reason.length}/500 · stored in audit log.
              </p>
            </div>
            {error && <StatusBanner variant="danger">{error}</StatusBanner>}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={submit}
              disabled={pending || !reasonOk || !targetUserId}
            >
              {pending ? 'Beginning…' : 'Begin impersonation'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
