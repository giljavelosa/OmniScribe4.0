import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  CasesPanel,
  type CasePanelData,
} from '@/app/(clinical)/patients/[id]/_components/cases-panel';

/**
 * Step 2 of the case-routing-junk hardening: the patient-page cases panel
 * must visibly call out "junk" cases — rows that were promoted to ACTIVE
 * while still carrying the synthetic fallback proposal's placeholder
 * label (Miss Cleo's LLM was unavailable at routing time, the accept
 * endpoint pre-guard allowed the promotion). The accept-endpoint guard
 * now prevents new ones, but historical rows + cases created before the
 * guard landed need to render with "Uncoded — needs ICD" instead of the
 * raw placeholder so clinicians know to fix them.
 */

const baseCase: CasePanelData = {
  id: 'case-1',
  primaryIcd: 'M25.51',
  primaryIcdLabel: 'Right shoulder pain',
  secondaryIcd: null,
  secondaryIcdLabel: null,
  description: null,
  status: 'ACTIVE',
  viewerLastActivityAt: null,
  viewerDivisionLastActivityAt: null,
  lastActivityAt: '2026-05-23T18:00:00.000Z',
  medicalVisitCount: 0,
  bhVisitCount: 0,
  rehabEpisodes: [],
};

describe('CasesPanel — uncoded junk case rendering', () => {
  it('shows the standard "ICD · label" headline for a coded case', () => {
    render(
      <CasesPanel
        patientId="pat-1"
        cases={[baseCase]}
        viewingProfession={null}
        canEdit={false}
      />,
    );
    expect(screen.getByText('M25.51 · Right shoulder pain')).toBeInTheDocument();
    expect(screen.queryByText('Uncoded — needs ICD')).not.toBeInTheDocument();
    expect(screen.queryByText('Needs coding')).not.toBeInTheDocument();
  });

  it('renders "Uncoded — needs ICD" + warning badge when primaryIcd is null AND label is the placeholder', () => {
    const junk: CasePanelData = {
      ...baseCase,
      id: 'case-junk',
      primaryIcd: null,
      primaryIcdLabel: 'Routing in progress',
    };
    render(
      <CasesPanel
        patientId="pat-1"
        cases={[junk]}
        viewingProfession={null}
        canEdit={false}
      />,
    );
    // The headline must NOT echo the raw placeholder — that looks like
    // routing is still in flight (it isn't; this case is ACTIVE).
    expect(screen.queryByText('Routing in progress')).not.toBeInTheDocument();
    expect(screen.getByText('Uncoded — needs ICD')).toBeInTheDocument();
    // The pre-existing "Needs coding" warning badge still fires
    // (gated only on primaryIcd === null).
    expect(screen.getByText('Needs coding')).toBeInTheDocument();
  });

  it('does NOT relabel a null-ICD case that has a real clinician-typed label', () => {
    // A real "I know the diagnosis but not the code yet" case — the
    // clinician opened the case manually with a free-text label.
    // We should leave their label alone; only the synthetic fallback's
    // exact placeholder string triggers the relabel.
    const partial: CasePanelData = {
      ...baseCase,
      id: 'case-partial',
      primaryIcd: null,
      primaryIcdLabel: 'Possible rotator cuff injury',
    };
    render(
      <CasesPanel
        patientId="pat-1"
        cases={[partial]}
        viewingProfession={null}
        canEdit={false}
      />,
    );
    expect(screen.getByText('Possible rotator cuff injury')).toBeInTheDocument();
    expect(screen.queryByText('Uncoded — needs ICD')).not.toBeInTheDocument();
    // "Needs coding" still appears because primaryIcd is null.
    expect(screen.getByText('Needs coding')).toBeInTheDocument();
  });
});
