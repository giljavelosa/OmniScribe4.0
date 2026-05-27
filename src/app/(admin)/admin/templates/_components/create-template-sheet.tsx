'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBanner } from '@/components/ui/status-banner';

const DIVISIONS = [
  { value: 'MEDICAL', label: 'Medical' },
  { value: 'REHAB', label: 'Rehab' },
  { value: 'BEHAVIORAL_HEALTH', label: 'Behavioral health' },
  { value: 'MULTI', label: 'Multi' },
];

const VISIBILITY_ALL = [
  { value: 'PERSONAL', label: 'Personal (only you)' },
  { value: 'TEAM', label: 'Team (whole org)' },
];
const VISIBILITY_PERSONAL_ONLY = [
  { value: 'PERSONAL', label: 'Personal (only you)' },
];

const SENSITIVITY = [
  { value: 'STANDARD_CLINICAL', label: 'Standard clinical' },
  { value: 'BEHAVIORAL_HEALTH', label: 'Behavioral health (42 CFR Part 2)' },
  { value: 'BILLING_ONLY', label: 'Billing only' },
];

/**
 * CreateTemplateSheet — header / structure-only form. Initial section
 * skeleton (one "Notes" section) is created server-side; the per-section
 * editor lives at `${basePath}/[id]`. Two-step flow is simpler than a
 * single mega-form + lets the live preview show against an empty
 * starter shape.
 *
 * `basePath` parameterizes the editor URL (admin → `/admin/templates`;
 * clinical → `/templates`). `personalOnly` hides TEAM from the picker
 * for non-admin callers — the API enforces the same rule server-side.
 */
export function CreateTemplateSheet({
  basePath = '/admin/templates',
  personalOnly = false,
}: {
  basePath?: string;
  personalOnly?: boolean;
} = {}) {
  const router = useRouter();
  const visibilityChoices = personalOnly ? VISIBILITY_PERSONAL_ONLY : VISIBILITY_ALL;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [division, setDivision] = useState('MEDICAL');
  const [specialty, setSpecialty] = useState('');
  const [visibility, setVisibility] = useState('PERSONAL');
  const [sensitivityDefault, setSensitivityDefault] = useState('STANDARD_CLINICAL');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    startTransition(async () => {
      const res = await fetch('/api/admin/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          division,
          specialty: specialty.trim() || null,
          visibility,
          sensitivityDefault,
          sectionSchema: {
            sections: [
              {
                id: 'notes',
                label: 'Notes',
                required: true,
                promptHint: 'Free-form notes. Edit sections in the template editor.',
              },
            ],
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Create failed (${res.status}).`);
        return;
      }
      const json = (await res.json()) as { data: { id: string } };
      setOpen(false);
      router.push(`${basePath}/${json.data.id}`);
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button>
          <Plus className="size-4" aria-hidden="true" />
          New template
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>New template</SheetTitle>
          <SheetDescription>
            Creates a draft with a single &ldquo;Notes&rdquo; section. Open the editor to add
            more sections + the live preview.
          </SheetDescription>
        </SheetHeader>
        <form
          className="mt-4 space-y-3 px-4 pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="tmpl-name">Name</Label>
            <Input id="tmpl-name" value={name} onChange={(e) => setName(e.target.value.slice(0, 160))} maxLength={160} disabled={pending} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tmpl-desc">Description</Label>
            <Textarea id="tmpl-desc" value={description} onChange={(e) => setDescription(e.target.value.slice(0, 1000))} rows={2} maxLength={1000} disabled={pending} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Division</Label>
              <Select value={division} onValueChange={setDivision}>
                <SelectTrigger disabled={pending}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DIVISIONS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tmpl-spec">Specialty</Label>
              <Input id="tmpl-spec" value={specialty} onChange={(e) => setSpecialty(e.target.value.slice(0, 120))} maxLength={120} disabled={pending} placeholder="optional" />
            </div>
            <div className="space-y-1.5">
              <Label>Visibility</Label>
              <Select value={visibility} onValueChange={setVisibility}>
                <SelectTrigger disabled={pending || personalOnly}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {visibilityChoices.map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Sensitivity default</Label>
              <Select value={sensitivityDefault} onValueChange={setSensitivityDefault}>
                <SelectTrigger disabled={pending}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SENSITIVITY.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && <StatusBanner variant="danger">{error}</StatusBanner>}

          <SheetFooter className="mt-4 sm:items-center">
            <SheetClose asChild>
              <Button type="button" variant="ghost" disabled={pending}>Cancel</Button>
            </SheetClose>
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create + open editor'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
