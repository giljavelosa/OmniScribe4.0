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
import { Division, Profession } from '@prisma/client';
import {
  CLINICIAN_PICKABLE_DIVISIONS,
  PROFESSION_OPTIONS,
  professionLabel,
} from '@/lib/professions';

/** Roles an org admin can invite. ORG_ADMIN
 *  are NOT invitable — those elevations happen only at org-provisioning
 *  time (owner console / signup), never via the team-members surface. */
const ROLES = ['CLINICIAN', 'VIEWER', 'SITE_ADMIN'] as const;
const ROLE_LABELS: Record<(typeof ROLES)[number], string> = {
  CLINICIAN: 'Clinician',
  VIEWER: 'Non-clinician (read-only)',
  SITE_ADMIN: 'Site admin',
};

/** Roles that can start a visit → the invite MUST carry a concrete profession +
 *  division (mirrors the server superRefine in /api/admin/invites). VIEWER is
 *  read-only and exempt from the profession requirement. */
const RECORDING_ROLES: ReadonlySet<(typeof ROLES)[number]> = new Set([
  'CLINICIAN',
  'SITE_ADMIN',
]);

/** Concrete divisions only — MULTI is an org-aggregate value, never a
 *  per-clinician scope. */
const DIVISION_LABEL: Record<Division, string> = {
  [Division.MEDICAL]: 'Medical',
  [Division.REHAB]: 'Rehab / PT / OT',
  [Division.BEHAVIORAL_HEALTH]: 'Behavioral health',
  [Division.MULTI]: 'Multi-specialty', // never offered here; kept so the map is exhaustive
};

export function UsersToolbar() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]>('CLINICIAN');
  const [division, setDivision] = useState<Division | ''>('');
  const [professionType, setProfessionType] = useState<Profession | ''>('');
  const [profession, setProfession] = useState('');
  const [canManagePatients, setCanManagePatients] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isRecordingRole = RECORDING_ROLES.has(role);

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
          professionType: isRecordingRole ? professionType : undefined,
          profession: profession || undefined,
          canManagePatients,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (body?.error?.code === 'already_member') {
          setError('That email already belongs to a member of this org.');
        } else {
          const fieldErrors = body?.error?.issues?.fieldErrors as
            | Record<string, string[] | undefined>
            | undefined;
          const firstFieldMsg = fieldErrors
            ? Object.values(fieldErrors).find((m) => m && m.length)?.[0]
            : undefined;
          setError(firstFieldMsg ?? body?.error?.message ?? 'Failed to create invite.');
        }
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
            They&apos;ll receive an email with a single-use 7-day link to set their password and signing PIN.
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
                setProfessionType('');
                setDivision('');
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
            {isRecordingRole && (
              <div className="space-y-2">
                <Label>Profession</Label>
                <Select value={professionType} onValueChange={(v) => setProfessionType(v as Profession)} disabled={pending}>
                  <SelectTrigger><SelectValue placeholder="Select a profession" /></SelectTrigger>
                  <SelectContent>
                    {PROFESSION_OPTIONS.map((p) => (
                      <SelectItem key={p} value={p}>{professionLabel(p)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Determines the clinical division their notes are documented under.
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label>Division</Label>
              <Select value={division} onValueChange={(v) => setDivision(v as Division)} disabled={pending}>
                <SelectTrigger><SelectValue placeholder="Select a division" /></SelectTrigger>
                <SelectContent>
                  {CLINICIAN_PICKABLE_DIVISIONS.map((d) => (
                    <SelectItem key={d} value={d}>{DIVISION_LABEL[d]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="iprofession">Specialty (optional)</Label>
              <Input id="iprofession" value={profession} onChange={(e) => setProfession(e.target.value)} disabled={pending} placeholder="e.g. Family Medicine, Outpatient Ortho" />
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
              <Button
                onClick={submit}
                disabled={
                  pending ||
                  !email ||
                  !division ||
                  (isRecordingRole && !professionType)
                }
                className="w-full"
              >
                {pending ? 'Sending invite…' : 'Send invite'}
              </Button>
            </SheetFooter>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
