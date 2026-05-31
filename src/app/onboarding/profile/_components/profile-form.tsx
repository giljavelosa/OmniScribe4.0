'use client';

import { useState, useTransition } from 'react';
import { useSession } from 'next-auth/react';
import { Division, Profession } from '@prisma/client';

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
import {
  divisionForProfession,
  PROFESSION_OPTIONS,
  professionLabel,
} from '@/lib/professions';

type Props = {
  currentProfessionType: Profession | null;
  currentProfession: string | null;
};

const DIVISION_LABELS: Record<Division, string> = {
  [Division.MEDICAL]: 'Medical',
  [Division.REHAB]: 'Rehab (PT / OT / SLP)',
  [Division.BEHAVIORAL_HEALTH]: 'Behavioral Health',
  [Division.MULTI]: 'Multi', // never offered; kept here so the map is exhaustive
};

export function ProfileForm({
  currentProfessionType,
  currentProfession,
}: Props) {
  const [professionType, setProfessionType] = useState<Profession | ''>(
    currentProfessionType ?? '',
  );
  const [profession, setProfession] = useState<string>(currentProfession ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { update } = useSession();

  // Division is derived from profession (1:1 map) and shown read-only — a PT
  // can't complete their profile as MEDICAL.
  const derivedDivision = professionType ? divisionForProfession(professionType) : null;

  function submit() {
    setError(null);
    if (!professionType) {
      setError('Choose your profession.');
      return;
    }
    startTransition(async () => {
      const res = await fetch('/api/me/complete-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          professionType,
          profession: profession.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Couldn't save (${res.status}). Try again.`);
        return;
      }
      // Trigger a JWT refresh so the updated professionType/division reach
      // the server before the next page render. The trigger:'update' path in
      // auth.config.ts re-fetches the OrgUser row from DB automatically.
      await update();
      window.location.assign('/home');
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-5"
    >
      <div className="space-y-2">
        <Label htmlFor="professionType">Profession</Label>
        <Select
          value={professionType}
          onValueChange={(v) => setProfessionType(v as Profession)}
          disabled={pending}
        >
          <SelectTrigger id="professionType">
            <SelectValue placeholder="Choose one" />
          </SelectTrigger>
          <SelectContent>
            {PROFESSION_OPTIONS.map((p) => (
              <SelectItem key={p} value={p}>
                {professionLabel(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="division">Division</Label>
        <div
          id="division"
          className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm"
        >
          {derivedDivision ? (
            <span>{DIVISION_LABELS[derivedDivision]}</span>
          ) : (
            <span className="text-muted-foreground">Select your profession first</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Derived from your profession — your notes are always documented under
          this division.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="profession">Specialty (optional)</Label>
        <Input
          id="profession"
          value={profession}
          onChange={(e) => setProfession(e.target.value.slice(0, 200))}
          placeholder="e.g. Family Medicine, Outpatient Ortho"
          disabled={pending}
        />
      </div>

      {error && <StatusBanner variant="danger">{error}</StatusBanner>}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Saving…' : 'Save and continue'}
      </Button>
    </form>
  );
}
