import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Division } from '@prisma/client';

import {
  StartVisitDialog,
  type StartVisitDialogCase,
  type StartVisitDialogEpisode,
} from '@/app/(clinical)/patients/[id]/_components/start-visit-dialog';

const ep1: StartVisitDialogEpisode = {
  id: 'ep_knee',
  diagnosis: 'Right knee OA',
  bodyPart: 'Right knee',
  division: Division.REHAB,
  lastVisitAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  visitCount: 3,
};
const ep2: StartVisitDialogEpisode = {
  id: 'ep_shoulder',
  diagnosis: 'Rotator cuff strain',
  bodyPart: 'Right shoulder',
  division: Division.REHAB,
  lastVisitAt: null,
  visitCount: 0,
};

function makeCase(
  id: string,
  label: string,
  episodes: StartVisitDialogEpisode[] = [],
): StartVisitDialogCase {
  return {
    id,
    primaryIcd: null,
    primaryIcdLabel: label,
    secondaryIcd: null,
    lastActivityAt: null,
    viewerLastActivityAt: null,
    viewerDivisionLastActivityAt: null,
    episodes,
  };
}

const caseKnee = makeCase('case_knee', 'Right knee OA', [ep1]);
const caseDep = makeCase('case_dep', 'Major depressive disorder, recurrent');
const caseTwoRehab = makeCase('case_multi', 'Multi rehab', [ep1, ep2]);

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StartVisitDialog — case + episode branching', () => {
  it('with 0 active cases, opens picker and does not auto-post', async () => {
    const submit = vi.fn().mockResolvedValue({ encounterId: 'enc1', noteId: 'note1' });

    render(
      <StartVisitDialog
        patientId="pat_1"
        activeCases={[]}
        viewerDivision={Division.MEDICAL}
        open
        onOpenChange={vi.fn()}
        onStarted={vi.fn()}
        submit={submit}
      />,
    );

    expect(await screen.findByText(/which case is this visit for/i)).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it('with 1 active case (medical viewer), auto-posts case only', async () => {
    const submit = vi.fn().mockResolvedValue({ encounterId: 'enc2', noteId: 'note2' });
    const onStarted = vi.fn();

    render(
      <StartVisitDialog
        patientId="pat_2"
        activeCases={[caseDep]}
        viewerDivision={Division.MEDICAL}
        open
        onOpenChange={vi.fn()}
        onStarted={onStarted}
        submit={submit}
      />,
    );

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledWith({
      patientId: 'pat_2',
      caseManagementId: 'case_dep',
      episodeOfCareId: null,
      source: 'auto-none',
    });
  });

  it('with 1 rehab case + 1 episode (PT viewer), auto-posts case and episode', async () => {
    const submit = vi.fn().mockResolvedValue({ encounterId: 'enc3', noteId: 'note3' });

    render(
      <StartVisitDialog
        patientId="pat_3"
        activeCases={[caseKnee]}
        viewerDivision={Division.REHAB}
        open
        onOpenChange={vi.fn()}
        onStarted={vi.fn()}
        submit={submit}
      />,
    );

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledWith({
      patientId: 'pat_3',
      caseManagementId: 'case_knee',
      episodeOfCareId: 'ep_knee',
      source: 'auto-single',
    });
  });

  it('with 2+ active cases, renders case picker', async () => {
    const submit = vi.fn();

    render(
      <StartVisitDialog
        patientId="pat_4"
        activeCases={[caseKnee, caseDep]}
        viewerDivision={Division.MEDICAL}
        open
        onOpenChange={vi.fn()}
        onStarted={vi.fn()}
        submit={submit}
      />,
    );

    expect(await screen.findByText(/which case is this visit for/i)).toBeInTheDocument();
    expect(screen.getByText('Right knee OA')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it('REHAB viewer with 2 episodes under one case shows episode picker', async () => {
    const submit = vi.fn();

    render(
      <StartVisitDialog
        patientId="pat_5"
        activeCases={[caseTwoRehab]}
        viewerDivision={Division.REHAB}
        open
        onOpenChange={vi.fn()}
        onStarted={vi.fn()}
        submit={submit}
      />,
    );

    expect(await screen.findByText(/rehab episode for this case/i)).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it('with forceDatePicker and 1 rehab case, shows visit-date without auto-post', () => {
    const submit = vi.fn();

    render(
      <StartVisitDialog
        patientId="pat_late"
        activeCases={[caseKnee]}
        viewerDivision={Division.REHAB}
        open
        onOpenChange={() => {}}
        onStarted={() => {}}
        submit={submit}
        forceDatePicker
      />,
    );

    expect(screen.getByText(/start late entry/i)).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });
});
