'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBanner } from '@/components/ui/status-banner';

const DIVISIONS = ['MEDICAL', 'REHAB', 'BEHAVIORAL_HEALTH', 'MULTI'] as const;
const PROFILES = ['STANDARD', 'BH_42CFR2', 'RESEARCH'] as const;

export function NewOrgForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [division, setDivision] = useState<(typeof DIVISIONS)[number]>('MEDICAL');
  const [complianceProfile, setComplianceProfile] = useState<(typeof PROFILES)[number]>('STANDARD');
  const [billingEmail, setBillingEmail] = useState('');
  const [baaExecutedAt, setBaaExecutedAt] = useState('');
  const [baaVersion, setBaaVersion] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/owner/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          division,
          complianceProfile,
          billingEmail,
          baaExecutedAt,
          baaVersion,
          initialAdminEmail: adminEmail,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? 'Could not create organization.');
        return;
      }
      const body = await res.json();
      router.push(`/owner/orgs/${body.data.orgId}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="oname">Organization name</Label>
        <Input id="oname" required value={name} onChange={(e) => setName(e.target.value)} disabled={pending} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Division</Label>
          <Select value={division} onValueChange={(v) => setDivision(v as (typeof DIVISIONS)[number])} disabled={pending}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DIVISIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Compliance profile</Label>
          <Select value={complianceProfile} onValueChange={(v) => setComplianceProfile(v as (typeof PROFILES)[number])} disabled={pending}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PROFILES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="bemail">Billing email</Label>
        <Input id="bemail" type="email" required value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} disabled={pending} />
      </div>
      <fieldset className="space-y-3 rounded-lg border border-border p-3">
        <legend className="px-1 text-xs uppercase tracking-wide text-muted-foreground">BAA (required)</legend>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="bdate">Executed at</Label>
            <Input id="bdate" type="date" required value={baaExecutedAt} onChange={(e) => setBaaExecutedAt(e.target.value)} disabled={pending} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bver">Version</Label>
            <Input id="bver" required value={baaVersion} onChange={(e) => setBaaVersion(e.target.value)} disabled={pending} placeholder="e.g. 2026.05.01" />
          </div>
        </div>
      </fieldset>
      <div className="space-y-2">
        <Label htmlFor="aemail">Initial admin email (invited as SUPER_ADMIN)</Label>
        <Input id="aemail" type="email" required value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} disabled={pending} />
      </div>
      {error && <StatusBanner variant="danger">{error}</StatusBanner>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Creating…' : 'Create organization'}
      </Button>
    </form>
  );
}
