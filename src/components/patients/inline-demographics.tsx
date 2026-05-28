'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBanner } from '@/components/ui/status-banner';

type Patient = {
  id: string;
  firstName: string;
  lastName: string;
  mrn: string | null;
  dob: string; // ISO
  sex: string;
  phone: string | null;
  email: string | null;
  preferredLanguage: string | null;
  /** Patient's default site (optional). The site of record for each visit
   *  is set on the Encounter at StartVisit-time; this is just a default
   *  for the picker. */
  siteId: string | null;
  siteName: string | null;
};

type SiteOption = { id: string; name: string };

const NO_SITE_VALUE = '__none__';

const SEX_OPTIONS = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Other' },
  { value: 'UNKNOWN', label: 'Unknown' },
];

/**
 * InlineDemographics — Unit 12 replacement for the launcher-style
 * demographics block. Click "Edit" → fields become inputs; Save commits
 * via PATCH /api/patients/[id] → server emits PATIENT_DEMOGRAPHICS_EDITED
 * audit when any of the 8 demographic fields move.
 *
 * No full-page form swap (founder rule from spec: inline editable).
 */
export function InlineDemographics({
  patient,
  availableSites,
}: {
  patient: Patient;
  /** Sites the caller can pick as the patient's default. Same scope filter
   *  as the StartVisit picker — passed in from the parent page. */
  availableSites: SiteOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(patient.firstName);
  const [lastName, setLastName] = useState(patient.lastName);
  const [mrn, setMrn] = useState(patient.mrn ?? '');
  const [dob, setDob] = useState(patient.dob.slice(0, 10));
  const [sex, setSex] = useState(patient.sex);
  const [phone, setPhone] = useState(patient.phone ?? '');
  const [email, setEmail] = useState(patient.email ?? '');
  const [preferredLanguage, setPreferredLanguage] = useState(patient.preferredLanguage ?? '');
  const [siteId, setSiteId] = useState<string>(patient.siteId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function cancel() {
    setFirstName(patient.firstName);
    setLastName(patient.lastName);
    setMrn(patient.mrn ?? '');
    setDob(patient.dob.slice(0, 10));
    setSex(patient.sex);
    setPhone(patient.phone ?? '');
    setEmail(patient.email ?? '');
    setPreferredLanguage(patient.preferredLanguage ?? '');
    setSiteId(patient.siteId ?? '');
    setError(null);
    setEditing(false);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/patients/${patient.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          mrn: mrn.trim(),
          dob: dob || undefined,
          sex,
          phone: phone.trim() || null,
          email: email.trim() || null,
          preferredLanguage: preferredLanguage.trim() || null,
          siteId: siteId || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Save failed (${res.status}).`);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-md">Demographics</CardTitle>
        {!editing && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="size-3" aria-hidden="true" />
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!editing ? (
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
            <Field label="Name" value={`${patient.firstName} ${patient.lastName}`} />
            <Field label="DOB" value={new Date(patient.dob).toLocaleDateString()} />
            <Field label="Sex" value={sexLabel(patient.sex)} />
            <Field label="MRN" value={patient.mrn ?? '—'} mono />
            <Field label="Phone" value={patient.phone ?? '—'} mono />
            <Field label="Email" value={patient.email ?? '—'} mono />
            <Field label="Preferred language" value={patient.preferredLanguage ?? '—'} />
            <Field label="Default site" value={patient.siteName ?? '—'} />
          </dl>
        ) : (
          <form
            className="grid grid-cols-2 md:grid-cols-3 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={pending} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={pending} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mrn">MRN</Label>
              <Input id="mrn" value={mrn} onChange={(e) => setMrn(e.target.value)} disabled={pending} className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dob">DOB</Label>
              <Input id="dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} disabled={pending} />
            </div>
            <div className="space-y-1.5">
              <Label>Sex</Label>
              <Select value={sex} onValueChange={setSex}>
                <SelectTrigger disabled={pending}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEX_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={pending} className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={pending} className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pref-lang">Preferred language</Label>
              <Input id="pref-lang" value={preferredLanguage} onChange={(e) => setPreferredLanguage(e.target.value)} disabled={pending} />
            </div>
            <div className="space-y-1.5">
              <Label>Default site</Label>
              <Select
                value={siteId || NO_SITE_VALUE}
                onValueChange={(v) => setSiteId(v === NO_SITE_VALUE ? '' : v)}
              >
                <SelectTrigger disabled={pending}>
                  <SelectValue placeholder="No default site" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SITE_VALUE}>No default site</SelectItem>
                  {availableSites.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {error && (
              <div className="col-span-full">
                <StatusBanner variant="danger">{error}</StatusBanner>
              </div>
            )}

            <div className="col-span-full flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={cancel} disabled={pending}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function sexLabel(value: string): string {
  const match = SEX_OPTIONS.find((s) => s.value === value);
  return match?.label ?? value;
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={mono ? 'text-sm font-mono text-foreground' : 'text-sm text-foreground'}>
        {value}
      </dd>
    </div>
  );
}
