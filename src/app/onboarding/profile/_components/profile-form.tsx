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
  CLINICIAN_PICKABLE_DIVISIONS,
  PROFESSION_OPTIONS,
  professionLabel,
} from '@/lib/professions';

type Props = {
  currentDivision: Division | null;
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
  currentDivision,
  currentProfessionType,
  currentProfession,
}: Props) {
  // Seed division from the current value ONLY if it's a pickable concrete
  // value — MULTI is the source of the gate, so don't preselect it.
  const seedDivision =
    currentDivision && CLINICIAN_PICKABLE_DIVISIONS.includes(currentDivision)
      ? currentDivision
      : '';
  const [division, setDivision] = useState<Division | ''>(seedDivision);
  const [professionType, setProfessionType] = useState<Profession | ''>(
    currentProfessionType ?? '',
  );
  const [profession, setProfession] = useState<string>(currentProfession ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { update } = useSession();

  function submit() {
    setError(null);
    if (!division || !professionType) {
      setError('Choose both a division and a profession.');
      return;
    }
    startTransition(async () => {
      const res = await fetch('/api/me/complete-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          division,
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
      //
      // IMPORTANT: pass a payload (any non-undefined value) so next-auth v5
      // sends a POST with body. Calling `update()` with NO args sends a GET,
      // which does NOT set `isUpdate=true` server-side, which means the jwt
      // callback never receives `trigger: 'update'` and the cookie keeps the
      // pre-save values — producing a /prepare → /onboarding/profile loop on
      // the next click. The payload itself is ignored by our jwt callback
      // (it always re-fetches OrgUser from DB on `trigger === 'update'`),
      // so this is just a "please do the POST" sentinel.
      await update({ profileCompleted: true });
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
        <Label htmlFor="division">Division</Label>
        <Select
          value={division}
          onValueChange={(v) => setDivision(v as Division)}
          disabled={pending}
        >
          <SelectTrigger id="division">
            <SelectValue placeholder="Choose one" />
          </SelectTrigger>
          <SelectContent>
            {CLINICIAN_PICKABLE_DIVISIONS.map((d) => (
              <SelectItem key={d} value={d}>
                {DIVISION_LABELS[d]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

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
