'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
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

const SEXES: { value: string; label: string }[] = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Other' },
  { value: 'UNKNOWN', label: 'Unknown / not asked' },
];

type SiteOption = { id: string; name: string };

type Props = {
  sites: SiteOption[];
  defaultSiteId: string | null;
};

type DuplicateMatch = {
  id: string;
  firstName: string;
  lastName: string;
  mrn: string | null;
  dob: string;
  sex: string;
};

/**
 * AddPatientButton — minimum patient-shell creation drawer.
 *
 * Required: first name, last name, DOB, sex/SAAB (UNKNOWN allowed).
 * Optional: MRN, default site.
 * System-generated: patient UUID, orgId, createdBy, createdAt, status=Active, audit event.
 *
 * Duplicate detection: after name + DOB are stable (600ms debounce), the
 * component checks the org's patient roster for a name + DOB match and
 * shows a warning with an option to open the existing chart or create anyway.
 * DOB is never sent in the URL — it's filtered client-side from the name
 * search response.
 *
 * PHI rule: no name, DOB, or MRN values are logged to the console.
 */
export function AddPatientButton({ sites, defaultSiteId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Form fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [mrn, setMrn] = useState('');
  const [dob, setDob] = useState('');
  const [sex, setSex] = useState<string>('UNKNOWN');
  const [siteId, setSiteId] = useState<string>(defaultSiteId ?? '');

  // Duplicate detection
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [confirmedAnyway, setConfirmedAnyway] = useState(false);
  const dupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Submission
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canSubmit =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    dob.length > 0 &&
    sex.length > 0 &&
    (!duplicates.length || confirmedAnyway);

  // Reset all state when the sheet closes
  function resetForm() {
    setFirstName('');
    setLastName('');
    setMrn('');
    setDob('');
    setSex('UNKNOWN');
    setSiteId(defaultSiteId ?? '');
    setDuplicates([]);
    setConfirmedAnyway(false);
    setError(null);
  }

  // Duplicate check — debounced 600ms, runs when name + DOB are filled
  useEffect(() => {
    if (dupTimerRef.current) clearTimeout(dupTimerRef.current);
    setDuplicates([]);
    setConfirmedAnyway(false);

    const ln = lastName.trim();
    const fn = firstName.trim();
    if (!ln || !fn || !dob) return;

    dupTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/patients?query=${encodeURIComponent(ln)}`,
          { method: 'GET' },
        );
        if (!res.ok) return;
        const body = await res.json();
        const items: Array<{
          id: string;
          firstName: string;
          lastName: string;
          mrn: string | null;
          dob: string;
          sex: string;
        }> = body?.data?.items ?? [];

        // Filter client-side — DOB never goes in the URL
        const matches = items.filter((p) => {
          const nameMatch =
            p.firstName.toLowerCase() === fn.toLowerCase() &&
            p.lastName.toLowerCase() === ln.toLowerCase();
          const dobMatch =
            p.dob && new Date(p.dob).toDateString() === new Date(dob).toDateString();
          return nameMatch && dobMatch;
        });

        setDuplicates(matches);
      } catch {
        // Non-blocking — duplicate check failure should never block creation
      }
    }, 600);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstName, lastName, dob]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          dob,
          sex,
          ...(mrn.trim() ? { mrn: mrn.trim() } : {}),
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
          setError('That site no longer exists. Refresh and try again.');
        } else {
          setError('Could not create the patient. Please try again.');
        }
        return;
      }
      const body = await res.json();
      setOpen(false);
      resetForm();
      router.push(`/patients/${body.data.id}`);
      router.refresh();
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) resetForm();
      }}
    >
      <SheetTrigger asChild>
        <Button>+ Add patient</Button>
      </SheetTrigger>

      <SheetContent side="right" className="sm:max-w-md flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
          <SheetTitle>Add patient</SheetTitle>
          <SheetDescription>
            Create the minimum patient shell needed to start documentation.
            Demographics, contacts, coverage, and clinical details can be added on the patient detail page.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Patient identity — required */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Patient identity <span className="text-destructive">*</span>
            </legend>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="fn">
                  First name <span className="text-destructive text-xs">*</span>
                </Label>
                <Input
                  id="fn"
                  autoComplete="off"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={pending}
                  placeholder="Mary"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ln">
                  Last name <span className="text-destructive text-xs">*</span>
                </Label>
                <Input
                  id="ln"
                  autoComplete="off"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={pending}
                  placeholder="Walters"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="dob">
                  Date of birth <span className="text-destructive text-xs">*</span>
                </Label>
                <Input
                  id="dob"
                  type="date"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  disabled={pending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sex">
                  Sex / SAAB <span className="text-destructive text-xs">*</span>
                </Label>
                <Select
                  value={sex}
                  onValueChange={setSex}
                  disabled={pending}
                >
                  <SelectTrigger id="sex">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEXES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </fieldset>

          {/* Optional identifiers */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Optional identifiers
            </legend>

            <div className="space-y-1.5">
              <Label htmlFor="mrn">
                MRN{' '}
                <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="mrn"
                autoComplete="off"
                value={mrn}
                onChange={(e) => setMrn(e.target.value)}
                disabled={pending}
                placeholder="Leave blank if not yet available"
              />
            </div>

            {sites.length > 0 && (
              <div className="space-y-1.5">
                <Label>
                  Default site{' '}
                  <span className="text-xs font-normal text-muted-foreground">(optional)</span>
                </Label>
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
                  Pre-fills the site picker when starting a visit. Can be changed at recording time.
                </p>
              </div>
            )}
          </fieldset>

          {/* Duplicate warning */}
          {duplicates.length > 0 && !confirmedAnyway && (
            <div className="rounded-lg border border-[oklch(0.85_0.10_75)] bg-[oklch(0.96_0.05_75)] p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-[oklch(0.55_0.18_75)] shrink-0 mt-0.5" aria-hidden />
                <p className="text-sm font-medium text-[oklch(0.45_0.15_75)]">
                  Possible duplicate found
                </p>
              </div>
              {duplicates.map((d) => (
                <div key={d.id} className="ml-6 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">
                    {d.lastName}, {d.firstName}
                    {d.mrn ? ` · MRN ${d.mrn}` : ''}
                  </p>
                  <div className="flex items-center gap-3 pt-0.5">
                    <Link
                      href={`/patients/${d.id}`}
                      className="underline text-primary hover:text-primary/80"
                      onClick={() => setOpen(false)}
                    >
                      Open existing chart
                    </Link>
                    <button
                      type="button"
                      className="underline text-muted-foreground hover:text-foreground"
                      onClick={() => setConfirmedAnyway(true)}
                    >
                      Create anyway
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
        </div>

        <SheetFooter className="px-6 py-4 border-t border-border">
          <Button
            onClick={submit}
            disabled={pending || !canSubmit}
            className="w-full"
          >
            {pending ? 'Creating…' : 'Create patient'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
