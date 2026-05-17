'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBanner } from '@/components/ui/status-banner';

const VISIBILITY = [
  { value: 'PERSONAL', label: 'Personal (only you)' },
  { value: 'TEAM', label: 'Team (whole org)' },
];

/**
 * CloneTemplateButton — opens AlertDialog with name + visibility inputs.
 * POSTs /clone → router.push to the new template's editor.
 *
 * Works for both org-scoped templates and presets (preset clones land in
 * the current org with isPreset=false + clonedFromId set).
 */
export function CloneTemplateButton({
  templateId,
  defaultName,
  variant = 'ghost',
}: {
  templateId: string;
  defaultName: string;
  variant?: 'ghost' | 'outline';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`${defaultName} (copy)`);
  const [visibility, setVisibility] = useState('PERSONAL');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function commit() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/admin/templates/${templateId}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), visibility }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Clone failed (${res.status}).`);
        return;
      }
      const json = (await res.json()) as { data: { id: string } };
      setOpen(false);
      router.push(`/admin/templates/${json.data.id}`);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1"
      >
        <Copy className="size-3" aria-hidden="true" />
        Clone
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clone template</AlertDialogTitle>
            <AlertDialogDescription>
              Creates a new template in your org at version 1, linked to the source via the
              clonedFromId chain. Open the editor to make changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 px-1">
            <div className="space-y-1.5">
              <Label htmlFor="clone-name">New name</Label>
              <Input
                id="clone-name"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 160))}
                maxLength={160}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Visibility</Label>
              <Select value={visibility} onValueChange={setVisibility}>
                <SelectTrigger disabled={pending}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VISIBILITY.map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {error && <StatusBanner variant="danger">{error}</StatusBanner>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={commit} disabled={pending || !name.trim()}>
              {pending ? 'Cloning…' : 'Clone + open'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
