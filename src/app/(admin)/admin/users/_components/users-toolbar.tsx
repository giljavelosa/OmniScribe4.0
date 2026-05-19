'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { StatusBanner } from '@/components/ui/status-banner';

/** Roles an org admin can invite. ORG_ADMIN
 *  are NOT invitable — those elevations happen only at org-provisioning
 *  time (owner console / signup), never via the team-members surface. */
const ROLES = ['CLINICIAN', 'VIEWER', 'SITE_ADMIN'] as const;
const ROLE_LABELS: Record<(typeof ROLES)[number], string> = {
  CLINICIAN: 'Clinician',
  VIEWER: 'Non-clinician (read-only)',
  SITE_ADMIN: 'Site admin',
};
const DIVISIONS = ['MEDICAL', 'REHAB', 'BEHAVIORAL_HEALTH', 'MULTI'] as const;

export function UsersToolbar() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]>('CLINICIAN');
  const [division, setDivision] = useState<(typeof DIVISIONS)[number]>('MEDICAL');
  const [profession, setProfession] = useState('');
  const [canManagePatients, setCanManagePatients] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          role,
          division,
          profession: profession || undefined,
          canManagePatients,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.code === 'already_member' ? 'That email already belongs to a member of this org.' : 'Failed to create invite.');
        return;
      }
      const body = await res.json();
      setLink(body?.data?.onboardUrl ?? null);
      router.refresh();
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button>+ Invite user</Button>
      </SheetTrigger>
      <SheetContent side="right" className="sm:max-w-md space-y-4">
        <SheetHeader>
          <SheetTitle>Invite user</SheetTitle>
          <SheetDescription>
            They&apos;ll receive an email with a single-use 7-day link to set their password and set up their authenticator.
          </SheetDescription>
        </SheetHeader>

        {link ? (
          <div className="space-y-3 px-4">
            <StatusBanner variant="success" title="Invite created">
              The invite email was sent. You can also copy the onboarding link below.
            </StatusBanner>
            <code className="block break-all rounded-md border border-border bg-muted px-2 py-1 text-xs">
              {link}
            </code>
            <Button
              variant="outline"
              onClick={() => navigator.clipboard.writeText(link)}
              className="w-full"
            >
              Copy link
            </Button>
            <Button
              onClick={() => {
                setLink(null);
                setEmail('');
                setProfession('');
                setCanManagePatients(false);
                setOpen(false);
              }}
              className="w-full"
            >
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-3 px-4">
            <div className="space-y-2">
              <Label htmlFor="iemail">Email</Label>
              <Input id="iemail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={pending} />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as (typeof ROLES)[number])} disabled={pending}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Division</Label>
              <Select value={division} onValueChange={(v) => setDivision(v as (typeof DIVISIONS)[number])} disabled={pending}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DIVISIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="iprofession">Profession (optional)</Label>
              <Input id="iprofession" value={profession} onChange={(e) => setProfession(e.target.value)} disabled={pending} placeholder="e.g. Family Medicine MD" />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium">Can manage patients</p>
                <p className="text-xs text-muted-foreground">Grants the PATIENT_MANAGEMENT feature.</p>
              </div>
              <Switch checked={canManagePatients} onCheckedChange={setCanManagePatients} disabled={pending} />
            </div>
            {error && <StatusBanner variant="danger">{error}</StatusBanner>}
            <SheetFooter>
              <Button onClick={submit} disabled={pending || !email} className="w-full">
                {pending ? 'Sending invite…' : 'Send invite'}
              </Button>
            </SheetFooter>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
