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
   *  only their enrollments. */
  sites: SiteOption[];
  /** Pre-selected site (typically the caller's primary enrolled site).
   *  Null when the caller has no pickable sites — the sheet renders a
   *  blocking banner in that case. */
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

  const noSitesAvailable = sites.length === 0;

  function submit() {
    setError(null);
    if (!siteId) {
      setError('Pick a site for this patient.');
      return;
    }
    startTransition(async () => {
      const res = await fetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, mrn, dob, sex, siteId }),
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
          {noSitesAvailable && (
            <StatusBanner variant="danger">
              You aren&apos;t enrolled at any site yet. Ask your admin to enroll you before creating a patient.
            </StatusBanner>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="fn">First name</Label>
              <Input id="fn" required value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={pending || noSitesAvailable} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ln">Last name</Label>
              <Input id="ln" required value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={pending || noSitesAvailable} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="mrn">MRN</Label>
              <Input id="mrn" required value={mrn} onChange={(e) => setMrn(e.target.value)} disabled={pending || noSitesAvailable} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dob">DOB</Label>
              <Input id="dob" type="date" required value={dob} onChange={(e) => setDob(e.target.value)} disabled={pending || noSitesAvailable} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Sex (SAAB)</Label>
            <Select value={sex} onValueChange={(v) => setSex(v as (typeof SEXES)[number])} disabled={pending || noSitesAvailable}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SEXES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Site</Label>
            <Select
              value={siteId}
              onValueChange={(v) => setSiteId(v)}
              disabled={pending || noSitesAvailable}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick a site" />
              </SelectTrigger>
              <SelectContent>
                {sites.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Where the patient is primarily seen. Used as the default site for ad-hoc visits.
            </p>
          </div>
          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
        </div>
        <SheetFooter>
          <Button
            onClick={submit}
            disabled={pending || noSitesAvailable || !firstName || !lastName || !mrn || !dob || !siteId}
            className="w-full"
          >
            {pending ? 'Creating…' : 'Create patient'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
