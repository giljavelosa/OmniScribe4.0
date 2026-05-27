'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { AlertCircle, Check, Eye, Sparkles, X } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/cn';

type Severity = 'RED' | 'BLUE' | 'YELLOW' | 'GREEN';
type FlagStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';

type Flag = {
  id: string;
  sectionId: string;
  severity: Severity;
  status: FlagStatus;
  claim: string;
  rationale: string;
  evidence: string | null;
  suggestion: string | null;
  confidence: number;
  resolutionAction: string | null;
  resolutionNote: string | null;
};

/**
 * Sprint 0 lockdown — the `meta` envelope from GET /flags. The panel
 * uses these to render the right button state + the lockdown copy +
 * the carried-forward affordance per row.
 */
type FlagsMeta = {
  analysisState?: 'idle' | 'pending' | 'completed';
  runCount?: number;
  runsRemaining?: number;
  cap?: number;
  canReanalyze?: boolean;
  editedSinceLastAnalysis?: boolean;
  editedSectionIds?: string[];
  lastAnalysisCompletedAt?: string | null;
};

type Props = {
  noteId: string;
  sections: Array<{ id: string; label: string }>;
  /** True when note is SIGNED — analyze button hidden + actions disabled. */
  isSigned?: boolean;
};

const SEVERITY_ORDER: Severity[] = ['RED', 'BLUE', 'YELLOW'];

/**
 * FlagReviewPanel — Unit 14. Sits above the section list on /review.
 *
 * Collapsed when no OPEN flags exist; expanded when ≥1 OPEN. Three
 * severity cards (RED/BLUE/YELLOW) with OPEN counts + GREEN auto-
 * resolved count below.
 *
 * Self-fetches /api/notes/[id]/flags on mount + re-fetches after each
 * resolve/dismiss action. SSE integration would be ideal (poll on
 * FLAGS_ANALYZED) but is left to a follow-up — the explicit re-fetch
 * after the user clicks "Analyze" is enough for v1.
 */
export function FlagReviewPanel({ noteId, sections, isSigned }: Props) {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [meta, setMeta] = useState<FlagsMeta>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [analyzing, startAnalyzing] = useTransition();
  const [analyzeMessage, setAnalyzeMessage] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const labelById = useMemo(
    () => Object.fromEntries(sections.map((s) => [s.id, s.label])),
    [sections],
  );

  function load() {
    setError(null);
    startLoading(async () => {
      const res = await fetch(`/api/notes/${noteId}/flags`);
      if (!res.ok) {
        setError('Failed to load flags.');
        return;
      }
      const json = (await res.json()) as { data: Flag[]; meta?: FlagsMeta };
      setFlags(json.data);
      if (json.meta) setMeta(json.meta);
    });
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  function analyze() {
    setAnalyzeMessage(null);
    startAnalyzing(async () => {
      const res = await fetch(`/api/notes/${noteId}/analyze-flags`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { code?: string; message?: string } }
          | null;
        // Sprint 0 lockdown — surface the cap as its own message so
        // the clinician doesn't read a generic failure. The panel's
        // header will already be hiding the button after a successful
        // run #2; this catches racy double-clicks.
        if (body?.error?.code === 'analysis_cap_reached') {
          setAnalyzeMessage(
            body.error.message ??
              "You've already used both AI analysis passes on this note. Resolve the remaining flags or sign.",
          );
          // Reload to pick up the locked-state meta.
          load();
          return;
        }
        setAnalyzeMessage(body?.error?.message ?? `Analyze failed (${res.status}).`);
        return;
      }
      setAnalyzeMessage('Re-analyzing — Haiku is checking your edits for new compliance flags…');
      setIsPolling(true);
      // Poll the lifecycle state, NOT the flag count. The previous
      // implementation stopped on "count unchanged" which was a false
      // negative when analysis took longer than the 36 s budget — the
      // user saw "no flags surfaced" while the worker was still
      // computing them, then signed before flags arrived. Now we poll
      // the `meta.analysisState` field returned by /flags and stop
      // exactly when the worker has stamped `flagAnalysisCompletedAt`.
      let attempts = 0;
      const MAX_ATTEMPTS = 80; // 4 min headroom (typical run << 1 min)
      const POLL_MS = 3000;
      const tick = async () => {
        attempts += 1;
        try {
          const r = await fetch(`/api/notes/${noteId}/flags`);
          if (r.ok) {
            const json = (await r.json()) as {
              data: Flag[];
              meta?: FlagsMeta;
            };
            setFlags(json.data);
            if (json.meta) setMeta(json.meta);
            if (json.meta?.analysisState === 'completed') {
              const newOpen = json.data.filter((f) => f.status === 'OPEN').length;
              setAnalyzeMessage(
                newOpen === 0
                  ? 'Re-analysis finished — no new compliance flags surfaced.'
                  : null,
              );
              setIsPolling(false);
              return;
            }
          }
        } catch {
          // Transient fetch failure — keep polling.
        }
        if (attempts < MAX_ATTEMPTS) {
          setTimeout(tick, POLL_MS);
        } else {
          setAnalyzeMessage(
            'Analysis is taking longer than usual. Try again in a moment.',
          );
          setIsPolling(false);
        }
      };
      setTimeout(tick, POLL_MS);
    });
  }

  const grouped = useMemo(() => {
    const open = flags.filter((f) => f.status === 'OPEN');
    const greenResolved = flags.filter((f) => f.severity === 'GREEN' && f.status === 'RESOLVED');
    // Sprint 0 lockdown — surfaces the "Cleo re-found 3 things you
    // already fixed; we honored your prior decisions" copy so the
    // clinician sees that re-analyzing didn't undo their work.
    const carriedForward = flags.filter((f) => f.resolutionAction === 'CARRIED_FORWARD');
    const byOpenSev: Record<Severity, Flag[]> = { RED: [], BLUE: [], YELLOW: [], GREEN: [] };
    for (const f of open) byOpenSev[f.severity].push(f);
    return {
      byOpenSev,
      greenResolvedCount: greenResolved.length,
      carriedForwardCount: carriedForward.length,
      totalOpen: open.length,
    };
  }, [flags]);

  // Sprint 0 lockdown — derived UI state for the header + button.
  //
  //   - lockedByCap : both runs used; button hidden permanently
  //   - lockedByPending : a run is in flight; button disabled to avoid races
  //   - showLegacyAnalyze : pre-deploy note that hasn't been analyzed yet;
  //                         the inline pipeline didn't run so we let the
  //                         clinician kick off run #1 manually (one-shot
  //                         backward compat per L-9 in the spec).
  //
  // The cap is the user-facing endpoint: once it's reached, the panel
  // shifts to a "review what you've got and sign" framing.
  const runCount = meta.runCount ?? 0;
  const runsRemaining = meta.runsRemaining ?? Math.max(0, (meta.cap ?? 2) - runCount);
  const lockedByCap = !isSigned && meta.canReanalyze === false && runCount >= (meta.cap ?? 2);
  const lockedByPending = meta.analysisState === 'pending';
  const showLegacyAnalyze = !isSigned && runCount === 0 && flags.length === 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="text-md flex items-center gap-2">
            <Sparkles className="size-4" aria-hidden="true" />
            Flag review
          </CardTitle>
          <CardDescription>
            AI compliance flags grouped by severity. RED contradicts the transcript and must be
            resolved before sign; BLUE / YELLOW are clinician judgment calls.
          </CardDescription>
          {!isSigned && runCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {lockedByCap ? (
                <>
                  <span className="font-medium text-foreground">Analysis locked.</span>{' '}
                  Both AI analysis passes have been used. Resolve any remaining flags and sign.
                </>
              ) : (
                <>
                  Analyzed {runCount} of {meta.cap ?? 2} times.{' '}
                  {runsRemaining > 0
                    ? `${runsRemaining} re-analysis remaining.`
                    : 'No re-analyses remaining.'}
                </>
              )}
            </p>
          )}
        </div>
        {!isSigned && !lockedByCap && (showLegacyAnalyze || runCount > 0) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={analyze}
            disabled={analyzing || lockedByPending}
            title={
              lockedByPending
                ? 'AI is still analyzing — please wait.'
                : runsRemaining === 0
                  ? 'No re-analyses remaining.'
                  : undefined
            }
          >
            <Eye className={cn('size-3', analyzing && 'animate-pulse')} aria-hidden="true" />
            {analyzing
              ? 'Analyzing…'
              : runCount === 0
                ? 'Analyze for flags'
                : 'Re-analyze'}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <StatusBanner variant="danger">{error}</StatusBanner>}
        {analyzeMessage && (
          <StatusBanner variant="info">
            <span className={isPolling ? 'inline-flex items-center gap-2' : ''}>
              {isPolling && (
                <Sparkles className="size-4 animate-pulse" aria-hidden="true" />
              )}
              <span className={isPolling ? 'animate-pulse' : ''}>{analyzeMessage}</span>
            </span>
          </StatusBanner>
        )}

        <div className="grid grid-cols-3 gap-2">
          {SEVERITY_ORDER.map((sev) => (
            <SeverityCard
              key={sev}
              severity={sev}
              count={grouped.byOpenSev[sev].length}
            />
          ))}
        </div>

        {grouped.greenResolvedCount > 0 && (
          <p className="text-xs text-muted-foreground">
            <Check className="inline size-3 text-[var(--status-success-fg)] mr-1" aria-hidden="true" />
            {grouped.greenResolvedCount} claim{grouped.greenResolvedCount === 1 ? '' : 's'} auto-verified
            (GREEN, source matches transcript).
          </p>
        )}

        {grouped.carriedForwardCount > 0 && (
          <p className="text-xs text-muted-foreground">
            <Check className="inline size-3 text-[var(--status-success-fg)] mr-1" aria-hidden="true" />
            {grouped.carriedForwardCount} finding
            {grouped.carriedForwardCount === 1 ? '' : 's'} carried forward from your prior decisions
            — re-analysis re-surfaced these, and your previous resolutions were honored automatically.
          </p>
        )}

        {grouped.totalOpen === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            {loading
              ? 'Loading flags…'
              : flags.length === 0
                ? isSigned
                  ? 'No flags were captured on this note before signing.'
                  : 'No flags yet — tap Analyze to scan the draft against the transcript.'
                : 'No open flags — everything has been resolved or dismissed.'}
          </p>
        ) : (
          <div className="space-y-4">
            {SEVERITY_ORDER.map((sev) =>
              grouped.byOpenSev[sev].length > 0 ? (
                <SeveritySection
                  key={sev}
                  severity={sev}
                  flags={grouped.byOpenSev[sev]}
                  labelById={labelById}
                  noteId={noteId}
                  isSigned={!!isSigned}
                  isAnalyzing={analyzing}
                  onChanged={load}
                />
              ) : null,
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SeverityCard({ severity, count }: { severity: Severity; count: number }) {
  const cfg = severityVisual(severity);
  return (
    <div className={cn('rounded-md border p-3 space-y-1 transition-colors', cfg.cardClass, count === 0 && 'opacity-50')}>
      <div className="flex items-center justify-between">
        <span className={cn('text-xs uppercase tracking-wide font-medium', cfg.labelColor)}>
          {cfg.label}
        </span>
        <AlertCircle className={cn('size-3', cfg.labelColor)} aria-hidden="true" />
      </div>
      <p className="text-md font-semibold tabular-nums">{count}</p>
      <p className="text-[10px] text-muted-foreground">{cfg.hint}</p>
    </div>
  );
}

function SeveritySection({
  severity,
  flags,
  labelById,
  noteId,
  isSigned,
  isAnalyzing,
  onChanged,
}: {
  severity: Severity;
  flags: Flag[];
  labelById: Record<string, string>;
  noteId: string;
  isSigned: boolean;
  isAnalyzing: boolean;
  onChanged: () => void;
}) {
  const cfg = severityVisual(severity);
  return (
    <div className="space-y-2">
      <p className={cn('text-xs uppercase tracking-wide font-semibold', cfg.labelColor)}>
        {cfg.label} · {flags.length}
      </p>
      <ul className="space-y-2">
        {flags.map((f) => (
          <FlagRow
            key={f.id}
            flag={f}
            sectionLabel={labelById[f.sectionId] ?? f.sectionId}
            noteId={noteId}
            isSigned={isSigned}
            isAnalyzing={isAnalyzing}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </div>
  );
}

function FlagRow({
  flag,
  sectionLabel,
  noteId,
  isSigned,
  isAnalyzing,
  onChanged,
}: {
  flag: Flag;
  sectionLabel: string;
  noteId: string;
  isSigned: boolean;
  isAnalyzing: boolean;
  onChanged: () => void;
}) {
  const [dismissing, setDismissing] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function patch(payload: { status: 'RESOLVED' | 'DISMISSED'; resolutionAction: string; resolutionNote?: string }) {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/notes/${noteId}/flags/${flag.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 404) {
        // Concurrent re-analyze deleted this OPEN flag row and created a fresh
        // one. Refetch + tell the clinician to re-confirm against the new flag.
        setError('This flag was replaced by a re-analysis. Refreshing list — re-confirm on the new flag.');
        setDismissing(false);
        setNote('');
        onChanged();
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Update failed (${res.status}).`);
        return;
      }
      setDismissing(false);
      setNote('');
      onChanged();
    });
  }

  const actionsDisabled = pending || isAnalyzing;

  const cfg = severityVisual(flag.severity);
  const carriedForward = flag.resolutionAction === 'CARRIED_FORWARD';

  return (
    <li className={cn('rounded-md border p-3 space-y-2', cfg.rowClass)}>
      <div className="flex items-start gap-2">
        <AlertCircle className={cn('size-4 mt-0.5 shrink-0', cfg.labelColor)} aria-hidden="true" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <StatusBadge variant="neutral" noIcon>{sectionLabel}</StatusBadge>
            <span className="text-muted-foreground">
              {Math.round(flag.confidence * 100)}% confidence
            </span>
            {carriedForward && (
              <StatusBadge variant="success" noIcon>
                Carried forward from prior analysis
              </StatusBadge>
            )}
          </div>
          <p className="text-sm font-medium">&ldquo;{flag.claim}&rdquo;</p>
          <p className="text-xs text-muted-foreground">{flag.rationale}</p>
          {flag.evidence && (
            <p className="text-xs text-muted-foreground border-l-2 border-border pl-2 italic">
              Transcript: &ldquo;{flag.evidence}&rdquo;
            </p>
          )}
          {flag.suggestion && (
            <p className="text-xs text-[var(--status-success-fg)] border-l-2 border-[var(--status-success-border)] pl-2">
              Suggested: {flag.suggestion}
            </p>
          )}
          {carriedForward && flag.resolutionNote && (
            <p className="text-xs text-muted-foreground border-l-2 border-[var(--status-success-border)] pl-2">
              {flag.resolutionNote}
            </p>
          )}
        </div>
      </div>

      {dismissing ? (
        <div className="space-y-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            rows={2}
            maxLength={500}
            placeholder="Optional note explaining the dismissal."
            disabled={actionsDisabled}
            autoFocus
          />
          {error && <p className="text-xs text-[var(--status-danger-fg)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => { setDismissing(false); setNote(''); }} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => patch({ status: 'DISMISSED', resolutionAction: 'DISMISS_KEEP', resolutionNote: note.trim() || undefined })}
              disabled={actionsDisabled}
            >
              {pending ? 'Saving…' : isAnalyzing ? 'Re-analyzing…' : 'Confirm dismiss'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {!isSigned && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => patch({ status: 'RESOLVED', resolutionAction: 'ACCEPT_EDIT' })}
                disabled={actionsDisabled}
                title={isAnalyzing ? 'Re-analysis in progress — actions disabled until it finishes' : undefined}
                className="gap-1"
              >
                <Check className="size-3" aria-hidden="true" />
                Accept edit
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDismissing(true)}
                disabled={actionsDisabled}
                title={isAnalyzing ? 'Re-analysis in progress — actions disabled until it finishes' : undefined}
                className="gap-1"
              >
                <X className="size-3" aria-hidden="true" />
                Dismiss (keep as-is)
              </Button>
            </>
          )}
          {error && (
            <span className="text-xs text-[var(--status-danger-fg)] self-center">{error}</span>
          )}
        </div>
      )}
    </li>
  );
}

function severityVisual(severity: Severity): {
  label: string;
  hint: string;
  cardClass: string;
  rowClass: string;
  labelColor: string;
} {
  switch (severity) {
    case 'RED':
      return {
        label: 'Contradicts transcript',
        hint: 'Must resolve before sign',
        cardClass: 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)]/30',
        rowClass: 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)]/20',
        labelColor: 'text-[var(--status-danger-fg)]',
      };
    case 'BLUE':
      return {
        label: 'Added specifics',
        hint: 'Confirm details',
        cardClass: 'border-[var(--status-info-border)] bg-[var(--status-info-bg)]/30',
        rowClass: 'border-[var(--status-info-border)] bg-[var(--status-info-bg)]/20',
        labelColor: 'text-[var(--status-info-fg)]',
      };
    case 'YELLOW':
      return {
        label: 'Inferred',
        hint: 'Confirm or rephrase',
        cardClass: 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]/30',
        rowClass: 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]/20',
        labelColor: 'text-[var(--status-warning-fg)]',
      };
    case 'GREEN':
      return {
        label: 'Verified',
        hint: 'Auto-resolved',
        cardClass: 'border-[var(--status-success-border)] bg-[var(--status-success-bg)]/30',
        rowClass: 'border-[var(--status-success-border)] bg-[var(--status-success-bg)]/20',
        labelColor: 'text-[var(--status-success-fg)]',
      };
  }
}
