'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Loader2, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';

type Candidate = {
  id: string;
  given: string[];
  family: string;
  birthDate: string | null;
  identifier: string | null;
  gender: 'male' | 'female' | 'other' | 'unknown' | null;
};

type Props = {
  patientId: string;
  patient: { firstName: string; lastName: string; mrn: string; dobIso: string };
  existingFhirPatientId?: string | null;
  launchHintFhirPatientId?: string | null;
  label: string;
};

/**
 * Trigger + dialog for the Patient ↔ FHIR match flow.
 *
 * On open we prefill with the local patient's lastName + given + dob,
 * fire a search, render candidates as picker cards. Clinician picks
 * one, ticks confirmation, submits → POST creates the link at
 * 'verified' confidence + the parent /patients/[id] page refreshes.
 *
 * Defensive UX: the confirmation checkbox is the ONLY way to enable
 * the submit button, even if a single candidate matches all fields.
 * No "Looks right, just send" shortcut — this is the spec's promise:
 * the clinician confirms every link.
 */
export function MatchDialogTrigger({
  patientId,
  patient,
  existingFhirPatientId,
  launchHintFhirPatientId,
  label,
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Search className="h-3 w-3 mr-1" aria-hidden />
        {label}
      </Button>
      <MatchDialog
        open={open}
        onOpenChange={setOpen}
        patientId={patientId}
        patient={patient}
        existingFhirPatientId={existingFhirPatientId}
        launchHintFhirPatientId={launchHintFhirPatientId}
      />
    </>
  );
}

function MatchDialog({
  open,
  onOpenChange,
  patientId,
  patient,
  existingFhirPatientId,
  launchHintFhirPatientId,
}: Omit<Props, 'label'> & { open: boolean; onOpenChange: (next: boolean) => void }) {
  const router = useRouter();
  const [lastName, setLastName] = useState(patient.lastName);
  const [given, setGiven] = useState(patient.firstName);
  const [birthDate, setBirthDate] = useState(patient.dobIso.slice(0, 10));
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(existingFhirPatientId ?? launchHintFhirPatientId ?? null);
  const [confirmed, setConfirmed] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [searchPending, startSearch] = useTransition();
  const [submitPending, startSubmit] = useTransition();

  const search = useCallback(() => {
    setSearchError(null);
    const params = new URLSearchParams();
    if (lastName) params.set('lastName', lastName);
    if (given) params.set('given', given);
    if (birthDate) params.set('birthDate', birthDate);
    if (!params.toString()) {
      setSearchError('Enter at least one field to search.');
      return;
    }
    startSearch(async () => {
      const res = await fetch(`/api/fhir/patients/search?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) {
        if (res.status === 412) {
          setSearchError('Connect to NextGen first via the admin Integrations page.');
        } else {
          setSearchError(`Search failed (${res.status})`);
        }
        return;
      }
      const body = (await res.json()) as { data: { candidates: Candidate[] } };
      setCandidates(body.data.candidates);
      // Auto-select an exact match (or the launch hint if it shows up).
      const exact =
        body.data.candidates.find(
          (c) =>
            c.family.toLowerCase() === lastName.toLowerCase() &&
            c.given.some((g) => g.toLowerCase() === given.toLowerCase()) &&
            c.birthDate === birthDate,
        ) ?? body.data.candidates.find((c) => c.id === launchHintFhirPatientId);
      if (exact) setSelectedId(exact.id);
    });
  }, [lastName, given, birthDate, launchHintFhirPatientId]);

  useEffect(() => {
    if (!open) return;
    // Fresh open — reset transient state then kick a search. Depending on
    // `open` only (not `search`) prevents a re-fire on every keystroke,
    // which would also unset the user's confirmation tick.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfirmed(false);
    setSubmitError(null);
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function submit() {
    if (!selectedId || !confirmed) return;
    setSubmitError(null);
    startSubmit(async () => {
      // If the user selected the same candidate that's already linked
      // (pending high/manual link), PATCH to promote it to verified rather
      // than POST-ing a new row that would trip the unique constraint.
      const isPromotion =
        existingFhirPatientId !== null && selectedId === existingFhirPatientId;
      const res = isPromotion
        ? await fetch(`/api/patients/${patientId}/fhir-identities/${encodeURIComponent(selectedId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ehrSystem: 'nextgen', confirmed: true }),
          })
        : await fetch(`/api/patients/${patientId}/fhir-identities`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ehrSystem: 'nextgen',
              fhirPatientId: selectedId,
              confirmed: true,
            }),
          });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { code?: string; message?: string } }
          | null;
        const code = body?.error?.code;
        if (code === 'already_linked') {
          setSubmitError('That EHR patient is already linked to a different OmniScribe patient.');
        } else {
          setSubmitError(body?.error?.message ?? `Save failed (${res.status})`);
        }
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Link {patient.firstName} {patient.lastName} to NextGen</DialogTitle>
          <DialogDescription>
            Search the EHR by name and date of birth, pick the matching record, and confirm.
            EHR resource fetches stay blocked until you tick the confirmation box.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="match-last">Last name</Label>
              <Input
                id="match-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={searchPending}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="match-given">First name</Label>
              <Input
                id="match-given"
                value={given}
                onChange={(e) => setGiven(e.target.value)}
                disabled={searchPending}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="match-dob">Date of birth</Label>
              <Input
                id="match-dob"
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                disabled={searchPending}
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={search} disabled={searchPending}>
              {searchPending ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" aria-hidden />
              ) : (
                <Search className="h-3 w-3 mr-1" aria-hidden />
              )}
              {searchPending ? 'Searching…' : 'Search'}
            </Button>
            {launchHintFhirPatientId && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <ExternalLink className="h-3 w-3" aria-hidden />
                Hint from your last NextGen launch
              </span>
            )}
          </div>
          {searchError && <StatusBanner variant="danger">{searchError}</StatusBanner>}
          <div className="space-y-2">
            {candidates.length === 0 && !searchPending && !searchError && (
              <p className="text-sm text-muted-foreground italic">No results yet. Adjust the fields and search.</p>
            )}
            {candidates.map((c) => {
              const isSelected = selectedId === c.id;
              const dobMatch = c.birthDate === birthDate;
              const familyMatch = c.family.toLowerCase() === lastName.toLowerCase();
              const givenMatch = c.given.some((g) => g.toLowerCase() === given.toLowerCase());
              const exact = dobMatch && familyMatch && givenMatch;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(c.id);
                    setConfirmed(false);
                  }}
                  className={`w-full text-left rounded-md border p-3 text-sm transition-colors ${
                    isSelected ? 'border-[var(--status-info-fg)] bg-muted/40' : 'border-border hover:bg-muted/30'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">
                      {c.given.join(' ')} {c.family}
                    </p>
                    {exact ? (
                      <StatusBadge variant="success" noIcon>Exact</StatusBadge>
                    ) : dobMatch ? (
                      <StatusBadge variant="warning" noIcon>Close</StatusBadge>
                    ) : (
                      <StatusBadge variant="neutral" noIcon>Partial</StatusBadge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    DOB {c.birthDate ?? '—'} · {c.identifier ?? 'no identifier'} · {c.gender ?? 'unknown gender'}
                  </p>
                  <p className="text-[11px] text-muted-foreground font-mono mt-1 break-all">{c.id}</p>
                </button>
              );
            })}
          </div>
          {selectedId && (
            <div className="rounded-md border border-border p-3 bg-muted/30 space-y-2">
              <div className="flex items-start gap-2">
                <input
                  id="match-confirm"
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-border"
                />
                <Label htmlFor="match-confirm" className="text-sm font-normal">
                  I confirm this is the same person as {patient.firstName} {patient.lastName} (DOB {patient.dobIso.slice(0, 10)}, MRN {patient.mrn}).
                </Label>
              </div>
            </div>
          )}
          {submitError && <StatusBanner variant="danger">{submitError}</StatusBanner>}
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitPending}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={!selectedId || !confirmed || submitPending}>
              {submitPending ? 'Saving…' : 'Save link'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
