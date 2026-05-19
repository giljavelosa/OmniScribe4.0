'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export type VisitHistoryRow = {
  id: string;
  signedAt: string | null;
  templateName: string | null;
  division: string;
  assessmentSnippet: string | null;
  /** Late-entry charting (spec: context/specs/late-entry-charting.md). */
  isLateEntry?: boolean;
  lateEntryDaysGap?: number | null;
  /** ISO date string — the day care was delivered. Defaults to signedAt on
   *  normal visits; for late entries this is the backdated day. */
  dateOfService?: string;
  /** Clinician identity for grouping/display. Null only if the clinician
   *  row has been deactivated (extremely rare on a signed note). */
  clinicianId: string | null;
  clinicianName: string;
  clinicianProfessionLabel: string | null;
  /** Episode of care if this visit belongs to one. Ad-hoc visits leave it null. */
  episodeId: string | null;
  episodeDiagnosis: string | null;
  episodeDivision: string | null;
  episodeStatus: string | null;
};

type ViewMode = 'episode' | 'clinician' | 'division' | 'chronological';

const STORAGE_KEY = 'omniscribe.visit-history.view-mode';
const DIVISION_LABELS: Record<string, string> = {
  MEDICAL: 'Medical',
  REHAB: 'Rehab',
  BEHAVIORAL_HEALTH: 'Behavioral Health',
  MULTI: 'Multi',
};

const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: 'episode', label: 'By episode' },
  { value: 'clinician', label: 'By clinician' },
  { value: 'division', label: 'By division' },
  { value: 'chronological', label: 'Chronological' },
];

/**
 * VisitHistoryList — patient chart visit history with a 4-mode view
 * switcher (by episode / by clinician / by division / chronological).
 *
 * - Each visit has one division (Note.division, locked at recording
 *   start). Per-division counts surface on the patient header strip
 *   above; in this list we just show a chip per row.
 * - The active view mode is persisted to localStorage so each clinician
 *   gets their preferred default lens on revisit.
 * - The division filter is layered on top of any view mode — pick
 *   "Rehab" and only Rehab visits show, still grouped by the chosen axis.
 * - Late-entry rows render a yellow `LATE ENTRY · Nd` chip next to the
 *   date and surface dateOfService as the primary date (not signedAt) —
 *   the chart history answers "when was the patient seen?" not "when was
 *   the doc done?".
 */
export function VisitHistoryList({ visits }: { visits: VisitHistoryRow[] }) {
  const [view, setView] = useState<ViewMode>('episode');
  const [divisionFilter, setDivisionFilter] = useState<string | null>(null);

  // Restore the user's saved preference. Initial server render uses the
  // default ('episode') so SSR + first client render match — only after
  // mount do we read localStorage and apply the override. React's
  // set-state-in-effect rule flags this; the alternative (deferred init via
  // microtask) leaves a visible flash of the default view before the saved
  // one applies, which is worse UX than the one extra render here.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) as ViewMode | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved && VIEW_MODES.find((m) => m.value === saved)) setView(saved);
    } catch {
      // localStorage unavailable (SSR, privacy mode) — keep default.
    }
  }, []);

  function changeView(next: ViewMode) {
    setView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }

  const filtered = useMemo(
    () =>
      divisionFilter
        ? visits.filter((v) => v.division === divisionFilter)
        : visits,
    [visits, divisionFilter],
  );

  const divisionsPresent = useMemo(() => {
    const set = new Set<string>();
    for (const v of visits) set.add(v.division);
    return Array.from(set);
  }, [visits]);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-md">Visit history</CardTitle>
            <CardDescription>
              {visits.length} signed visit{visits.length === 1 ? '' : 's'}. Tap any row to
              open the signed note.
            </CardDescription>
          </div>
          <div className="flex gap-1 flex-wrap" role="tablist" aria-label="Visit history view">
            {VIEW_MODES.map((m) => (
              <Button
                key={m.value}
                type="button"
                variant={view === m.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => changeView(m.value)}
                aria-pressed={view === m.value}
              >
                {m.label}
              </Button>
            ))}
          </div>
        </div>
        {divisionsPresent.length > 1 && (
          <div className="flex gap-1 flex-wrap">
            <Button
              type="button"
              variant={divisionFilter === null ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDivisionFilter(null)}
            >
              All
            </Button>
            {divisionsPresent.map((d) => (
              <Button
                key={d}
                type="button"
                variant={divisionFilter === d ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDivisionFilter(divisionFilter === d ? null : d)}
              >
                {DIVISION_LABELS[d] ?? d}
              </Button>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-0 p-0">
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {visits.length === 0
              ? 'No signed visits yet.'
              : 'No visits match the current filter.'}
          </p>
        ) : view === 'chronological' ? (
          <FlatList visits={filtered} />
        ) : view === 'episode' ? (
          <EpisodeGrouped visits={filtered} />
        ) : view === 'clinician' ? (
          <ClinicianGrouped visits={filtered} />
        ) : (
          <DivisionGrouped visits={filtered} />
        )}
      </CardContent>
    </Card>
  );
}

function FlatList({ visits }: { visits: VisitHistoryRow[] }) {
  return (
    <ul className="divide-y divide-border">
      {visits.map((v) => (
        <VisitRow key={v.id} v={v} />
      ))}
    </ul>
  );
}

function EpisodeGrouped({ visits }: { visits: VisitHistoryRow[] }) {
  const groups = useMemo(() => {
    const byEpisode = new Map<string, VisitHistoryRow[]>();
    for (const v of visits) {
      const key = v.episodeId ?? '__adhoc__';
      const list = byEpisode.get(key) ?? [];
      list.push(v);
      byEpisode.set(key, list);
    }
    return Array.from(byEpisode.entries()).map(([key, list]) => ({
      key,
      header:
        key === '__adhoc__'
          ? { label: 'Ad-hoc visits', division: null, status: null }
          : {
              label: list[0]!.episodeDiagnosis ?? '(unnamed episode)',
              division: list[0]!.episodeDivision,
              status: list[0]!.episodeStatus,
            },
      visits: list,
    }));
  }, [visits]);

  return (
    <div className="divide-y divide-border">
      {groups.map((g) => (
        <div key={g.key}>
          <div className="px-4 py-2 bg-muted/30 flex items-center gap-2 flex-wrap text-sm">
            <span className="font-medium">{g.header.label}</span>
            {g.header.division && (
              <StatusBadge variant="neutral" noIcon>
                {DIVISION_LABELS[g.header.division] ?? g.header.division}
              </StatusBadge>
            )}
            {g.header.status && (
              <StatusBadge variant="neutral" noIcon>{g.header.status}</StatusBadge>
            )}
            <span className="text-xs text-muted-foreground">
              · {g.visits.length} visit{g.visits.length === 1 ? '' : 's'}
            </span>
          </div>
          <ul className="divide-y divide-border">
            {g.visits.map((v) => (
              <VisitRow key={v.id} v={v} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ClinicianGrouped({ visits }: { visits: VisitHistoryRow[] }) {
  const groups = useMemo(() => {
    const byClinician = new Map<string, VisitHistoryRow[]>();
    for (const v of visits) {
      const key = v.clinicianId ?? '__unknown__';
      const list = byClinician.get(key) ?? [];
      list.push(v);
      byClinician.set(key, list);
    }
    return Array.from(byClinician.entries()).map(([key, list]) => ({
      key,
      name: list[0]!.clinicianName,
      profession: list[0]!.clinicianProfessionLabel,
      visits: list,
    }));
  }, [visits]);

  return (
    <div className="divide-y divide-border">
      {groups.map((g) => (
        <div key={g.key}>
          <div className="px-4 py-2 bg-muted/30 flex items-center gap-2 flex-wrap text-sm">
            <span className="font-medium">{g.name}</span>
            {g.profession && (
              <span className="text-xs text-muted-foreground">· {g.profession}</span>
            )}
            <span className="text-xs text-muted-foreground">
              · {g.visits.length} visit{g.visits.length === 1 ? '' : 's'} with this patient
            </span>
          </div>
          <ul className="divide-y divide-border">
            {g.visits.map((v) => (
              <VisitRow key={v.id} v={v} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function DivisionGrouped({ visits }: { visits: VisitHistoryRow[] }) {
  const groups = useMemo(() => {
    const byDiv = new Map<string, VisitHistoryRow[]>();
    for (const v of visits) {
      const list = byDiv.get(v.division) ?? [];
      list.push(v);
      byDiv.set(v.division, list);
    }
    // Stable display order: MEDICAL → REHAB → BEHAVIORAL_HEALTH → MULTI → other.
    const order = ['MEDICAL', 'REHAB', 'BEHAVIORAL_HEALTH', 'MULTI'];
    return Array.from(byDiv.entries()).sort(
      ([a], [b]) => order.indexOf(a) - order.indexOf(b),
    );
  }, [visits]);

  return (
    <div className="divide-y divide-border">
      {groups.map(([division, list]) => (
        <div key={division}>
          <div className="px-4 py-2 bg-muted/30 flex items-center gap-2 flex-wrap text-sm">
            <span className="font-medium">{DIVISION_LABELS[division] ?? division}</span>
            <span className="text-xs text-muted-foreground">
              · {list.length} visit{list.length === 1 ? '' : 's'}
            </span>
          </div>
          <ul className="divide-y divide-border">
            {list.map((v) => (
              <VisitRow key={v.id} v={v} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function VisitRow({ v }: { v: VisitHistoryRow }) {
  return (
    <li>
      <Link
        href={`/review/${v.id}`}
        className={cn(
          'flex flex-col gap-1 px-4 py-3 hover:bg-muted/30 transition-colors',
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <p className="font-medium">
              {(() => {
                // Late entries surface dateOfService (the day care was
                // delivered) since that's the clinical anchor; signedAt is
                // implicit from the "Nd late" chip below.
                const primary = v.isLateEntry ? v.dateOfService ?? v.signedAt : v.signedAt;
                return primary
                  ? new Date(primary).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })
                  : 'unsigned';
              })()}
            </p>
            <StatusBadge variant="neutral" noIcon>
              {DIVISION_LABELS[v.division] ?? v.division}
            </StatusBadge>
            {v.isLateEntry && (
              <StatusBadge variant="warning" noIcon>
                {`LATE ENTRY · ${v.lateEntryDaysGap ?? 0}d`}
              </StatusBadge>
            )}
            <span className="text-xs text-muted-foreground">
              · {v.clinicianName}
              {v.clinicianProfessionLabel ? ` (${v.clinicianProfessionLabel})` : ''}
            </span>
            {v.templateName && (
              <span className="text-xs text-muted-foreground truncate">
                · {v.templateName}
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground shrink-0">open ↗</span>
        </div>
        {v.assessmentSnippet && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {v.assessmentSnippet}
          </p>
        )}
      </Link>
    </li>
  );
}
