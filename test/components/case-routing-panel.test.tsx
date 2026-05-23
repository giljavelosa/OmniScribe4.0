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
