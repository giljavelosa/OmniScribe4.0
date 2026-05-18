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

const DIVISIONS = ['MEDICAL', 'REHAB', 'BEHAVIORAL_HEALTH', 'MULTI'] as const;
const SEXES = ['MALE', 'FEMALE', 'OTHER', 'UNKNOWN'] as const;

export function AddPatientButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [mrn, setMrn] = useState('');
  const [dob, setDob] = useState('');
  const [sex, setSex] = useState<(typeof SEXES)[number]>('UNKNOWN');
  const [division, setDivision] = useState<(typeof DIVISIONS)[number]>('MEDICAL');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, mrn, dob, sex, division }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.code === 'duplicate_mrn' ? 'A patient with that MRN already exists in this organization.' : 'Could not create patient.');
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
          <div className="grid grid-cols-2 gap-3">
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
              <Label>Division</Label>
              <Select value={division} onValueChange={(v) => setDivision(v as (typeof DIVISIONS)[number])} disabled={pending}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DIVISIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
        </div>
        <SheetFooter>
          <Button onClick={submit} disabled={pending || !firstName || !lastName || !mrn || !dob} className="w-full">
            {pending ? 'Creating…' : 'Create patient'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
