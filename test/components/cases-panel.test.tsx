import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Profession } from '@prisma/client';

import {
  CasesPanel,
  type CasePanelData,
} from '@/app/(clinical)/patients/[id]/_components/cases-panel';

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

    // Hero retains its "Continue this case in a new visit" copy.
    expect(screen.getByRole('button', { name: /continue this case in a new visit/i })).toBeInTheDocument();
    // Secondary gets the new "Start visit on this case" affordance.
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

    // With a single case there's no hero. The lone CaseCard still surfaces
    // the new affordance — the clinician shouldn't have to fall back to the
    // generic "Start visit" picker just because there's only one case.
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

    // Exactly one "Start visit on this case" — secondary card only.
    // The hero embeds CaseCard with chrome="bare" so the new button is
    // suppressed there to avoid stacking next to the hero's own button.
    expect(screen.getAllByRole('button', { name: /start visit on this case/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /continue this case in a new visit/i })).toHaveLength(1);
  });
});
