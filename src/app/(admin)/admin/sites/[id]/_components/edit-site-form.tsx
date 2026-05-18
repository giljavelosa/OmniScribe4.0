'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBanner } from '@/components/ui/status-banner';

const DIVISIONS = [
  { value: '', label: '(no primary division)' },
  { value: 'MEDICAL', label: 'Medical' },
  { value: 'REHAB', label: 'Rehab' },
  { value: 'BEHAVIORAL_HEALTH', label: 'Behavioral health' },
  { value: 'MULTI', label: 'Multi' },
];

type Props = {
  siteId: string;
  initial: {
    name: string;
    address: string | null;
    phone: string | null;
    primaryDivision: string | null;
  };
};

export function EditSiteForm({ siteId, initial }: Props) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [address, setAddress] = useState(initial.address ?? '');
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [primaryDivision, setPrimaryDivision] = useState(initial.primaryDivision ?? '');
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSavedAt(null);
    if (!name.trim()) {
      setError('Site name is required.');
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/admin/sites/${siteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          address: address.trim() || null,
          phone: phone.trim() || null,
          primaryDivision: primaryDivision || null,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error?.message ?? `Save failed (${res.status}).`);
        return;
      }
      setSavedAt(new Date().toLocaleTimeString());
      router.refresh();
    });
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="edit-name">Name</Label>
          <Input
            id="edit-name"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 120))}
            maxLength={120}
            disabled={pending}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-division">Primary division</Label>
          <Select value={primaryDivision || '__none__'} onValueChange={(v) => setPrimaryDivision(v === '__none__' ? '' : v)}>
            <SelectTrigger id="edit-division" disabled={pending}>
              <SelectValue placeholder="(no primary division)" />
            </SelectTrigger>
            <SelectContent>
              {DIVISIONS.map((d) => (
                <SelectItem key={d.value || '__none__'} value={d.value || '__none__'}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="edit-address">Address</Label>
          <Input
            id="edit-address"
            value={address}
            onChange={(e) => setAddress(e.target.value.slice(0, 280))}
            maxLength={280}
            disabled={pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-phone">Phone</Label>
          <Input
            id="edit-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value.slice(0, 40))}
            maxLength={40}
            disabled={pending}
          />
        </div>
      </div>

      {error && <StatusBanner variant="danger">{error}</StatusBanner>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        {savedAt && (
          <span className="text-xs text-muted-foreground">Saved at {savedAt}</span>
        )}
      </div>
    </form>
  );
}
