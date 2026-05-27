'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Eye, Save, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
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

const DIVISIONS = ['MEDICAL', 'REHAB', 'BEHAVIORAL_HEALTH', 'MULTI'];
const VISIBILITY_ALL = ['PERSONAL', 'TEAM'];
const VISIBILITY_PERSONAL_ONLY = ['PERSONAL'];
const SENSITIVITY = ['STANDARD_CLINICAL', 'BEHAVIORAL_HEALTH', 'BILLING_ONLY'];

type Section = {
  id: string;
  label: string;
  required?: boolean;
  promptHint?: string;
};

type Template = {
  id: string;
  name: string;
  description: string | null;
  division: string;
  specialty: string | null;
  visibility: string;
  sensitivityDefault: string;
  version: number;
  isArchived: boolean;
  sectionSchema: { sections: Section[] };
  clonedFrom: { id: string; name: string; version: number } | null;
};

const SLUG_RE = /^[a-z0-9_-]+$/;

/**
 * TemplateEditor — header form + section editor + live preview pane.
 *
 * Save commits the whole template (header + sections) in one PATCH; the
 * server bumps `version` when sectionSchema actually changes. Live
 * preview pane renders the section list exactly as SectionAccordion
 * would on /review — text-only, no interactivity.
 */
export function TemplateEditor({
  template,
  basePath = '/admin/templates',
  personalOnly = false,
}: {
  template: Template;
  basePath?: string;
  personalOnly?: boolean;
}) {
  const router = useRouter();
  const visibilityChoices = personalOnly ? VISIBILITY_PERSONAL_ONLY : VISIBILITY_ALL;
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? '');
  const [division, setDivision] = useState(template.division);
  const [specialty, setSpecialty] = useState(template.specialty ?? '');
  const [visibility, setVisibility] = useState(template.visibility);
  const [sensitivityDefault, setSensitivityDefault] = useState(template.sensitivityDefault);
  const [sections, setSections] = useState<Section[]>(template.sectionSchema.sections);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sectionsDirty = useMemo(
    () => JSON.stringify(sections) !== JSON.stringify(template.sectionSchema.sections),
    [sections, template.sectionSchema.sections],
  );

  function save() {
    setError(null);
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (sections.length === 0) {
      setError('At least one section is required.');
      return;
    }
    // Section id uniqueness + format check.
    const seen = new Set<string>();
    for (const s of sections) {
      if (!SLUG_RE.test(s.id)) {
        setError(`Section id "${s.id}" must be lowercase letters / digits / _ / -.`);
        return;
      }
      if (seen.has(s.id)) {
        setError(`Section id "${s.id}" is duplicated.`);
        return;
      }
      seen.add(s.id);
    }

    startTransition(async () => {
      const res = await fetch(`/api/admin/templates/${template.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          division,
          specialty: specialty.trim() || null,
          visibility,
          sensitivityDefault,
          sectionSchema: { sections },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Save failed (${res.status}).`);
        return;
      }
      setSavedAt(new Date().toLocaleTimeString());
      router.refresh();
    });
  }

  function archive() {
    startTransition(async () => {
      const res = await fetch(`/api/admin/templates/${template.id}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: template.isArchived ? 'unarchive' : 'archive' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Archive failed (${res.status}).`);
        return;
      }
      setArchiveOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-4">
      <div className="space-y-4 min-w-0">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div className="space-y-1 flex-1 min-w-0">
              <CardTitle className="text-md">Header</CardTitle>
              <CardDescription>
                Version <span className="font-mono">v{template.version}</span> — section edits
                bump this on save.
                {template.clonedFrom && (
                  <>
                    {' · '}
                    Cloned from{' '}
                    <Link href={`${basePath}/${template.clonedFrom.id}`} className="underline">
                      {template.clonedFrom.name} (v{template.clonedFrom.version})
                    </Link>
                  </>
                )}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {savedAt && <StatusBadge variant="success" noIcon>saved {savedAt}</StatusBadge>}
              <Button type="button" onClick={save} disabled={pending} className="gap-1">
                <Save className="size-3" aria-hidden="true" />
                {pending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="t-name">Name</Label>
              <Input id="t-name" value={name} onChange={(e) => setName(e.target.value.slice(0, 160))} maxLength={160} disabled={pending} />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="t-desc">Description</Label>
              <Textarea id="t-desc" value={description} onChange={(e) => setDescription(e.target.value.slice(0, 1000))} rows={2} maxLength={1000} disabled={pending} />
            </div>
            <div className="space-y-1.5">
              <Label>Division</Label>
              <Select value={division} onValueChange={setDivision}>
                <SelectTrigger disabled={pending}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DIVISIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-spec">Specialty</Label>
              <Input id="t-spec" value={specialty} onChange={(e) => setSpecialty(e.target.value.slice(0, 120))} maxLength={120} disabled={pending} />
            </div>
            <div className="space-y-1.5">
              <Label>Visibility</Label>
              <Select value={visibility} onValueChange={setVisibility}>
                <SelectTrigger disabled={pending || personalOnly}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {visibilityChoices.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Sensitivity default</Label>
              <Select value={sensitivityDefault} onValueChange={setSensitivityDefault}>
                <SelectTrigger disabled={pending}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SENSITIVITY.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="text-md">Sections</CardTitle>
              <CardDescription>
                {sections.length} section{sections.length === 1 ? '' : 's'}.
                {sectionsDirty && (
                  <StatusBadge variant="warning" noIcon className="ml-2">unsaved</StatusBadge>
                )}
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setSections((curr) => [
                  ...curr,
                  {
                    id: `section_${curr.length + 1}`,
                    label: `Section ${curr.length + 1}`,
                    required: false,
                    promptHint: '',
                  },
                ])
              }
              disabled={pending || sections.length >= 20}
            >
              + Add section
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {sections.map((s, idx) => (
              <SectionEditor
                key={`${s.id}-${idx}`}
                section={s}
                index={idx}
                total={sections.length}
                disabled={pending}
                onChange={(next) =>
                  setSections((curr) => curr.map((c, i) => (i === idx ? next : c)))
                }
                onMove={(dir) =>
                  setSections((curr) => moveSection(curr, idx, dir))
                }
                onDelete={() =>
                  setSections((curr) => curr.filter((_, i) => i !== idx))
                }
              />
            ))}
          </CardContent>
        </Card>

        {error && <StatusBanner variant="danger">{error}</StatusBanner>}

        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setArchiveOpen(true)}
            className={template.isArchived ? '' : 'text-[var(--status-danger-fg)]'}
            disabled={pending}
          >
            {template.isArchived ? 'Unarchive template' : 'Archive template'}
          </Button>
        </div>
      </div>

      <aside className="lg:sticky lg:top-4 self-start space-y-3">
        <LivePreview
          sections={sections}
          name={name}
          division={division}
          visibility={visibility}
        />
      </aside>

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {template.isArchived ? 'Unarchive' : 'Archive'} &ldquo;{name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {template.isArchived
                ? 'Restores the template to the picker.'
                : 'Hides the template from the picker. Notes already using this template stay intact.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={archive}
              disabled={pending}
              className={template.isArchived ? '' : 'bg-destructive text-white hover:bg-destructive/90'}
            >
              {pending ? 'Working…' : template.isArchived ? 'Unarchive' : 'Archive'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function moveSection(sections: Section[], idx: number, dir: 'up' | 'down'): Section[] {
  const next = [...sections];
  const target = dir === 'up' ? idx - 1 : idx + 1;
  if (target < 0 || target >= next.length) return sections;
  const tmp = next[idx]!;
  next[idx] = next[target]!;
  next[target] = tmp;
  return next;
}

function SectionEditor({
  section,
  index,
  total,
  disabled,
  onChange,
  onMove,
  onDelete,
}: {
  section: Section;
  index: number;
  total: number;
  disabled: boolean;
  onChange: (next: Section) => void;
  onMove: (dir: 'up' | 'down') => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor={`s-id-${index}`} className="text-xs">ID</Label>
          <Input
            id={`s-id-${index}`}
            value={section.id}
            onChange={(e) => onChange({ ...section, id: e.target.value.toLowerCase().slice(0, 60) })}
            disabled={disabled}
            className="font-mono"
            maxLength={60}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`s-label-${index}`} className="text-xs">Label</Label>
          <Input
            id={`s-label-${index}`}
            value={section.label}
            onChange={(e) => onChange({ ...section, label: e.target.value.slice(0, 80) })}
            disabled={disabled}
            maxLength={80}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`s-hint-${index}`} className="text-xs">Prompt hint (sent to the LLM)</Label>
        <Textarea
          id={`s-hint-${index}`}
          value={section.promptHint ?? ''}
          onChange={(e) => onChange({ ...section, promptHint: e.target.value.slice(0, 500) })}
          rows={2}
          maxLength={500}
          disabled={disabled}
          placeholder="What should the AI focus on for this section?"
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Switch
            id={`s-req-${index}`}
            checked={!!section.required}
            onCheckedChange={(c) => onChange({ ...section, required: c })}
            disabled={disabled}
          />
          <Label htmlFor={`s-req-${index}`} className="text-xs">Required for sign</Label>
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" disabled={disabled || index === 0} onClick={() => onMove('up')} aria-label="Move up" className="h-7 w-7">
            <ArrowUp className="size-3" aria-hidden="true" />
          </Button>
          <Button type="button" variant="ghost" size="icon" disabled={disabled || index === total - 1} onClick={() => onMove('down')} aria-label="Move down" className="h-7 w-7">
            <ArrowDown className="size-3" aria-hidden="true" />
          </Button>
          <Button type="button" variant="ghost" size="icon" disabled={disabled || total === 1} onClick={onDelete} aria-label="Delete section" className="h-7 w-7">
            <Trash2 className="size-3 text-[var(--status-danger-fg)]" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function LivePreview({
  sections,
  name,
  division,
  visibility,
}: {
  sections: Section[];
  name: string;
  division: string;
  visibility: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-md flex items-center gap-2">
          <Eye className="size-4" aria-hidden="true" />
          Live preview
        </CardTitle>
        <CardDescription>
          Renders the section list the way clinicians see it on /review. Text only — no
          interactivity, no real content.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border border-border p-3 space-y-1">
          <p className="font-medium text-sm">{name || '(unnamed template)'}</p>
          <div className="flex flex-wrap gap-1 text-[10px]">
            <StatusBadge variant="neutral" noIcon>{division}</StatusBadge>
            <StatusBadge variant="neutral" noIcon>{visibility}</StatusBadge>
          </div>
        </div>
        <ul className="space-y-2 text-sm">
          {sections.length === 0 ? (
            <li className="text-muted-foreground italic">No sections yet.</li>
          ) : (
            sections.map((s, i) => (
              <li key={`${s.id}-${i}`} className="rounded border border-border bg-muted/30 p-2 space-y-1">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="text-muted-foreground">○</span>
                  <p className="font-medium">
                    {s.label || '(unnamed)'}
                    {s.required && <span className="ml-1 text-[var(--status-danger-fg)]">*</span>}
                  </p>
                  <span className="ml-auto text-[10px] font-mono text-muted-foreground">{s.id}</span>
                </div>
                {s.promptHint && (
                  <p className="text-xs text-muted-foreground pl-5">{s.promptHint}</p>
                )}
              </li>
            ))
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
