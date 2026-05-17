'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBanner } from '@/components/ui/status-banner';

const DIVISIONS = [
  { value: 'MEDICAL', label: 'Medical' },
  { value: 'REHAB', label: 'Rehab' },
  { value: 'BEHAVIORAL_HEALTH', label: 'Behavioral health' },
  { value: 'MULTI', label: 'Multi' },
];

const COMPLIANCE = [
  { value: 'STANDARD', label: 'Standard' },
  { value: 'BH_42CFR2', label: 'Behavioral health (42 CFR Part 2)' },
  { value: 'RESEARCH', label: 'Research' },
];

const NOTE_STYLES = [
  { value: 'NARRATIVE', label: 'Narrative' },
  { value: 'HYBRID', label: 'Hybrid (default)' },
  { value: 'HYBRID_BULLET', label: 'Hybrid bullet' },
  { value: 'STRUCTURED', label: 'Structured' },
];

type Props = {
  initial: {
    name: string;
    division: string;
    defaultDivision: string | null;
    forceMfa: boolean;
    complianceProfile: string;
  };
};

export function OrgSettingsForm({ initial }: Props) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [division, setDivision] = useState(initial.division);
  const [defaultDivision, setDefaultDivision] = useState(initial.defaultDivision ?? '');
  const [forceMfa, setForceMfa] = useState(initial.forceMfa);
  const [complianceProfile, setComplianceProfile] = useState(initial.complianceProfile);
  const [defaultNoteStyle, setDefaultNoteStyle] = useState('HYBRID');
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSavedAt(null);
    startTransition(async () => {
      const res = await fetch('/api/admin/org-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          division,
          defaultDivision: defaultDivision || null,
          forceMfa,
          complianceProfile,
          defaultNoteStyle,
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
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="org-name">Organization name</Label>
          <Input
            id="org-name"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 200))}
            maxLength={200}
            disabled={pending}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label>Primary division</Label>
          <Select value={division} onValueChange={setDivision}>
            <SelectTrigger disabled={pending}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIVISIONS.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Default division for new patients</Label>
          <Select value={defaultDivision || '__same__'} onValueChange={(v) => setDefaultDivision(v === '__same__' ? '' : v)}>
            <SelectTrigger disabled={pending}>
              <SelectValue placeholder="(same as primary)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__same__">(same as primary)</SelectItem>
              {DIVISIONS.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Compliance profile</Label>
          <Select value={complianceProfile} onValueChange={setComplianceProfile}>
            <SelectTrigger disabled={pending}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMPLIANCE.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Default note style</Label>
          <Select value={defaultNoteStyle} onValueChange={setDefaultNoteStyle}>
            <SelectTrigger disabled={pending}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NOTE_STYLES.map((n) => (
                <SelectItem key={n.value} value={n.value}>
                  {n.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Per-clinician overrides on their profile take precedence. Stored in the audit log
            today; will move onto Organization when the schema grows the field.
          </p>
        </div>
      </div>

      <div className="rounded-md border border-border p-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <Label htmlFor="force-mfa">Force MFA at sign-in</Label>
            <p className="text-xs text-muted-foreground">
              Already enforced by D2 (every user enrolls on first sign-in). Toggle here for
              future-proofing — if D2 is ever relaxed, this flag becomes the per-org gate.
            </p>
          </div>
          <Switch
            id="force-mfa"
            checked={forceMfa}
            onCheckedChange={setForceMfa}
            disabled={pending}
          />
        </div>
      </div>

      {error && <StatusBanner variant="danger">{error}</StatusBanner>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save settings'}
        </Button>
        {savedAt && (
          <span className="text-xs text-muted-foreground">Saved at {savedAt}</span>
        )}
      </div>
    </form>
  );
}
