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
  noteDivision: Division;
  noteTemplateId: string | null;
  noteStyle: NoteStyle;
  /** Locked once recording has started — strip becomes read-only. */
  locked: boolean;
};

const DIVISION_LABELS: Record<Division, string> = {
  [Division.MEDICAL]: 'Medical',
  [Division.REHAB]: 'Rehab (PT / OT / SLP)',
  [Division.BEHAVIORAL_HEALTH]: 'Behavioral Health',
  [Division.MULTI]: 'Multi (org-wide)',
};

const NOTE_STYLE_LABELS: Record<NoteStyle, string> = {
  [NoteStyle.NARRATIVE]: 'Narrative',
  [NoteStyle.HYBRID]: 'Hybrid',
  [NoteStyle.HYBRID_BULLET]: 'Hybrid (bullets)',
  [NoteStyle.STRUCTURED]: 'Structured',
};

/** Loose mapping profession → typical division. Used only for the
 *  "⚠ This visit is set to X but your profile is Y" hint. The clinician
 *  can ignore it; this is informational, not blocking. */
const TYPICAL_DIVISION_FOR_PROFESSION: Partial<Record<Profession, Division>> = {
  MD: Division.MEDICAL,
  DO: Division.MEDICAL,
  NP: Division.MEDICAL,
  PA: Division.MEDICAL,
  RN: Division.MEDICAL,
  OT: Division.REHAB,
  PT: Division.REHAB,
  SLP: Division.REHAB,
  LCSW: Division.BEHAVIORAL_HEALTH,
  LMFT: Division.BEHAVIORAL_HEALTH,
  LPC: Division.BEHAVIORAL_HEALTH,
  PSYCHOLOGIST: Division.BEHAVIORAL_HEALTH,
};

export function VisitContextStrip(props: Props) {
  // Profession-derived division is authoritative when the clinician has a
  // categorical profession set — division is NOT user-changeable for that
  // visit. Templates filter to that division only. Admins/users without a
  // professionType fall back to the note's stored division (which still
  // can't go cross-division mid-visit; this code only renders it read-only).
  const professionDivision = props.clinicianProfessionType
    ? TYPICAL_DIVISION_FOR_PROFESSION[props.clinicianProfessionType]
    : undefined;
  const lockedDivision = professionDivision ?? props.noteDivision;

  const [templateId, setTemplateId] = useState<string>(props.noteTemplateId ?? '');
  const [noteStyle, setNoteStyle] = useState<NoteStyle>(props.noteStyle);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Fetch templates for the locked division. PURE READ — no side-effect
  // writes here. If the saved templateId isn't in the filtered list the
  // dropdown falls back to the "Auto-pick at draft" sentinel visually
  // (see effectiveTemplateValue below); the server value stays as-is
  // until the user explicitly picks a new one.
  useEffect(() => {
    let cancelled = false;
    // Set loading true synchronously so the dropdown reads "Loading…" while we
    // re-fetch on division change. React's set-state-in-effect rule flags this,
    // but the deferred-microtask alternative leaves a visible flash of stale
    // template names from the prior division.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTemplateLoading(true);
    fetch(`/api/admin/templates?division=${lockedDivision}`)
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
  }, [lockedDivision]);

  function patch(payload: {
    templateId?: string | null;
    noteStyle?: NoteStyle;
  }) {
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
      // Intentionally no router.refresh() here — the server PATCH persists,
      // and the next navigation away from /prepare will load fresh values.
      // Refreshing while the user is mid-interaction risks an unmount race
      // (causes "removeChild" reconciliation errors on Radix portals).
    });
  }

  const clinicianLabel = props.clinicianProfessionType
    ? professionLabel(props.clinicianProfessionType)
    : props.clinicianFreeTextProfession ?? 'Profession not set';

  // If the saved templateId no longer matches the locked division, show
  // "Auto-pick at draft" without rewriting state. The actual save happens
  // only when the user explicitly picks something.
  const templateInCurrentList = !templateId || templates.some((t) => t.id === templateId);
  const effectiveTemplateValue = templateInCurrentList && templateId ? templateId : '__auto__';

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <div className="flex items-center gap-2 text-sm">
          <UserIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">
            Recording as {props.clinicianName || props.clinicianEmail}
          </span>
          <span className="text-muted-foreground">· {clinicianLabel}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide">Division</Label>
            <div className="flex items-center h-9 px-3 rounded-md border border-border bg-muted text-sm font-medium">
              {DIVISION_LABELS[lockedDivision]}
            </div>
            <p className="text-[10px] text-muted-foreground">
              {professionDivision
                ? 'Set by your profession — locked.'
                : 'Set on the note. Change requires a clinician with a different profession.'}
            </p>
          </div>

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
            Locked — visit context is fixed once recording starts.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
