'use client';

import { useEffect, useState, useTransition } from 'react';

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
} from '@/components/ui/sheet';
import { StatusBanner } from '@/components/ui/status-banner';

type ExistingCase = {
  id: string;
  primaryIcd: string | null;
  primaryIcdLabel: string;
  status: string;
  lastActivityAt: string;
};

type Props = {
  patientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when clinician picks an existing case or a newly created one. */
  onResolved: (caseId: string) => void;
};

/**
 * New-case-dialog — de-dup against existing CaseManagement rows (Phase 1).
 * FHIR conditions list is empty until Phase 2.
 */
export function NewCaseDialog({ patientId, open, onOpenChange, onResolved }: Props) {
  const [existing, setExisting] = useState<ExistingCase[]>([]);
  const [loadingDups, setLoadingDups] = useState(false);
  const [primaryIcd, setPrimaryIcd] = useState('');
  const [primaryLabel, setPrimaryLabel] = useState('');
  const [secondaryIcd, setSecondaryIcd] = useState('');
  const [secondaryLabel, setSecondaryLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    if (next) setError(null);
    onOpenChange(next);
  }

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load existing cases when sheet opens
    setLoadingDups(true);
    void fetch('/api/case-management/check-dups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Could not load existing cases.');
        const body = await res.json();
        setExisting(body?.data?.existingCases ?? []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingDups(false));
  }, [open, patientId]);

  function createManual() {
    if (!primaryLabel.trim()) {
      setError('Enter a diagnosis label for this case.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/case-management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId,
          primaryIcd: primaryIcd.trim() || null,
          primaryIcdLabel: primaryLabel.trim(),
          secondaryIcd: secondaryIcd.trim() || null,
          secondaryIcdLabel: secondaryLabel.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? 'Could not create the case.');
        return;
      }
      const body = await res.json();
      onResolved(body.data.id);
      onOpenChange(false);
    });
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="sm:max-w-md space-y-4">
        <SheetHeader>
          <SheetTitle>New case management</SheetTitle>
          <SheetDescription>
            Check for an existing case before opening a duplicate diagnosis arc.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4">
          {loadingDups && (
            <p className="text-sm text-muted-foreground">Checking existing cases…</p>
          )}
          {!loadingDups && existing.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Existing cases on file</p>
              <ul className="space-y-2">
                {existing.map((c) => (
                  <li key={c.id}>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-start h-auto py-2 text-left"
                      disabled={pending}
                      onClick={() => {
                        onResolved(c.id);
                        onOpenChange(false);
                      }}
                    >
                      <span className="block">
                        {c.primaryIcd ? (
                          <span className="font-mono text-xs mr-2">{c.primaryIcd}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground mr-2">Needs coding</span>
                        )}
                        {c.primaryIcdLabel}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-3 border-t pt-3">
            <p className="text-sm font-medium">Create new (manual)</p>
            <div className="space-y-2">
              <Label htmlFor="case-primary-icd">Primary ICD-10 (optional)</Label>
              <Input
                id="case-primary-icd"
                value={primaryIcd}
                onChange={(e) => setPrimaryIcd(e.target.value)}
                placeholder="e.g. M17.11"
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="case-primary-label">Primary diagnosis label</Label>
              <Input
                id="case-primary-label"
                required
                value={primaryLabel}
                onChange={(e) => setPrimaryLabel(e.target.value)}
                placeholder="e.g. Right knee osteoarthritis"
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="case-secondary-icd">Secondary ICD-10 (optional)</Label>
              <Input
                id="case-secondary-icd"
                value={secondaryIcd}
                onChange={(e) => setSecondaryIcd(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="case-secondary-label">Secondary label (optional)</Label>
              <Input
                id="case-secondary-label"
                value={secondaryLabel}
                onChange={(e) => setSecondaryLabel(e.target.value)}
                disabled={pending}
              />
            </div>
          </div>

          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
        </div>

        <SheetFooter className="flex-row justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={createManual} disabled={pending || !primaryLabel.trim()}>
            {pending ? 'Creating…' : 'Create case'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
