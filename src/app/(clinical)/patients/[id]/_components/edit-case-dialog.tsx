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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseRow: {
    id: string;
    primaryIcd: string | null;
    primaryIcdLabel: string;
    secondaryIcd: string | null;
    secondaryIcdLabel: string | null;
  };
  /** Called after a successful PATCH so the parent can refresh. */
  onSaved: () => void;
};

/**
 * Edit-case-dialog — clinician-facing edit affordance for an existing
 * CaseManagement row's ICD + diagnosis labels. Calls the long-standing
 * PATCH /api/case-management/[id] endpoint (Sprint 0.11) that was
 * previously orphaned (audit-trail-ready but no UI surfacing it).
 *
 * Common use case: Miss Cleo proposed a LOW-confidence empty fallback,
 * the clinician accepted it, and the case ended up ACTIVE with no ICD
 * code (the "Needs coding" chip). This dialog is the UI to close that
 * gap after-the-fact.
 *
 * Mirrors NewCaseDialog's shape (Sheet primitive, same field layout) so
 * the two surfaces feel like the same workflow at different lifecycle
 * stages.
 */
export function EditCaseDialog({ open, onOpenChange, caseRow, onSaved }: Props) {
  const [primaryIcd, setPrimaryIcd] = useState(caseRow.primaryIcd ?? '');
  const [primaryLabel, setPrimaryLabel] = useState(caseRow.primaryIcdLabel);
  const [secondaryIcd, setSecondaryIcd] = useState(caseRow.secondaryIcd ?? '');
  const [secondaryLabel, setSecondaryLabel] = useState(caseRow.secondaryIcdLabel ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Re-prime fields each time the dialog opens (or when the caller swaps in
  // a different case row) so stale local state doesn't shadow fresh server
  // values on re-open.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset form on open
    setPrimaryIcd(caseRow.primaryIcd ?? '');
    setPrimaryLabel(caseRow.primaryIcdLabel);
    setSecondaryIcd(caseRow.secondaryIcd ?? '');
    setSecondaryLabel(caseRow.secondaryIcdLabel ?? '');
    setError(null);
  }, [open, caseRow.id, caseRow.primaryIcd, caseRow.primaryIcdLabel, caseRow.secondaryIcd, caseRow.secondaryIcdLabel]);

  function save() {
    const trimmedLabel = primaryLabel.trim();
    if (!trimmedLabel) {
      setError('Primary diagnosis label is required.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/case-management/${caseRow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryIcd: primaryIcd.trim() || null,
          primaryIcdLabel: trimmedLabel,
          secondaryIcd: secondaryIcd.trim() || null,
          secondaryIcdLabel: secondaryLabel.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Could not save (${res.status}).`);
        return;
      }
      onSaved();
      onOpenChange(false);
    });
  }

  return (
    <Sheet open={open} onOpenChange={(next) => { if (next) setError(null); onOpenChange(next); }}>
      <SheetContent side="right" className="sm:max-w-md space-y-4">
        <SheetHeader>
          <SheetTitle>Edit case</SheetTitle>
          <SheetDescription>
            Update the ICD-10 code and diagnosis label for this care arc.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4">
          <div className="space-y-2">
            <Label htmlFor="edit-case-primary-icd">Primary ICD-10 (optional)</Label>
            <Input
              id="edit-case-primary-icd"
              value={primaryIcd}
              onChange={(e) => setPrimaryIcd(e.target.value)}
              placeholder="e.g. M75.121"
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-case-primary-label">Primary diagnosis label</Label>
            <Input
              id="edit-case-primary-label"
              required
              value={primaryLabel}
              onChange={(e) => setPrimaryLabel(e.target.value)}
              placeholder="e.g. Right shoulder rotator cuff tendinopathy"
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-case-secondary-icd">Secondary ICD-10 (optional)</Label>
            <Input
              id="edit-case-secondary-icd"
              value={secondaryIcd}
              onChange={(e) => setSecondaryIcd(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-case-secondary-label">Secondary label (optional)</Label>
            <Input
              id="edit-case-secondary-label"
              value={secondaryLabel}
              onChange={(e) => setSecondaryLabel(e.target.value)}
              disabled={pending}
            />
          </div>

          {error && <StatusBanner variant="danger">{error}</StatusBanner>}
        </div>

        <SheetFooter className="flex-row justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !primaryLabel.trim()}>
            {pending ? 'Saving…' : 'Save case'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
