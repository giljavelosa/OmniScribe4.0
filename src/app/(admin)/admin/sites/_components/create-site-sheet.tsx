'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBanner } from '@/components/ui/status-banner';

const DIVISIONS = [
  { value: '', label: '(no primary division)' },
  { value: 'MEDICAL', label: 'Medical' },
  { value: 'REHAB', label: 'Rehab' },
  { value: 'BEHAVIORAL_HEALTH', label: 'Behavioral health' },
  { value: 'MULTI', label: 'Multi' },
];

/**
 * CreateSiteSheet — "+ Add Site" trigger + slide-in sheet form.
 *
 * Rule 22: shadcn Sheet primitive (not a native dialog). Form is plain HTML
 * with onSubmit handler; submission POSTs /api/admin/sites and pulls a
 * router.refresh() so the parent table re-renders with the new row.
 */
export function CreateSiteSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    // The <Select> "(no primary division)" option uses the __none__ sentinel
    // because Radix forbids the empty string as a value. Strip it before the
    // API call — the server expects a valid Division enum or null.
    const rawDivision = (formData.get('primaryDivision') as string) || '';
    const primaryDivision = rawDivision && rawDivision !== '__none__' ? rawDivision : null;
    const body = {
      name: String(formData.get('name') ?? '').trim(),
      address: (formData.get('address') as string)?.trim() || null,
      phone: (formData.get('phone') as string)?.trim() || null,
      primaryDivision,
    };
    if (!body.name) {
      setError('Site name is required.');
      return;
    }
    startTransition(async () => {
      const res = await fetch('/api/admin/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error?.message ?? `Create failed (${res.status}).`);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button>
          <Plus className="size-4" aria-hidden="true" />
          Add site
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Add a new site</SheetTitle>
          <SheetDescription>
            Sites group rooms together. Patients and departments live under a site.
          </SheetDescription>
        </SheetHeader>
        <form
          className="mt-4 space-y-3 px-4 pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(new FormData(e.currentTarget));
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="site-name">Name</Label>
            <Input id="site-name" name="name" required maxLength={120} placeholder="Demo Main Office" disabled={pending} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="site-address">Address</Label>
            <Input id="site-address" name="address" maxLength={280} placeholder="1 Demo Way, Springfield, USA" disabled={pending} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="site-phone">Phone</Label>
            <Input id="site-phone" name="phone" maxLength={40} placeholder="+1-555-0100" disabled={pending} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="site-division">Primary division</Label>
            <Select name="primaryDivision">
              <SelectTrigger id="site-division" disabled={pending}>
                <SelectValue placeholder="(no primary division)" />
              </SelectTrigger>
              <SelectContent>
                {DIVISIONS.map((d) => (
                  <SelectItem key={d.value || 'none'} value={d.value || '__none__'}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && <StatusBanner variant="danger">{error}</StatusBanner>}

          <SheetFooter className="mt-4 sm:items-center">
            <SheetClose asChild>
              <Button type="button" variant="ghost" disabled={pending}>
                Cancel
              </Button>
            </SheetClose>
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create site'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
