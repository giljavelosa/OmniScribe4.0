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
import { StatusBanner } from '@/components/ui/status-banner';

const SEXES = ['MALE', 'FEMALE', 'OTHER', 'UNKNOWN'] as const;

type SiteOption = { id: string; name: string };

type Props = {
  /** Sites the caller can pick. Server-filtered by site scope:
   *  org-wide roles see every non-archived site, site-scoped roles see
   *  only their enrollments. May be empty — the picker stays usable with
   *  just the "No default site" option. */
  sites: SiteOption[];
  /** Pre-selected default site (typically the caller's primary enrolled
   *  site). Null when no sensible default exists — the picker opens to
   *  "No default site" and the patient is created without one. */
  defaultSiteId: string | null;
};

export function AddPatientButton({ sites, defaultSiteId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [mrn, setMrn] = useState('');
  const [dob, setDob] = useState('');
  const [sex, setSex] = useState<(typeof SEXES)[number]>('UNKNOWN');
  const [siteId, setSiteId] = useState<string>(defaultSiteId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Default site is optional. When omitted, the patient is created
        // without one — the StartVisit dialog asks for site at recording-time
        // (which is where the visit actually happens). The picker below
        // defaults to the caller's primary so the common case is one click.
        body: JSON.stringify({
          firstName,
          lastName,
          mrn,
          dob,
          sex,
          ...(siteId ? { siteId } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const code = body?.error?.code;
        if (code === 'duplicate_mrn') {
          setError('A patient with that MRN already exists in this organization.');
        } else if (code === 'site_not_in_scope') {
          setError('You do not have access to that site.');
        } else if (code === 'site_not_found') {
          setError('That site no longer exists. Refresh the page and try again.');
        } else {
          setError('Could not create patient.');
        }
        return;
      }
      const body = await res.json();
      setOpen(false);
      router.push(`/patients/${body.data.id}`);
      router.refresh();
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button>+ Add patient</Button>
      </SheetTrigger>
      <SheetContent side="right" className="sm:max-w-md space-y-4">
        <SheetHeader>
          <SheetTitle>Add patient</SheetTitle>
          <SheetDescription>
            The minimum to create a patient. Add addresses, coverage, contacts on the detail page.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="fn">First name</Label>
              <Input id="fn" required value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={pending} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ln">Last name</Label>
              <Input id="ln" required value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={pending} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="mrn">MRN</Label>
              <Input id="mrn" required value={mrn} onChange={(e) => setMrn(e.target.value)} disabled={pending} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dob">DOB</Label>
              <Input id="dob" type="date" required value={dob} onChange={(e) => setDob(e.target.value)} disabled={pending} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Sex (SAAB)</Label>
            <Select value={sex} onValueChange={(v) => setSex(v as (typeof SEXES)[number])} disabled={pending}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SEXES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Default site <span className="text-xs text-muted-foreground">(optional)</span></Label>
            <Select
              value={siteId || '__none__'}
              onValueChange={(v) => setSiteId(v === '__none__' ? '' : v)}
              disabled={pending}
            >
              <SelectTrigger>
                <SelectValue placeholder="No default site" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No default site</SelectItem>
                {sites.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Where the patient is primarily seen. The actual site for each visit is set when recording starts — this just pre-fills the picker.
            </p>
          </div>
          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
        </div>
        <SheetFooter>
          <Button
            onClick={submit}
            disabled={pending || !firstName || !lastName || !mrn || !dob}
            className="w-full"
          >
            {pending ? 'Creating…' : 'Create patient'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
