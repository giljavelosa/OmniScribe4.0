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
import { PASSWORD_POLICY_DESCRIPTION } from '@/lib/auth/password-policy';

/** Roles an org admin can invite or create directly. ORG_ADMIN is NOT
 *  invitable — those elevations happen only at org-provisioning time
 *  (owner console / signup), never via the team-members surface. */
const ROLES = ['CLINICIAN', 'VIEWER', 'SITE_ADMIN'] as const;
const ROLE_LABELS: Record<(typeof ROLES)[number], string> = {
  CLINICIAN: 'Clinician',
  VIEWER: 'Non-clinician (read-only)',
  SITE_ADMIN: 'Site admin',
};
const DIVISIONS = ['MEDICAL', 'REHAB', 'BEHAVIORAL_HEALTH', 'MULTI'] as const;
type Role = (typeof ROLES)[number];
type Division = (typeof DIVISIONS)[number];

export function UsersToolbar() {
  return (
    <div className="flex items-center gap-2">
      <InviteUserSheet />
      <CreateUserSheet />
    </div>
  );
}

/**
 * InviteUserSheet — emails a one-time onboarding link to the user. They pick
 * their own password. The admin never sees the credential. Use this when
 * email is reachable and the user can click a link.
 */
function InviteUserSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('CLINICIAN');
  const [division, setDivision] = useState<Division>('MEDICAL');
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
            They&apos;ll receive an email with a single-use 7-day link to set their password.
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
              <Select value={role} onValueChange={(v) => setRole(v as Role)} disabled={pending}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Division</Label>
              <Select value={division} onValueChange={(v) => setDivision(v as Division)} disabled={pending}>
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

/**
 * CreateUserSheet — admin sets the password directly. No email goes out, no
 * Invite row is created; the admin shares credentials with the user via their
 * own channel (in-person handoff, SMS, etc.). Use this for pilot trials where
 * the link-based onboarding doesn't fit the operator workflow.
 *
 * The plaintext password is shown to the admin ONLY in the success state of
 * this sheet — it isn't stored anywhere recoverable. Closing the sheet drops
 * it from memory; future viewers of /admin/users will not see it.
 */
function CreateUserSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('CLINICIAN');
  const [division, setDivision] = useState<Division>('MEDICAL');
  const [profession, setProfession] = useState('');
  const [canManagePatients, setCanManagePatients] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function generatePassword() {
    // 16 chars sampled with crypto.getRandomValues from a pool that
    // excludes visually-ambiguous characters (0/O, 1/l/I) — easier for
    // an admin to read back to a tester over the phone without typos.
    const pool = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*';
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i] ?? 0;
      out += pool.charAt(b % pool.length);
    }
    setPassword(out);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          role,
          division,
          name: name || undefined,
          profession: profession || undefined,
          canManagePatients,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const code = body?.error?.code;
        setError(
          code === 'email_in_use'
            ? 'A user with that email already exists.'
            : code === 'weak_password'
              ? body?.error?.message ?? 'Password does not meet the policy.'
              : code === 'bad_request'
                ? 'Check the form — one of the fields is invalid.'
                : 'Failed to create user.',
        );
        return;
      }
      setCreated({ email, password });
      router.refresh();
    });
  }

  function reset() {
    setCreated(null);
    setName('');
    setEmail('');
    setPassword('');
    setProfession('');
    setCanManagePatients(false);
    setError(null);
    setOpen(false);
  }

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? setOpen(true) : reset())}>
      <SheetTrigger asChild>
        <Button variant="outline">Create user</Button>
      </SheetTrigger>
      <SheetContent side="right" className="sm:max-w-md space-y-4">
        <SheetHeader>
          <SheetTitle>Create user</SheetTitle>
          <SheetDescription>
            Set a username + password the user can sign in with right away. No email is sent;
            you share the credentials yourself.
          </SheetDescription>
        </SheetHeader>

        {created ? (
          <div className="space-y-3 px-4">
            <StatusBanner variant="success" title="User created">
              Share these credentials with the user. The password isn&apos;t saved anywhere
              you can re-read it — copy it now.
            </StatusBanner>
            <div className="space-y-2 rounded-md border border-border bg-muted p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Email</span>
                <code className="font-mono">{created.email}</code>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Password</span>
                <code className="font-mono">{created.password}</code>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() =>
                navigator.clipboard.writeText(
                  `Email: ${created.email}\nPassword: ${created.password}`,
                )
              }
              className="w-full"
            >
              Copy credentials
            </Button>
            <Button onClick={reset} className="w-full">
              Done
            </Button>
          </div>
        ) : (
          <div className="space-y-3 px-4">
            <div className="space-y-2">
              <Label htmlFor="cname">Name (optional)</Label>
              <Input id="cname" value={name} onChange={(e) => setName(e.target.value)} disabled={pending} placeholder="Dr. Jane Doe" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cemail">Email</Label>
              <Input id="cemail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={pending} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cpassword">Password</Label>
              <div className="flex gap-2">
                <Input
                  id="cpassword"
                  type="text"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={pending}
                  placeholder="At least 12 characters"
                  className="font-mono"
                />
                <Button type="button" variant="outline" onClick={generatePassword} disabled={pending}>
                  Generate
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{PASSWORD_POLICY_DESCRIPTION}</p>
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)} disabled={pending}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Division</Label>
              <Select value={division} onValueChange={(v) => setDivision(v as Division)} disabled={pending}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DIVISIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cprofession">Profession (optional)</Label>
              <Input id="cprofession" value={profession} onChange={(e) => setProfession(e.target.value)} disabled={pending} placeholder="e.g. Family Medicine MD" />
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
              <Button onClick={submit} disabled={pending || !email || !password} className="w-full">
                {pending ? 'Creating user…' : 'Create user'}
              </Button>
            </SheetFooter>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
