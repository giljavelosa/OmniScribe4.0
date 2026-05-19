'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, User as UserIcon } from 'lucide-react';
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
import {
  CLINICIAN_PICKABLE_DIVISIONS,
  professionLabel,
} from '@/lib/professions';
import { cn } from '@/lib/cn';

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
  const router = useRouter();
  const [division, setDivision] = useState<Division>(props.noteDivision);
  const [templateId, setTemplateId] = useState<string>(props.noteTemplateId ?? '');
  const [noteStyle, setNoteStyle] = useState<NoteStyle>(props.noteStyle);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Fetch templates for the current division. Re-fetches on division change so
  // the dropdown stays in sync — if the previously-selected templateId is no
  // longer in the filtered list, we clear it (the user picks again).
  useEffect(() => {
    let cancelled = false;
    setTemplateLoading(true);
    fetch(`/api/admin/templates?division=${division}`)
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
        // If the current templateId is no longer valid for this division,
        // clear it so the next save defaults to "auto-pick at draft time".
        if (templateId && !items.find((t) => t.id === templateId)) {
          setTemplateId('');
          void patch({ templateId: null });
        }
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
    // patch is stable enough for this scope; intentionally not in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [division]);

  function patch(payload: {
    division?: Division;
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
        return;
      }
      router.refresh();
    });
  }

  const typicalDivision = props.clinicianProfessionType
    ? TYPICAL_DIVISION_FOR_PROFESSION[props.clinicianProfessionType]
    : undefined;
  const showDivisionMismatchHint =
    !props.locked &&
    typicalDivision !== undefined &&
    typicalDivision !== division;

  const clinicianLabel = props.clinicianProfessionType
    ? professionLabel(props.clinicianProfessionType)
    : props.clinicianFreeTextProfession ?? 'Profession not set';

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
            <Label className="text-xs uppercase tracking-wide" htmlFor="vc-division">
              Division (this visit)
            </Label>
            <Select
              value={division}
              onValueChange={(v) => {
                const d = v as Division;
                setDivision(d);
                patch({ division: d });
              }}
              disabled={props.locked || pending}
            >
              <SelectTrigger id="vc-division">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLINICIAN_PICKABLE_DIVISIONS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {DIVISION_LABELS[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide" htmlFor="vc-template">
              Template
            </Label>
            <Select
              value={templateId || '__auto__'}
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

        {showDivisionMismatchHint && (
          <StatusBanner variant="warning">
            <span className={cn('inline-flex items-center gap-2 text-sm')}>
              <AlertCircle className="size-4" aria-hidden="true" />
              You're recording this visit as {DIVISION_LABELS[division]} but your profile is
              set to {DIVISION_LABELS[typicalDivision!]}. That's fine if you're covering
              cross-division today — just confirming.
            </span>
          </StatusBanner>
        )}

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
