import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Profession } from '@prisma/client';

import {
  CasesPanel,
  type CasePanelData,
} from '@/app/(clinical)/patients/[id]/_components/cases-panel';

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

/**
 * Step 2 of the case-routing-junk hardening: rows promoted to ACTIVE
 * while still carrying the synthetic fallback placeholder must render
 * as "Uncoded — needs ICD" so clinicians know to fix them. The accept-
 * endpoint guard prevents new ones; this protects historical rows.
 */
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
    expect(screen.queryByText('Routing in progress')).not.toBeInTheDocument();
    expect(screen.getByText('Uncoded — needs ICD')).toBeInTheDocument();
    expect(screen.getByText('Needs coding')).toBeInTheDocument();
  });

  it('does NOT relabel a null-ICD case that has a real clinician-typed label', () => {
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
    expect(screen.getByText('Needs coding')).toBeInTheDocument();
  });
});

function makeCase(overrides: Partial<CasePanelData> & { id: string }): CasePanelData {
  return {
    id: overrides.id,
    primaryIcd: overrides.primaryIcd ?? 'M75.101',
    primaryIcdLabel: overrides.primaryIcdLabel ?? 'Rotator cuff',
    secondaryIcd: overrides.secondaryIcd ?? null,
    secondaryIcdLabel: overrides.secondaryIcdLabel ?? null,
    description: overrides.description ?? null,
    status: overrides.status ?? 'ACTIVE',
    viewerLastActivityAt: overrides.viewerLastActivityAt ?? null,
    viewerDivisionLastActivityAt: overrides.viewerDivisionLastActivityAt ?? null,
    lastActivityAt: overrides.lastActivityAt ?? null,
    medicalVisitCount: overrides.medicalVisitCount ?? 0,
    bhVisitCount: overrides.bhVisitCount ?? 0,
    rehabEpisodes: overrides.rehabEpisodes ?? [],
    writebackStatus: overrides.writebackStatus ?? null,
    writebackFailureKind: overrides.writebackFailureKind ?? null,
  };
}

const hero = makeCase({
  id: 'case_hero',
  primaryIcd: 'M75.101',
  primaryIcdLabel: 'Rotator cuff',
  viewerLastActivityAt: '2026-05-20T00:00:00Z',
});
const secondary = makeCase({
  id: 'case_hip',
  primaryIcd: 'M25.551',
  primaryIcdLabel: 'Right hip pain',
});
const closedSecondary = makeCase({
  id: 'case_closed',
  primaryIcd: 'S82.001A',
  primaryIcdLabel: 'Old ankle fx',
  status: 'CLOSED',
});

describe('CasesPanel — "Start visit on this case" affordance', () => {
  it('renders the button on the non-hero ACTIVE card when onContinueCase is provided', () => {
    render(
      <CasesPanel
        patientId="pat_1"
        cases={[hero, secondary]}
        viewingProfession={Profession.PT}
        canEdit
        onContinueCase={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /continue this case in a new visit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start visit on this case/i })).toBeInTheDocument();
  });

  it('fires onContinueCase with the SECONDARY case id when clicked (not the hero id)', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();

    render(
      <CasesPanel
        patientId="pat_1"
        cases={[hero, secondary]}
        viewingProfession={Profession.PT}
        canEdit
        onContinueCase={onContinue}
      />,
    );

    await user.click(screen.getByRole('button', { name: /start visit on this case/i }));

    expect(onContinue).toHaveBeenCalledOnce();
    expect(onContinue).toHaveBeenCalledWith(secondary.id);
  });

  it('does NOT render on CLOSED non-hero cards', () => {
    render(
      <CasesPanel
        patientId="pat_1"
        cases={[hero, closedSecondary]}
        viewingProfession={Profession.PT}
        canEdit
        onContinueCase={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /start visit on this case/i })).not.toBeInTheDocument();
  });

  it('does NOT render when canEdit is false', () => {
    render(
      <CasesPanel
        patientId="pat_1"
        cases={[hero, secondary]}
        viewingProfession={Profession.PT}
        canEdit={false}
        onContinueCase={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /start visit on this case/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continue this case in a new visit/i })).not.toBeInTheDocument();
  });

  it('does NOT render when onContinueCase is omitted', () => {
    render(
      <CasesPanel
        patientId="pat_1"
        cases={[hero, secondary]}
        viewingProfession={Profession.PT}
        canEdit
      />,
    );

    expect(screen.queryByRole('button', { name: /start visit on this case/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continue this case in a new visit/i })).not.toBeInTheDocument();
  });

  it('renders on the lone card when only one active case exists (no hero)', () => {
    render(
      <CasesPanel
        patientId="pat_1"
        cases={[secondary]}
        viewingProfession={Profession.PT}
        canEdit
        onContinueCase={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /start visit on this case/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continue this case in a new visit/i })).not.toBeInTheDocument();
  });

  it('does NOT double-render inside the hero card (chrome="bare" suppresses it)', () => {
    render(
      <CasesPanel
        patientId="pat_1"
        cases={[hero, secondary]}
        viewingProfession={Profession.PT}
        canEdit
        onContinueCase={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('button', { name: /start visit on this case/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /continue this case in a new visit/i })).toHaveLength(1);
  });
});
