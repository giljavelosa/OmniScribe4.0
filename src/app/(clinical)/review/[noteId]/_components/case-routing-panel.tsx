'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { BadgeCheck, Sparkles, Pencil, CheckCircle2 } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import { COPILOT_DISPLAY_NAME } from '@/services/copilot/persona';
import { CaseFhirDriftBanner } from '@/app/(clinical)/patients/[id]/_components/case-fhir-drift-banner';
import { WriteBackConfirmDialog } from '@/components/fhir/writeback-confirm-dialog';

/**
 * Sprint 0.17 — write-back proposal summary surfaced by the accept
 * endpoint when (and only when) a `FhirWriteBackProposal` row was
 * inserted in the tx. The inline "Write to EHR?" section renders only
 * when this is non-null; non-eligible / writeback-off paths see
 * identical Sprint-0.16 behavior.
 */
export type WriteBackProposalInline = {
  id: string;
  caseManagementId: string;
  operation: 'CREATE' | 'PATCH';
  summary: string;
};

/**
 * Sprint 0.13 — Miss Cleo's case-routing panel.
 *
 * Mounted at the top of /review/[noteId] (above the section accordions).
 * Renders the CaseRouterRun's structured proposal with confidence-gated UI
 * weight, lets the clinician confirm (1 tap) or override.
 *
 * Loading strategy:
 *   - Server-rendered with `initial` when the worker fired before the
 *     review page loaded (the common case once AI-generation drains).
 *   - When the worker hasn't fired yet, this component polls the GET
 *     endpoint every 5 s for up to 60 s, then falls through to the manual
 *     picker fallback.
 *
 * Confidence rubric drives affordances (decision 5):
 *   - HIGH: pre-select recommended action; "Confirm" is the loud CTA.
 *   - MEDIUM: pre-select + "Why" expanded by default.
 *   - LOW: nothing pre-selected; alternatives presented as peers.
 */

type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type CaseRouterRunDTO = {
  id: string;
  confidence: Confidence;
  reasoning: string;
  modelVersion: string;
  createdAt: string;
  acceptedAction: string | null;
  acceptedAt: string | null;
  proposalJson: ProposalDTO;
};

export type ProposalDTO = {
  action:
    | 'attach'
    | 'attach-with-secondary'
    | 'open-new'
    | 'open-new-from-condition'
    | 'reconcile';
  caseManagementId?: string;
  newCase?: {
    primaryIcd: string | null;
    primaryIcdLabel: string;
    secondaryIcd?: string;
    secondaryIcdLabel?: string;
  };
  /** Sprint 0.15 — populated only for `open-new-from-condition`. */
  newCaseFromCondition?: {
    fhirConditionId: string;
    primaryIcd: string;
    primaryIcdLabel: string;
    recordedDate: string;
    recorderName: string | null;
  };
  secondaryIcdAddition?: { icd: string; icdLabel: string };
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  alternatives: Array<{
    action: 'attach' | 'open-new' | 'open-new-from-condition';
    caseManagementId?: string;
    newCase?: { primaryIcd: string | null; primaryIcdLabel: string };
    newCaseFromCondition?: {
      fhirConditionId: string;
      primaryIcd: string;
      primaryIcdLabel: string;
      recordedDate: string;
      recorderName: string | null;
    };
    reasoning: string;
  }>;
  /** Sprint 0.15 — every Condition the agent considered. Carried for
   *  audit / provenance display; the panel itself reads the pill data
   *  from the action's `newCaseFromCondition` payload. */
  fhirCitations?: Array<{
    resourceType: 'Condition';
    fhirId: string;
    lastUpdated: string;
    recorder: string | null;
    recordedDate: string;
  }>;
  /** Sprint 0.16 — populated only when `action === 'reconcile'`. The
   *  amber drift banner + resolution radios render from this. */
  reconcileProposal?: ReconcileProposalDTO;
};

export type ReconcileResolutionOptionKind =
  | 'reopen-case'
  | 'open-new-case'
  | 'close-case'
  | 'attach-as-is'
  | 'update-case-icd';

export type ReconcileProposalDTO = {
  driftLogId: string;
  caseManagementId: string;
  fhirConditionId: string;
  driftKind: 'STATUS' | 'ICD';
  summary: string;
  resolutionOptions: Array<{
    kind: ReconcileResolutionOptionKind;
    label: string;
    reasoning: string;
  }>;
  recommendedOptionIndex?: number;
};

export type CaseRouterPanelCase = {
  id: string;
  primaryIcd: string | null;
  primaryIcdLabel: string;
  secondaryIcd: string | null;
  secondaryIcdLabel: string | null;
};

type Props = {
  noteId: string;
  /** Server-rendered initial state — null when the worker hasn't completed
   *  by the time /review server-renders. */
  initial: CaseRouterRunDTO | null;
  /** Open cases (ACTIVE only) for the "Change manually" picker. Server-
   *  fetched; refreshed on the GET refetch loop. */
  initialActiveCases: CaseRouterPanelCase[];
  /** Currently bound case id on the encounter — drives the "your active
   *  case" pill text and lets the panel detect "no-op accept". */
  initialCurrentCaseId: string | null;
};

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 60_000;

export function CaseRoutingPanel({ noteId, initial, initialActiveCases, initialCurrentCaseId }: Props) {
  const [run, setRun] = useState<CaseRouterRunDTO | null>(initial);
  const [activeCases, setActiveCases] = useState<CaseRouterPanelCase[]>(initialActiveCases);
  const [currentCaseId, setCurrentCaseId] = useState<string | null>(initialCurrentCaseId);
  const [pollExhausted, setPollExhausted] = useState(false);
  // Sprint 0.17 — captured from the accept response when a write-back
  // proposal was inserted in the tx. Drives the inline "Write to EHR?"
  // section beneath the AcceptedPill. Cleared when the clinician hits
  // "Not now" (we don't auto-cancel server-side; the proposal stays
  // PROPOSED until manually approved or cancelled).
  const [writeBackProposal, setWriteBackProposal] = useState<WriteBackProposalInline | null>(null);
  // Once the clinician taps "Yes, write to EHR" + Confirms in the
  // dialog, the section transitions to a "queued" badge.
  const [writeBackApproved, setWriteBackApproved] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/notes/${noteId}/case-router`);
    if (!res.ok) return;
    const body = await res.json();
    if (body?.data?.run) setRun(body.data.run as CaseRouterRunDTO);
    if (Array.isArray(body?.data?.activeCases)) {
      setActiveCases(body.data.activeCases as CaseRouterPanelCase[]);
    }
    if (typeof body?.data?.currentCaseManagementId === 'string') {
      setCurrentCaseId(body.data.currentCaseManagementId);
    } else if (body?.data?.currentCaseManagementId === null) {
      setCurrentCaseId(null);
    }
  }, [noteId]);

  // Poll for the run when it's not yet present. Bounded total duration so
  // the UI never spins forever — falls through to the manual fallback.
  useEffect(() => {
    if (run) return;
    let cancelled = false;
    const start = Date.now();
    const tick = async () => {
      if (cancelled) return;
      await refetch();
      if (cancelled) return;
      if (Date.now() - start >= POLL_TIMEOUT_MS) {
        setPollExhausted(true);
        return;
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    };
    setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
    };
  }, [run, refetch]);

  const onAcceptResolved = useCallback(
    (writeBack: WriteBackProposalInline | null) => {
      if (writeBack) setWriteBackProposal(writeBack);
      void refetch();
    },
    [refetch],
  );

  if (run?.acceptedAction) {
    return (
      <div className="space-y-3">
        <AcceptedPill run={run} activeCases={activeCases} currentCaseId={currentCaseId} />
        {writeBackProposal && (
          <WriteBackInlineSection
            proposal={writeBackProposal}
            approved={writeBackApproved}
            onApproved={() => setWriteBackApproved(true)}
            onNotNow={() => setWriteBackProposal(null)}
          />
        )}
      </div>
    );
  }

  if (!run) {
    if (pollExhausted) {
      return (
        <ManualFallbackPanel
          noteId={noteId}
          activeCases={activeCases}
          onResolved={refetch}
        />
      );
    }
    return <PendingPanel />;
  }

  // Sprint 0.16 — reconcile gets its own surface (amber banner +
  // resolution radios). Dispatch at the parent level so each card
  // component's hooks run unconditionally (react-hooks rules).
  if (run.proposalJson.action === 'reconcile' && run.proposalJson.reconcileProposal) {
    return (
      <ReconcileCard
        noteId={noteId}
        run={run}
        reconcileProposal={run.proposalJson.reconcileProposal}
        onResolved={onAcceptResolved}
      />
    );
  }

  return (
    <ProposalCard
      noteId={noteId}
      run={run}
      activeCases={activeCases}
      currentCaseId={currentCaseId}
      onResolved={onAcceptResolved}
    />
  );
}

// =============================================================================
// Sub-views.
// =============================================================================

function PanelChrome({ children }: { children: React.ReactNode }) {
  return (
    <Card className="border-primary/40 bg-primary/[0.02]">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" aria-hidden />
          {COPILOT_DISPLAY_NAME}&apos;s case routing
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function PendingPanel() {
  return (
    <PanelChrome>
      <p className="text-sm text-muted-foreground">
        {COPILOT_DISPLAY_NAME} is reviewing this visit…
      </p>
    </PanelChrome>
  );
}

function ManualFallbackPanel({
  noteId,
  activeCases,
  onResolved,
}: {
  noteId: string;
  activeCases: CaseRouterPanelCase[];
  onResolved: () => void;
}) {
  return (
    <PanelChrome>
      <StatusBanner variant="warning">
        Auto-route unavailable — pick a case manually.
      </StatusBanner>
      <ManualPicker noteId={noteId} activeCases={activeCases} onResolved={onResolved} />
    </PanelChrome>
  );
}

function AcceptedPill({
  run,
  activeCases,
  currentCaseId,
}: {
  run: CaseRouterRunDTO;
  activeCases: CaseRouterPanelCase[];
  currentCaseId: string | null;
}) {
  const summary = describeAccepted(run, activeCases, currentCaseId);
  return (
    <div className="flex items-center gap-2 rounded-md border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-3 py-2 text-sm text-[var(--status-success-fg)]">
      <CheckCircle2 className="size-3.5" aria-hidden />
      <span>
        <Sparkles className="size-3.5 inline-block mr-1 align-text-bottom" aria-hidden />
        {COPILOT_DISPLAY_NAME}&apos;s routing accepted: {summary}
      </span>
    </div>
  );
}

/**
 * Sprint 0.17 — inline "Write to EHR?" section rendered alongside the
 * AcceptedPill after a write-back-eligible action. Three states:
 *
 *   - Not approved yet → "Yes, write to EHR" / "Not now" pair.
 *     Clicking Yes opens the `<AlertDialog>`; the dialog POSTs to
 *     `/api/cases/{caseId}/writeback/approve` and on success calls
 *     `onApproved()` to flip this section to the "queued" state.
 *   - Approved → small "EHR write queued" status badge.
 *
 * Rule 22 / 24: the confirmation lives in an `<AlertDialog>` (NOT a
 * native confirm), and the write-back is gated by an explicit
 * clinician click at every step.
 */
function WriteBackInlineSection({
  proposal,
  approved,
  onApproved,
  onNotNow,
}: {
  proposal: WriteBackProposalInline;
  approved: boolean;
  onApproved: () => void;
  onNotNow: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);

  if (approved) {
    return (
      <StatusBadge variant="info" noIcon>
        EHR write queued
      </StatusBadge>
    );
  }

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
      <p className="text-sm">
        {COPILOT_DISPLAY_NAME} can also write this back to your EHR.
      </p>
      <p className="text-xs text-muted-foreground">{proposal.summary}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => setDialogOpen(true)}
          aria-label="Open write-back confirmation"
        >
          Yes, write to EHR
        </Button>
        <Button size="sm" variant="ghost" onClick={onNotNow}>
          Not now
        </Button>
      </div>
      <WriteBackConfirmDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        caseId={proposal.caseManagementId}
        proposalId={proposal.id}
        operation={proposal.operation}
        summary={proposal.summary}
        onConfirmed={onApproved}
      />
    </div>
  );
}

function ProposalCard({
  noteId,
  run,
  activeCases,
  currentCaseId,
  onResolved,
}: {
  noteId: string;
  run: CaseRouterRunDTO;
  activeCases: CaseRouterPanelCase[];
  currentCaseId: string | null;
  /** Sprint 0.17 — receives the optional write-back proposal that the
   *  accept endpoint returns when a row was inserted in the tx. */
  onResolved: (writeBackProposal: WriteBackProposalInline | null) => void;
}) {
  // Sprint 0.16 note: when proposal.action === 'reconcile', the
  // parent (`CaseRoutingPanel`) dispatches to `ReconcileCard` BEFORE
  // this component renders. This guarantees that the hooks below run
  // unconditionally (react-hooks rules), and the standard
  // attach/open-new code path stays free of reconcile branches.
  const proposal = run.proposalJson;
  const isHigh = run.confidence === 'HIGH';
  const isLow = run.confidence === 'LOW';

  // Build the choice list. The proposal's primary action is option 0;
  // alternatives follow. LOW confidence renders no pre-selection (decision 5).
  const choices = useMemo(() => buildChoices(proposal, activeCases), [proposal, activeCases]);

  const initialChoiceId = isLow ? '' : choices[0]?.id ?? '';
  const [selectedId, setSelectedId] = useState<string>(initialChoiceId);
  const [showWhy, setShowWhy] = useState<boolean>(run.confidence === 'MEDIUM');
  const [manualOpen, setManualOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    const choice = choices.find((c) => c.id === selectedId);
    if (!choice) {
      setError('Pick an option to continue.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const decision = choice.toDecision(proposal, run);
      const res = await fetch(`/api/notes/${noteId}/case-router/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseRouterRunId: run.id, decision }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? 'Could not save the routing decision.');
        return;
      }
      // Sprint 0.17 — capture the optional write-back proposal from
      // the response so the parent can render the inline section.
      const body = await res.json().catch(() => null);
      const wb = (body?.data?.writeBackProposal ?? null) as
        | (WriteBackProposalInline & { caseManagementId?: string })
        | null;
      // The accept response carries `caseManagementId` separately — we
      // thread it through so the approve endpoint URL knows the case.
      const caseId = (body?.data?.caseManagementId ?? '') as string;
      onResolved(
        wb && caseId ? { ...wb, caseManagementId: caseId } : null,
      );
    });
  }

  return (
    <PanelChrome>
      <div className="flex items-center gap-2 flex-wrap">
        <StatusBadge variant={confidenceVariant(run.confidence)} noIcon>
          confidence: {run.confidence}
        </StatusBadge>
        {isLow && (
          <span className="text-xs text-muted-foreground">
            I&apos;d want a human read on this — pick from these or open new.
          </span>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="sr-only">Routing options</legend>
        {choices.map((choice) => (
          <ChoiceRow
            key={choice.id}
            choice={choice}
            selected={selectedId === choice.id}
            onSelect={() => setSelectedId(choice.id)}
            disabled={pending}
            isPrimary={choice.id === choices[0]?.id}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          disabled={pending}
          onClick={() => setManualOpen((x) => !x)}
        >
          <Pencil className="size-3.5" aria-hidden />
          Change manually…
        </Button>
      </fieldset>

      {manualOpen && (
        <ManualPicker
          noteId={noteId}
          activeCases={activeCases}
          onResolved={() => onResolved(null)}
        />
      )}

      {!isHigh && (
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setShowWhy((x) => !x)}
          aria-expanded={showWhy}
        >
          {showWhy ? 'Hide reasoning' : 'Why?'}
        </button>
      )}
      {(isHigh || showWhy) && proposal.reasoning && (
        <p className="text-xs text-muted-foreground italic border-l-2 border-primary/40 pl-2 whitespace-pre-wrap">
          {proposal.reasoning}
        </p>
      )}
      {currentCaseId && (
        <p className="text-[10px] text-muted-foreground">
          Currently bound to case {currentCaseId}.
        </p>
      )}

      {error && <StatusBanner variant="danger">{error}</StatusBanner>}

      <div className="flex justify-end pt-1">
        <Button onClick={confirm} disabled={pending || !selectedId} aria-label="Confirm and continue review">
          {pending ? 'Saving…' : 'Confirm and continue review'}
        </Button>
      </div>
    </PanelChrome>
  );
}

// =============================================================================
// Sprint 0.16 — reconcile surface.
// =============================================================================

/**
 * `ReconcileCard` — surface for the `reconcile` action.
 *
 * Replaces the standard attach/open-new radio set with an amber drift
 * banner + a focused 2-4 resolution-option radio list. The
 * `recommendedOptionIndex` pre-selects the agent's top pick when set.
 *
 * Decision 7 / spec: confidence chip is omitted from this view — drift
 * is a fact, not a confidence rating. The agent's reasoning still
 * displays as a secondary line beneath the radios via the existing
 * "Why?" toggle pattern when present.
 *
 * Submit constructs an explicit `decision: { kind: 'reconcile',
 * driftLogId, resolution }` payload — there's no `kind: 'accept'`
 * path for reconcile because the API needs the resolution kind
 * explicit either way.
 */
function ReconcileCard({
  noteId,
  run,
  reconcileProposal,
  onResolved,
}: {
  noteId: string;
  run: CaseRouterRunDTO;
  reconcileProposal: ReconcileProposalDTO;
  onResolved: (writeBackProposal: WriteBackProposalInline | null) => void;
}) {
  const options = reconcileProposal.resolutionOptions;
  const initialIndex =
    reconcileProposal.recommendedOptionIndex !== undefined &&
    reconcileProposal.recommendedOptionIndex < options.length
      ? reconcileProposal.recommendedOptionIndex
      : 0;
  const [selectedIndex, setSelectedIndex] = useState<number>(initialIndex);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    const chosen = options[selectedIndex];
    if (!chosen) {
      setError('Pick an option to continue.');
      return;
    }
    setError(null);
    startTransition(async () => {
      // Build the resolution payload. For Sprint 0.16's first-cut UI
      // we ship the kinds that don't require extra inline input
      // (`reopen-case` / `attach-as-is` / `close-case`); for
      // `open-new-case` + `update-case-icd` the agent ALREADY chose
      // the ICD via the recommendedOption logic, but the UI doesn't
      // yet have a coding picker here, so we keep this path as a
      // graceful "fall back to manual override" surface — the
      // server-side decision schema validates the body either way.
      // Phase-2 polish: add inline coding inputs for those two kinds.
      let resolution: Record<string, unknown>;
      switch (chosen.kind) {
        case 'reopen-case':
        case 'attach-as-is':
          resolution = { kind: chosen.kind };
          break;
        case 'close-case':
          resolution = { kind: chosen.kind };
          break;
        case 'open-new-case':
          // The agent's label carries the proposed ICD-label; we don't
          // surface an inline coding picker yet, so we send a
          // placeholder coded value of "UNCODED" + the label. The
          // accept route's `open-new-case` branch tolerates any coded
          // ICD; the clinician adds the real ICD later via /review.
          resolution = {
            kind: 'open-new-case',
            primaryIcd: 'UNCODED',
            primaryIcdLabel: chosen.label.slice(0, 200),
          };
          break;
        case 'update-case-icd':
          // Same posture as open-new-case — the inline ICD picker is
          // Phase-2 polish. The label captures the agent's text.
          resolution = {
            kind: 'update-case-icd',
            newIcd: 'UNCODED',
            newIcdLabel: chosen.label.slice(0, 200),
          };
          break;
      }
      const res = await fetch(`/api/notes/${noteId}/case-router/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseRouterRunId: run.id,
          decision: {
            kind: 'reconcile',
            driftLogId: reconcileProposal.driftLogId,
            resolution,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? 'Could not save the reconciliation.');
        return;
      }
      const body = await res.json().catch(() => null);
      const wb = (body?.data?.writeBackProposal ?? null) as
        | (WriteBackProposalInline & { caseManagementId?: string })
        | null;
      const caseId = (body?.data?.caseManagementId ?? '') as string;
      onResolved(wb && caseId ? { ...wb, caseManagementId: caseId } : null);
    });
  }

  return (
    <PanelChrome>
      <CaseFhirDriftBanner
        summary={reconcileProposal.summary}
        driftKind={reconcileProposal.driftKind}
      />

      <p className="text-sm font-medium pt-1">How would you like to reconcile?</p>
      <fieldset className="space-y-2">
        <legend className="sr-only">Drift resolution options</legend>
        {options.map((opt, idx) => (
          <label
            key={`${opt.kind}-${idx}`}
            className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
              selectedIndex === idx
                ? 'border-primary/60 bg-primary/5'
                : 'border-border hover:bg-muted/30'
            } ${pending ? 'pointer-events-none opacity-60' : ''}`}
          >
            <input
              type="radio"
              name="case-router-reconcile-choice"
              checked={selectedIndex === idx}
              onChange={() => setSelectedIndex(idx)}
              disabled={pending}
              className="mt-1"
            />
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{opt.label}</span>
                {idx === reconcileProposal.recommendedOptionIndex && (
                  <StatusBadge variant="info" noIcon className="text-[10px]">
                    Recommended
                  </StatusBadge>
                )}
                <StatusBadge variant="warning" noIcon className="text-[10px]">
                  {resolutionKindBadge(opt.kind)}
                </StatusBadge>
              </div>
              {opt.reasoning && (
                <p className="text-xs text-muted-foreground">{opt.reasoning}</p>
              )}
            </div>
          </label>
        ))}
      </fieldset>

      {run.proposalJson.reasoning && (
        <p className="text-xs text-muted-foreground italic border-l-2 border-primary/40 pl-2 whitespace-pre-wrap">
          {run.proposalJson.reasoning}
        </p>
      )}

      {error && <StatusBanner variant="danger">{error}</StatusBanner>}

      <div className="flex justify-end pt-1">
        <Button onClick={confirm} disabled={pending} aria-label="Confirm reconciliation">
          {pending ? 'Saving…' : 'Confirm and continue review'}
        </Button>
      </div>
    </PanelChrome>
  );
}

function resolutionKindBadge(kind: ReconcileResolutionOptionKind): string {
  switch (kind) {
    case 'reopen-case':
      return 'Reopen';
    case 'open-new-case':
      return 'Open new';
    case 'close-case':
      return 'Close';
    case 'attach-as-is':
      return 'Attach as-is';
    case 'update-case-icd':
      return 'Update ICD';
  }
}

function ChoiceRow({
  choice,
  selected,
  onSelect,
  disabled,
  isPrimary,
}: {
  choice: Choice;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
  isPrimary: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
        selected ? 'border-primary/60 bg-primary/5' : 'border-border hover:bg-muted/30'
      } ${disabled ? 'pointer-events-none opacity-60' : ''}`}
    >
      <input
        type="radio"
        name="case-router-choice"
        checked={selected}
        onChange={onSelect}
        disabled={disabled}
        className="mt-1"
      />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{choice.title}</span>
          {isPrimary && (
            <StatusBadge variant="info" noIcon className="text-[10px]">
              Recommended
            </StatusBadge>
          )}
          {choice.kind === 'attach-existing' && (
            <StatusBadge variant="success" noIcon className="text-[10px]">
              Attach
            </StatusBadge>
          )}
          {choice.kind === 'open-new' && (
            <StatusBadge variant="neutral" noIcon className="text-[10px]">
              Open new
            </StatusBadge>
          )}
          {choice.kind === 'attach-with-secondary' && (
            <StatusBadge variant="violet" noIcon className="text-[10px]">
              Attach + secondary
            </StatusBadge>
          )}
          {choice.kind === 'open-new-from-condition' && (
            // Sprint 0.15 — visually distinct from "Open new" (Needs
            // coding semantics) because the EHR-verified path comes
            // with a guaranteed coded ICD. Pill colour matches the
            // EHR-verified pill below for visual cohesion.
            <StatusBadge variant="success" noIcon className="text-[10px]">
              <BadgeCheck className="size-3 inline-block mr-0.5 align-text-bottom" aria-hidden />
              EHR-verified
            </StatusBadge>
          )}
        </div>
        {choice.subtitle && (
          <p className="text-xs text-muted-foreground">{choice.subtitle}</p>
        )}
        {choice.fhirCitation && (
          // Sprint 0.15 — citation line beneath the radio per the spec's
          // example: "✓ EHR-verified · recorded 2024-08-15 by Dr. Patel".
          // The "Needs coding" badge that `open-new` (plain) carries is
          // explicitly absent here — the whole point of the FHIR path is
          // that the EHR already coded the diagnosis.
          <p className="flex items-center gap-1 text-xs text-[var(--status-success-fg)]">
            <BadgeCheck className="size-3.5 shrink-0" aria-hidden />
            <span>
              EHR-verified · recorded {choice.fhirCitation.recordedDate}
              {choice.fhirCitation.recorderName
                ? ` by ${choice.fhirCitation.recorderName}`
                : ''}
            </span>
          </p>
        )}
      </div>
    </label>
  );
}

function ManualPicker({
  noteId,
  activeCases,
  onResolved,
}: {
  noteId: string;
  activeCases: CaseRouterPanelCase[];
  onResolved: () => void;
}) {
  const [pickedId, setPickedId] = useState<string>('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!pickedId) {
      setError('Pick a case to attach this visit to.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/notes/${noteId}/case-router`).catch(() => null);
      if (!res?.ok) return; // we still proceed; this is just a refresh of the run id
      const body = await res.json();
      const runId = body?.data?.run?.id;
      if (!runId) {
        setError('Routing run not found.');
        return;
      }
      const accept = await fetch(`/api/notes/${noteId}/case-router/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseRouterRunId: runId,
          decision: { kind: 'attach', caseManagementId: pickedId },
        }),
      });
      if (!accept.ok) {
        const errBody = await accept.json().catch(() => null);
        setError(errBody?.error?.message ?? 'Could not attach this visit.');
        return;
      }
      onResolved();
    });
  }

  if (activeCases.length === 0) {
    return (
      <StatusBanner variant="warning">
        No other open cases on this patient — accept the recommendation or sign in
        as the case opener and create one.
      </StatusBanner>
    );
  }

  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-sm font-medium">Pick a case to attach this visit to</p>
      <fieldset className="space-y-2">
        <legend className="sr-only">Patient&apos;s open cases</legend>
        {activeCases.map((c) => (
          <label
            key={c.id}
            className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${
              pickedId === c.id ? 'border-primary/60 bg-primary/5' : 'border-border hover:bg-muted/30'
            } ${pending ? 'pointer-events-none opacity-60' : ''}`}
          >
            <input
              type="radio"
              name="manual-case"
              checked={pickedId === c.id}
              onChange={() => setPickedId(c.id)}
              disabled={pending}
              className="mt-1"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                {c.primaryIcd ? (
                  <span className="font-mono text-xs mr-2">{c.primaryIcd}</span>
                ) : (
                  <span className="text-xs text-muted-foreground mr-2">Needs coding</span>
                )}
                {c.primaryIcdLabel}
              </p>
              {c.secondaryIcd && (
                <p className="text-xs text-muted-foreground">
                  Sec: {c.secondaryIcd}
                  {c.secondaryIcdLabel ? ` · ${c.secondaryIcdLabel}` : ''}
                </p>
              )}
            </div>
          </label>
        ))}
      </fieldset>
      {error && <StatusBanner variant="danger">{error}</StatusBanner>}
      <Button onClick={submit} size="sm" disabled={pending || !pickedId}>
        {pending ? 'Saving…' : 'Attach to this case'}
      </Button>
    </div>
  );
}

// =============================================================================
// Choice helpers.
// =============================================================================

type AcceptDecision = { kind: 'accept' };
type AttachDecision = { kind: 'attach'; caseManagementId: string };
type OpenNewDecision = {
  kind: 'open-new';
  primaryIcd: string | null;
  primaryIcdLabel: string;
  secondaryIcd?: string;
  secondaryIcdLabel?: string;
};
type AttachWithSecondaryDecision = {
  kind: 'attach-with-secondary';
  caseManagementId: string;
  icd: string;
  icdLabel: string;
};
/** Sprint 0.15 — explicit form of the FHIR-backed action. Used when
 *  the clinician selects an `open-new-from-condition` ALTERNATIVE
 *  (override path); the `accept` path reads the proposal payload
 *  directly. */
type OpenNewFromConditionDecision = {
  kind: 'open-new-from-condition';
  fhirConditionId: string;
  primaryIcd: string;
  primaryIcdLabel: string;
  recordedDate: string;
  recorderName: string | null;
};

type Decision =
  | AcceptDecision
  | AttachDecision
  | OpenNewDecision
  | AttachWithSecondaryDecision
  | OpenNewFromConditionDecision;

/** Sprint 0.15 — extra row beneath the radio for the EHR-verified pill +
 *  citation line. Null for non-FHIR actions. */
type FhirCitationDisplay = {
  fhirId: string;
  recordedDate: string;
  recorderName: string | null;
};

type Choice = {
  id: string;
  kind:
    | 'attach-existing'
    | 'attach-with-secondary'
    | 'open-new'
    | 'open-new-from-condition';
  title: string;
  subtitle: string | null;
  /** Sprint 0.15 — provenance line + EHR-verified pill rendering. */
  fhirCitation: FhirCitationDisplay | null;
  toDecision: (proposal: ProposalDTO, run: CaseRouterRunDTO) => Decision;
};

function buildChoices(proposal: ProposalDTO, activeCases: CaseRouterPanelCase[]): Choice[] {
  const choices: Choice[] = [];
  const caseById = new Map(activeCases.map((c) => [c.id, c]));

  // Primary choice from the proposal.
  if (proposal.action === 'attach' && proposal.caseManagementId) {
    const c = caseById.get(proposal.caseManagementId);
    choices.push({
      id: 'primary',
      kind: 'attach-existing',
      title: c
        ? `Attach to existing case · ${c.primaryIcd ? `${c.primaryIcd} ` : ''}${c.primaryIcdLabel}`
        : 'Attach to existing case',
      subtitle: c?.secondaryIcd ? `Sec: ${c.secondaryIcd} ${c.secondaryIcdLabel ?? ''}`.trim() : null,
      fhirCitation: null,
      toDecision: () => ({ kind: 'accept' as const }),
    });
  } else if (proposal.action === 'attach-with-secondary' && proposal.caseManagementId) {
    const c = caseById.get(proposal.caseManagementId);
    const sec = proposal.secondaryIcdAddition;
    choices.push({
      id: 'primary',
      kind: 'attach-with-secondary',
      title: c
        ? `Attach + add secondary · ${c.primaryIcd ? `${c.primaryIcd} ` : ''}${c.primaryIcdLabel}`
        : 'Attach with secondary',
      subtitle: sec ? `+ ${sec.icd} (${sec.icdLabel}) as a secondary on this case` : null,
      fhirCitation: null,
      toDecision: () => ({ kind: 'accept' as const }),
    });
  } else if (proposal.action === 'open-new' && proposal.newCase) {
    choices.push({
      id: 'primary',
      kind: 'open-new',
      title: `Open a new case · ${proposal.newCase.primaryIcd ?? 'Needs coding'} ${proposal.newCase.primaryIcdLabel}`.trim(),
      subtitle: proposal.newCase.secondaryIcd
        ? `Sec: ${proposal.newCase.secondaryIcd} ${proposal.newCase.secondaryIcdLabel ?? ''}`.trim()
        : null,
      fhirCitation: null,
      toDecision: () => ({ kind: 'accept' as const }),
    });
  } else if (
    proposal.action === 'open-new-from-condition' &&
    proposal.newCaseFromCondition
  ) {
    // Sprint 0.15 — FHIR-verified open-new. The title carries the
    // coded ICD prominently; the pill+citation render beneath the row
    // via `fhirCitation` so the trust signal isn't buried in subtitle
    // text.
    const fromCondition = proposal.newCaseFromCondition;
    choices.push({
      id: 'primary',
      kind: 'open-new-from-condition',
      title: `Open a new case · ${fromCondition.primaryIcd} ${fromCondition.primaryIcdLabel}`.trim(),
      subtitle: null,
      fhirCitation: {
        fhirId: fromCondition.fhirConditionId,
        recordedDate: fromCondition.recordedDate,
        recorderName: fromCondition.recorderName,
      },
      toDecision: () => ({ kind: 'accept' as const }),
    });
  }

  // Alternatives (max 3).
  for (let i = 0; i < proposal.alternatives.length; i++) {
    const alt = proposal.alternatives[i]!;
    if (alt.action === 'attach' && alt.caseManagementId) {
      const c = caseById.get(alt.caseManagementId);
      const altCaseId = alt.caseManagementId;
      choices.push({
        id: `alt-${i}`,
        kind: 'attach-existing',
        title: c
          ? `Attach to · ${c.primaryIcd ? `${c.primaryIcd} ` : ''}${c.primaryIcdLabel}`
          : 'Attach (case missing)',
        subtitle: alt.reasoning,
        fhirCitation: null,
        toDecision: () => ({ kind: 'attach' as const, caseManagementId: altCaseId }),
      });
    } else if (alt.action === 'open-new' && alt.newCase) {
      const newCase = alt.newCase;
      choices.push({
        id: `alt-${i}`,
        kind: 'open-new',
        title: `Open new · ${newCase.primaryIcd ?? 'Needs coding'} ${newCase.primaryIcdLabel}`.trim(),
        subtitle: alt.reasoning,
        fhirCitation: null,
        toDecision: () => ({
          kind: 'open-new' as const,
          primaryIcd: newCase.primaryIcd,
          primaryIcdLabel: newCase.primaryIcdLabel,
        }),
      });
    } else if (alt.action === 'open-new-from-condition' && alt.newCaseFromCondition) {
      const fromCondition = alt.newCaseFromCondition;
      choices.push({
        id: `alt-${i}`,
        kind: 'open-new-from-condition',
        title: `Open new · ${fromCondition.primaryIcd} ${fromCondition.primaryIcdLabel}`.trim(),
        subtitle: alt.reasoning,
        fhirCitation: {
          fhirId: fromCondition.fhirConditionId,
          recordedDate: fromCondition.recordedDate,
          recorderName: fromCondition.recorderName,
        },
        toDecision: () => ({
          kind: 'open-new-from-condition' as const,
          fhirConditionId: fromCondition.fhirConditionId,
          primaryIcd: fromCondition.primaryIcd,
          primaryIcdLabel: fromCondition.primaryIcdLabel,
          recordedDate: fromCondition.recordedDate,
          recorderName: fromCondition.recorderName,
        }),
      });
    }
  }

  return choices;
}

function describeAccepted(
  run: CaseRouterRunDTO,
  activeCases: CaseRouterPanelCase[],
  currentCaseId: string | null,
): string {
  const proposal = run.proposalJson;
  if (run.acceptedAction?.startsWith('overridden') || run.acceptedAction === 'overridden-manual') {
    if (currentCaseId) {
      const c = activeCases.find((x) => x.id === currentCaseId);
      if (c) {
        return `${c.primaryIcd ?? ''} ${c.primaryIcdLabel}`.trim();
      }
    }
    return '(override applied)';
  }
  // accepted — describe from proposal.
  if (proposal.action === 'attach' && proposal.caseManagementId) {
    const c = activeCases.find((x) => x.id === proposal.caseManagementId);
    if (c) return `${c.primaryIcd ?? ''} ${c.primaryIcdLabel}`.trim();
    return 'attach';
  }
  if (proposal.action === 'attach-with-secondary' && proposal.caseManagementId) {
    const c = activeCases.find((x) => x.id === proposal.caseManagementId);
    if (c) return `${c.primaryIcd ?? ''} ${c.primaryIcdLabel} + secondary`.trim();
    return 'attach + secondary';
  }
  if (proposal.action === 'open-new' && proposal.newCase) {
    return `${proposal.newCase.primaryIcd ?? ''} ${proposal.newCase.primaryIcdLabel}`.trim();
  }
  if (
    proposal.action === 'open-new-from-condition' &&
    proposal.newCaseFromCondition
  ) {
    return `${proposal.newCaseFromCondition.primaryIcd} ${proposal.newCaseFromCondition.primaryIcdLabel}`.trim();
  }
  if (proposal.action === 'reconcile' && proposal.reconcileProposal) {
    // Sprint 0.16 — accepted pill for a reconciled drift.
    return `reconciled (${proposal.reconcileProposal.driftKind.toLowerCase()} drift)`;
  }
  return '(routing applied)';
}

function confidenceVariant(c: Confidence): 'success' | 'info' | 'warning' {
  switch (c) {
    case 'HIGH':
      return 'success';
    case 'MEDIUM':
      return 'info';
    case 'LOW':
    default:
      return 'warning';
  }
}
