'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBanner } from '@/components/ui/status-banner';

const PROFILES = ['STANDARD', 'BH_42CFR2', 'RESEARCH'] as const;

type Props = {
  orgId: string;
  initial: {
    baaExecutedAt: string | null;
    baaVersion: string | null;
    complianceProfile: (typeof PROFILES)[number];
  };
};

export function BaaForm({ orgId, initial }: Props) {
  const router = useRouter();
  const [executedAt, setExecutedAt] = useState(initial.baaExecutedAt ?? '');
  const [version, setVersion] = useState(initial.baaVersion ?? '');
  const [profile, setProfile] = useState<(typeof PROFILES)[number]>(initial.complianceProfile);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/owner/orgs/${orgId}/baa`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baaExecutedAt: executedAt, baaVersion: version, complianceProfile: profile }),
      });
      if (!res.ok) {
        setError('Could not save.');
        return;
      }
      setSavedAt(new Date().toLocaleTimeString());
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="baa-date">Executed at</Label>
          <Input id="baa-date" type="date" required value={executedAt} onChange={(e) => setExecutedAt(e.target.value)} disabled={pending} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="baa-ver">Version</Label>
          <Input id="baa-ver" required value={version} onChange={(e) => setVersion(e.target.value)} disabled={pending} />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Compliance profile</Label>
        <Select value={profile} onValueChange={(v) => setProfile(v as (typeof PROFILES)[number])} disabled={pending}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {PROFILES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {error && <StatusBanner variant="danger">{error}</StatusBanner>}
      {savedAt && <StatusBanner variant="success">Saved at {savedAt}.</StatusBanner>}
      <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save BAA'}</Button>
    </form>
  );
}
