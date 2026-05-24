import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  CaseRoutingPanel,
  type CaseRouterRunDTO,
} from '@/app/(clinical)/review/[noteId]/_components/case-routing-panel';

/**
 * Sprint 0.15 — case-routing-panel rendering tests.
 *
 * Covers the FHIR-backed `open-new-from-condition` action UX:
 *   - The fourth option renders with the EHR-verified pill +
 *     citation line ("✓ EHR-verified · recorded YYYY-MM-DD by …").
 *   - When confidence is HIGH and the proposal action is the
 *     FHIR-backed one, the option is pre-selected (radio checked).
 *   - On a Sprint-0.13 proposal (no FHIR action), the pill / citation
 *     do NOT render — backward compatibility.
 */

function fhirRun(overrides: Partial<CaseRouterRunDTO> = {}): CaseRouterRunDTO {
  return {
    id: 'run_fhir',
    confidence: 'HIGH',
    reasoning: 'EHR shows Dr. Patel recorded M54.81 on 2024-08-15.',
    modelVersion: 'sonnet',
    createdAt: new Date().toISOString(),
    acceptedAction: null,
    acceptedAt: null,
    proposalJson: {
      action: 'open-new-from-condition',
      newCaseFromCondition: {
        fhirConditionId: 'cond_m5481',
        primaryIcd: 'M54.81',
        primaryIcdLabel: 'Cervicogenic headache',
        recordedDate: '2024-08-15',
        recorderName: 'Dr. Patel',
      },
      confidence: 'high',
      reasoning: 'EHR shows Dr. Patel recorded M54.81 on 2024-08-15.',
      alternatives: [],
      fhirCitations: [
        {
          resourceType: 'Condition',
          fhirId: 'cond_m5481',
          lastUpdated: '2024-08-15T10:00:00Z',
          recorder: 'Dr. Patel',
          recordedDate: '2024-08-15',
        },
      ],
    },
    ...overrides,
  };
}

describe('CaseRoutingPanel — Sprint 0.15 FHIR-backed action', () => {
  it('renders the EHR-verified pill + citation line for the FHIR-backed proposal', () => {
    render(
      <CaseRoutingPanel
        noteId="note_fhir"
        initial={fhirRun()}
        initialActiveCases={[]}
        initialCurrentCaseId="case_pending"
      />,
    );

    // The action's title includes the coded ICD.
    expect(
      screen.getByText(/Open a new case · M54\.81 Cervicogenic headache/i),
    ).toBeInTheDocument();
    // EHR-verified pill (status badge).
    expect(screen.getByText(/EHR-verified$/i)).toBeInTheDocument();
    // Citation line with recordedDate + recorderName.
    expect(
      screen.getByText(/EHR-verified · recorded 2024-08-15 by Dr\. Patel/),
    ).toBeInTheDocument();
  });

  it('pre-selects the FHIR-backed option when confidence is HIGH', () => {
    render(
      <CaseRoutingPanel
        noteId="note_fhir"
        initial={fhirRun({ confidence: 'HIGH' })}
        initialActiveCases={[]}
        initialCurrentCaseId="case_pending"
      />,
    );
    const radio = screen.getByRole('radio') as HTMLInputElement;
    expect(radio.checked).toBe(true);
  });

  it('does not pre-select when confidence is LOW (decision 5 — clinician picks)', () => {
    render(
      <CaseRoutingPanel
        noteId="note_fhir"
        initial={fhirRun({ confidence: 'LOW' })}
        initialActiveCases={[]}
        initialCurrentCaseId="case_pending"
      />,
    );
    const radio = screen.getByRole('radio') as HTMLInputElement;
    expect(radio.checked).toBe(false);
  });

  it('does NOT render the EHR-verified pill / citation on a non-FHIR (Sprint-0.13) proposal', () => {
    const non_fhir: CaseRouterRunDTO = {
      id: 'run_native',
      confidence: 'HIGH',
      reasoning: 'A new shoulder problem — open a new case.',
      modelVersion: 'sonnet',
      createdAt: new Date().toISOString(),
      acceptedAction: null,
      acceptedAt: null,
      proposalJson: {
        action: 'open-new',
        newCase: {
          primaryIcd: 'M25.51',
          primaryIcdLabel: 'Right shoulder pain',
        },
        confidence: 'high',
        reasoning: 'A new shoulder problem.',
        alternatives: [],
      },
    };
    render(
      <CaseRoutingPanel
        noteId="note_native"
        initial={non_fhir}
        initialActiveCases={[]}
        initialCurrentCaseId="case_pending"
      />,
    );
    expect(screen.queryByText(/EHR-verified · recorded/i)).not.toBeInTheDocument();
  });
});

// =============================================================================
// Sprint 0.16 — reconcile rendering.
// =============================================================================

function reconcileRun(
  overrides: Partial<CaseRouterRunDTO> = {},
): CaseRouterRunDTO {
  return {
    id: 'run_reconcile',
    confidence: 'MEDIUM',
    reasoning: 'EHR shows Dr. Park resolved 2025-01-12.',
    modelVersion: 'sonnet',
    createdAt: new Date().toISOString(),
    acceptedAction: null,
    acceptedAt: null,
    proposalJson: {
      action: 'reconcile',
      confidence: 'medium',
      reasoning: 'EHR shows Dr. Park resolved 2025-01-12.',
      alternatives: [],
      reconcileProposal: {
        driftLogId: 'drift_1',
        caseManagementId: 'case_knee',
        fhirConditionId: 'cond_knee',
        driftKind: 'STATUS',
        summary:
          'Your OmniScribe case M17.11 — Right knee OA — is ACTIVE. The EHR Condition was marked resolved 2025-01-12 by Dr. Park.',
        resolutionOptions: [
          {
            kind: 'reopen-case',
            label: 'Reopen the case as a recurrence',
            reasoning: 'Visit reads like recurrence.',
          },
          {
            kind: 'open-new-case',
            label: 'Open a new case for M17.11',
            reasoning: 'Treat as a discrete episode.',
          },
          {
            kind: 'close-case',
            label: 'Close the OmniScribe case',
            reasoning: 'Sync to EHR.',
          },
          {
            kind: 'attach-as-is',
            label: 'Attach to the case as-is',
            reasoning: 'Defer reconciliation.',
          },
        ],
        recommendedOptionIndex: 0,
      },
    },
    ...overrides,
  };
}

describe('CaseRoutingPanel — Sprint 0.16 reconcile rendering', () => {
  it('renders the amber drift banner with the agent summary + driftKind chip', () => {
    render(
      <CaseRoutingPanel
        noteId="note_d"
        initial={reconcileRun()}
        initialActiveCases={[]}
        initialCurrentCaseId="case_pending"
      />,
    );
    // Banner copy.
    expect(screen.getByText(/EHR ↔ OmniScribe drift detected/i)).toBeInTheDocument();
    expect(
      screen.getByText(/marked resolved 2025-01-12 by Dr\. Park/i),
    ).toBeInTheDocument();
    // driftKind chip.
    expect(screen.getByText(/drift kind: STATUS/i)).toBeInTheDocument();
    // Amber posture — warning role on the banner.
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders all four resolution options with reasoning subtitles', () => {
    render(
      <CaseRoutingPanel
        noteId="note_d"
        initial={reconcileRun()}
        initialActiveCases={[]}
        initialCurrentCaseId="case_pending"
      />,
    );
    expect(screen.getByText(/Reopen the case as a recurrence/i)).toBeInTheDocument();
    expect(screen.getByText(/Open a new case for M17\.11/i)).toBeInTheDocument();
    expect(screen.getByText(/Close the OmniScribe case/i)).toBeInTheDocument();
    expect(screen.getByText(/Attach to the case as-is/i)).toBeInTheDocument();
    // Reasoning subtitle.
    expect(screen.getByText(/Visit reads like recurrence\./)).toBeInTheDocument();
  });

  it('pre-selects the option at recommendedOptionIndex', () => {
    render(
      <CaseRoutingPanel
        noteId="note_d"
        initial={reconcileRun({
          proposalJson: {
            ...reconcileRun().proposalJson,
            reconcileProposal: {
              ...reconcileRun().proposalJson.reconcileProposal!,
              recommendedOptionIndex: 2, // pick the 3rd radio (close-case)
            },
          },
        })}
        initialActiveCases={[]}
        initialCurrentCaseId="case_pending"
      />,
    );
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    // 4 reconcile options.
    expect(radios).toHaveLength(4);
    expect(radios[0]!.checked).toBe(false);
    expect(radios[1]!.checked).toBe(false);
    expect(radios[2]!.checked).toBe(true);
    expect(radios[3]!.checked).toBe(false);
  });

  it('does NOT render the standard alternatives section (reconcile replaces attach at the top level)', () => {
    render(
      <CaseRoutingPanel
        noteId="note_d"
        initial={reconcileRun()}
        initialActiveCases={[]}
        initialCurrentCaseId="case_pending"
      />,
    );
    // The "Change manually…" button (manual fallback) is part of the
    // standard ProposalCard path; the reconcile path should not render it.
    expect(screen.queryByText(/Change manually/i)).not.toBeInTheDocument();
  });
});

// =============================================================================
// Synthetic fallback proposal — Miss Cleo's LLM was unavailable at routing
// time and the service returned a placeholder proposal. The panel must
// suppress the standard ProposalCard (whose primary "Accept" choice would
// persist the placeholder label verbatim) and divert to the manual picker.
// =============================================================================

function fallbackRun(
  overrides: Partial<CaseRouterRunDTO> = {},
): CaseRouterRunDTO {
  return {
    id: 'run_fallback',
    confidence: 'LOW',
    reasoning: 'Auto-route unavailable — pick manually.',
    modelVersion: 'fallback',
    createdAt: new Date().toISOString(),
    acceptedAction: null,
    acceptedAt: null,
    proposalJson: {
      action: 'open-new',
      newCase: {
        primaryIcd: null,
        primaryIcdLabel: 'Routing in progress',
      },
      confidence: 'low',
      reasoning: 'Auto-route unavailable — pick manually.',
      alternatives: [],
    },
    ...overrides,
  };
}

describe('CaseRoutingPanel — synthetic fallback proposal', () => {
  it('renders the manual picker (not the ProposalCard) when the proposal is the placeholder fallback', () => {
    render(
      <CaseRoutingPanel
        noteId="note_fb"
        initial={fallbackRun()}
        initialActiveCases={[]}
        initialCurrentCaseId="case_pending"
      />,
    );

    // The trap-door "Open a new case · Needs coding Routing in progress"
    // ProposalCard option MUST NOT render — the bug we're fixing.
    expect(
      screen.queryByText(/Open a new case · Needs coding Routing in progress/i),
    ).not.toBeInTheDocument();
    // No "Confirm and continue review" button (that's ProposalCard's CTA).
    expect(
      screen.queryByRole('button', { name: /Confirm and continue review/i }),
    ).not.toBeInTheDocument();

    // The callout explicitly names Miss Cleo + tells the clinician to
    // pick or open with a real ICD.
    expect(
      screen.getByText(/couldn't auto-route this visit/i),
    ).toBeInTheDocument();
  });

  it('shows the open-new ICD form with empty inputs and a disabled "Open new case" button', () => {
    render(
      <CaseRoutingPanel
        noteId="note_fb"
        initial={fallbackRun()}
        initialActiveCases={[]}
        initialCurrentCaseId="case_pending"
      />,
    );

    expect(screen.getByLabelText(/ICD-10/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Diagnosis/i)).toBeInTheDocument();
    const openNewBtn = screen.getByRole('button', { name: /Open new case/i });
    expect(openNewBtn).toBeDisabled();
  });

  it('also offers attach-to-existing when the patient has other open cases', () => {
    render(
      <CaseRoutingPanel
        noteId="note_fb"
        initial={fallbackRun()}
        initialActiveCases={[
          {
            id: 'case_other',
            primaryIcd: 'M25.51',
            primaryIcdLabel: 'Right shoulder pain',
            secondaryIcd: null,
            secondaryIcdLabel: null,
            lastUpdatedAt: '2026-05-22T00:00:00.000Z',
          },
        ]}
        initialCurrentCaseId="case_pending"
      />,
    );

    // The attach section renders with the other case as a radio option.
    expect(screen.getByText(/Attach this visit to an open case/i)).toBeInTheDocument();
    expect(screen.getByText(/Right shoulder pain/i)).toBeInTheDocument();
    // Attach button starts disabled until a case is picked.
    expect(screen.getByRole('button', { name: /Attach to this case/i })).toBeDisabled();
    // The open-new form is still also available (separator wording).
    expect(screen.getByText(/Or open a new case/i)).toBeInTheDocument();
  });

  it('does NOT dead-end with "no other open cases" when activeCases is empty', () => {
    render(
      <CaseRoutingPanel
        noteId="note_fb"
        initial={fallbackRun()}
        initialActiveCases={[]}
        initialCurrentCaseId="case_pending"
      />,
    );
    // Previous behavior funneled the clinician into a warning telling
    // them to "accept the recommendation or sign in as the case opener" —
    // both dead ends now that Accept is blocked. The open-new form is
    // the always-available escape hatch.
    expect(
      screen.queryByText(/No other open cases on this patient/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Open a new case with a primary diagnosis/i),
    ).toBeInTheDocument();
  });
});
