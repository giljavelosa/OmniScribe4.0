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

const PICKABLE_DIVISIONS: Division[] = [
  Division.MEDICAL,
  Division.REHAB,
  Division.BEHAVIORAL_HEALTH,
];

const DIVISION_LABEL: Record<Division, string> = {
  MEDICAL: 'MEDICAL',
  REHAB: 'REHAB',
  BEHAVIORAL_HEALTH: 'Behavioral health',
  MULTI: 'Multi-division',
};

/**
 * NewEpisodeForm — client form for /patients/[id]/episodes/new.
 *
 * Department dropdown filters to entries whose division matches the chosen
 * division (or whose division is MULTI). Submits to POST
 * /api/patients/[id]/episodes; on success redirects back to the patient page
 * with a `?episode_created=1` flash query so the patient page can render a
 * "Episode created — start visit again to link to it." notice.
 */
export function NewEpisodeForm({
  patientId,
  departments,
}: {
  patientId: string;
  departments: Dept[];
}) {
  const router = useRouter();
  const [diagnosis, setDiagnosis] = useState('');
  const [bodyPart, setBodyPart] = useState('');
  const [division, setDivision] = useState<Division>(Division.MEDICAL);
  const [departmentId, setDepartmentId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const compatibleDepts = useMemo(
    () =>
      departments.filter(
        (d) => d.division === Division.MULTI || d.division === division,
      ),
    [departments, division],
  );

  // Reset department selection when division switch invalidates the prior one.
  function changeDivision(next: Division) {
    setDivision(next);
    const stillFits = departments.some(
      (d) =>
        d.id === departmentId &&
        (d.division === Division.MULTI || d.division === next),
    );
    if (!stillFits) setDepartmentId('');
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/patients/${patientId}/episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          diagnosis: diagnosis.trim(),
          bodyPart: bodyPart.trim() ? bodyPart.trim() : null,
          division,
          departmentId,
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
      <div className="space-y-2">
        <Label htmlFor="diagnosis">Diagnosis</Label>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Division</Label>
          <Select
            value={division}
            onValueChange={(v) => changeDivision(v as Division)}
            disabled={pending}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PICKABLE_DIVISIONS.map((d) => (
                <SelectItem key={d} value={d}>
                  {DIVISION_LABEL[d]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Department</Label>
          <Select
            value={departmentId}
            onValueChange={setDepartmentId}
            disabled={pending || compatibleDepts.length === 0}
          >
            <SelectTrigger>
              <SelectValue placeholder="Pick a department" />
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
              No departments in your organization match this division. Ask your administrator
              to add one.
            </p>
          )}
        </div>
      </div>

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
          {pending ? 'Creating…' : 'Create episode'}
        </Button>
      </div>
    </form>
  );
}
