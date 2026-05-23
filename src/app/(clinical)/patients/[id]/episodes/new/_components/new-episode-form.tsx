'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Division } from '@prisma/client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBanner } from '@/components/ui/status-banner';

type Dept = { id: string; name: string; division: Division };

const DIVISION_LABEL: Record<Division, string> = {
  MEDICAL: 'MEDICAL',
  REHAB: 'REHAB',
  BEHAVIORAL_HEALTH: 'Behavioral health',
  MULTI: 'Multi-division',
};

/**
 * NewEpisodeForm — rehab plan of care under a CaseManagement (Sprint 0.11).
 *
 * Requires `caseManagementId` from the parent page (query param). Submits to
 * POST /api/patients/[id]/episodes with REHAB division enforced server-side.
 */
export function NewEpisodeForm({
  patientId,
  caseManagementId,
  caseLabel,
  departments,
  caseHasFlipPair,
}: {
  patientId: string;
  caseManagementId: string;
  caseLabel: string;
  departments: Dept[];
  /** True when parent case has both primary and secondary ICD for billing flip. */
  caseHasFlipPair: boolean;
}) {
  const router = useRouter();
  const [diagnosis, setDiagnosis] = useState('');
  const [bodyPart, setBodyPart] = useState('');
  const [departmentId, setDepartmentId] = useState<string>('');
  const [flipIcdFromCase, setFlipIcdFromCase] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const compatibleDepts = useMemo(
    () =>
      departments.filter(
        (d) => d.division === Division.MULTI || d.division === Division.REHAB,
      ),
    [departments],
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/patients/${patientId}/episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseManagementId,
          diagnosis: diagnosis.trim(),
          bodyPart: bodyPart.trim() ? bodyPart.trim() : null,
          departmentId,
          flipIcdFromCase: caseHasFlipPair ? flipIcdFromCase : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(
          body?.error?.message ?? 'Could not create the episode. Please try again.',
        );
        return;
      }
      router.push(`/patients/${patientId}?episode_created=1`);
      router.refresh();
    });
  }

  const canSubmit =
    diagnosis.trim().length > 0 && departmentId.length > 0 && !pending;

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Under case: <span className="font-medium text-foreground">{caseLabel}</span>
      </p>

      <div className="space-y-2">
        <Label htmlFor="diagnosis">Plan-of-care diagnosis</Label>
        <Input
          id="diagnosis"
          required
          maxLength={280}
          value={diagnosis}
          onChange={(e) => setDiagnosis(e.target.value)}
          placeholder="e.g. Right knee osteoarthritis, post-op month 2"
          disabled={pending}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="bodyPart">Body part (optional)</Label>
        <Input
          id="bodyPart"
          maxLength={120}
          value={bodyPart}
          onChange={(e) => setBodyPart(e.target.value)}
          placeholder="e.g. Right knee"
          disabled={pending}
        />
      </div>

      <div className="space-y-2">
        <Label>Department</Label>
        <Select
          value={departmentId}
          onValueChange={setDepartmentId}
          disabled={pending || compatibleDepts.length === 0}
        >
          <SelectTrigger>
            <SelectValue placeholder="Pick a REHAB department" />
          </SelectTrigger>
          <SelectContent>
            {compatibleDepts.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name} ({DIVISION_LABEL[d.division]})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {compatibleDepts.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No REHAB or MULTI departments in your organization. Ask your administrator to add one.
          </p>
        )}
      </div>

      {caseHasFlipPair && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={flipIcdFromCase}
            onChange={(e) => setFlipIcdFromCase(e.target.checked)}
            disabled={pending}
            className="mt-0.5"
          />
          <span>
            Swap primary/secondary ICD from the parent case for rehab billing (case codes stay
            unchanged).
          </span>
        </label>
      )}

      {error && <StatusBanner variant="danger">{error}</StatusBanner>}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push(`/patients/${patientId}`)}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {pending ? 'Creating…' : 'Create rehab episode'}
        </Button>
      </div>
    </form>
  );
}
