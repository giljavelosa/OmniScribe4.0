'use client';

import { useEffect, useState, useTransition } from 'react';
import { User as UserIcon } from 'lucide-react';
import { Division, NoteStyle, type Profession } from '@prisma/client';

import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import { professionLabel } from '@/lib/professions';

type TemplateOption = {
  id: string;
  name: string;
  division: Division;
  isPreset: boolean;
};

type Props = {
  noteId: string;
  clinicianName: string;
  clinicianEmail: string;
  clinicianProfessionType: Profession | null;
  clinicianFreeTextProfession: string | null;
  /** Locked at recording start. Derived server-side from the clinician's
   *  profession via PROFESSION_TO_DIVISION; this component renders it but
   *  never offers it as an editable choice. */
  noteDivision: Division;
  noteTemplateId: string | null;
  noteStyle: NoteStyle;
  /** Locked once recording has started — template/format become read-only. */
  locked: boolean;
};

const DIVISION_LABELS: Record<Division, string> = {
  [Division.MEDICAL]: 'Medical',
  [Division.REHAB]: 'Rehab',
  [Division.BEHAVIORAL_HEALTH]: 'Behavioral Health',
  [Division.MULTI]: 'Multi',
};

const NOTE_STYLE_LABELS: Record<NoteStyle, string> = {
  [NoteStyle.NARRATIVE]: 'Narrative',
  [NoteStyle.HYBRID]: 'Hybrid',
  [NoteStyle.HYBRID_BULLET]: 'Hybrid (bullets)',
  [NoteStyle.STRUCTURED]: 'Structured',
};

export function VisitContextStrip(props: Props) {
  const [templateId, setTemplateId] = useState<string>(props.noteTemplateId ?? '');
  const [noteStyle, setNoteStyle] = useState<NoteStyle>(props.noteStyle);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Fetch templates for the locked division. PURE READ — no side effects.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTemplateLoading(true);
    fetch(`/api/admin/templates?division=${props.noteDivision}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((j) => {
        if (cancelled) return;
        const items: TemplateOption[] = (j?.data ?? []).map((t: TemplateOption) => ({
          id: t.id,
          name: t.name,
          division: t.division,
          isPreset: t.isPreset,
        }));
        setTemplates(items);
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      })
      .finally(() => {
        if (!cancelled) setTemplateLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.noteDivision]);

  function patch(payload: { templateId?: string | null; noteStyle?: NoteStyle }) {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/notes/${props.noteId}/visit-context`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Couldn't save (${res.status}).`);
      }
    });
  }

  const clinicianLabel = props.clinicianProfessionType
    ? professionLabel(props.clinicianProfessionType)
    : props.clinicianFreeTextProfession ?? 'Profession not set';

  const templateInCurrentList = !templateId || templates.some((t) => t.id === templateId);
  const effectiveTemplateValue = templateInCurrentList && templateId ? templateId : '__auto__';

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <UserIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">
            Recording as {props.clinicianName || props.clinicianEmail}
          </span>
          <span className="text-muted-foreground">· {clinicianLabel}</span>
          <span className="text-muted-foreground">→</span>
          <StatusBadge variant="neutral" noIcon>
            {DIVISION_LABELS[props.noteDivision]} note
          </StatusBadge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide" htmlFor="vc-template">
              Template
            </Label>
            <Select
              value={effectiveTemplateValue}
              onValueChange={(v) => {
                const next = v === '__auto__' ? null : v;
                setTemplateId(next ?? '');
                patch({ templateId: next });
              }}
              disabled={props.locked || pending || templateLoading}
            >
              <SelectTrigger id="vc-template">
                <SelectValue
                  placeholder={templateLoading ? 'Loading…' : 'Auto-pick at draft'}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto__">Auto-pick at draft</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                    {t.isPreset ? ' (preset)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide" htmlFor="vc-style">
              Format
            </Label>
            <Select
              value={noteStyle}
              onValueChange={(v) => {
                const s = v as NoteStyle;
                setNoteStyle(s);
                patch({ noteStyle: s });
              }}
              disabled={props.locked || pending}
            >
              <SelectTrigger id="vc-style">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(NOTE_STYLE_LABELS) as NoteStyle[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {NOTE_STYLE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && <StatusBanner variant="danger">{error}</StatusBanner>}

        {props.locked && (
          <p className="text-xs text-muted-foreground">
            Locked — template + format are fixed once recording starts.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
