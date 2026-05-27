import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Division } from '@prisma/client';

import {
  StartVisitDialog,
  type StartVisitDialogCase,
  type StartVisitDialogEpisode,
} from '@/app/(clinical)/patients/[id]/_components/start-visit-dialog';

/**
 * Sprint 0.13 — Miss Cleo's case-router agent. The case picker became the
 * OVERRIDE path: the default flow auto-posts WITHOUT a case id and the
 * worker proposes the destination at review time. The chart hero "Continue
 * this case" button supplies forceCaseId to bind explicitly.
 */

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

describe('StartVisitDialog — Sprint 0.13 agent-routed default flow', () => {
  it('with 0 active cases, auto-posts WITHOUT a case id (Cleo routes at review)', async () => {
    const submit = vi.fn().mockResolvedValue({ encounterId: 'enc0', noteId: 'note0' });

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

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledWith({
      patientId: 'pat_1',
      caseManagementId: null,
      episodeOfCareId: null,
      source: 'auto-none',
    });
  });

  it('with 1 active case (medical viewer), still auto-posts without case id', async () => {
    const submit = vi.fn().mockResolvedValue({ encounterId: 'enc2', noteId: 'note2' });

    render(
      <StartVisitDialog
        patientId="pat_2"
        activeCases={[caseDep]}
        viewerDivision={Division.MEDICAL}
        open
        onOpenChange={vi.fn()}
        onStarted={vi.fn()}
        submit={submit}
      />,
    );

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledWith({
      patientId: 'pat_2',
      caseManagementId: null,
      episodeOfCareId: null,
      source: 'auto-none',
    });
  });

  it('with 2+ active cases, auto-posts (no picker) — Cleo routes at review', async () => {
    const submit = vi.fn().mockResolvedValue({ encounterId: 'enc3', noteId: 'note3' });

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

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledWith({
      patientId: 'pat_4',
      caseManagementId: null,
      episodeOfCareId: null,
      source: 'auto-none',
    });
  });

  it('REHAB viewer with 2 episodes under a case but no forceCaseId still auto-posts', async () => {
    const submit = vi.fn().mockResolvedValue({ encounterId: 'enc5', noteId: 'note5' });

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

    // No forceCaseId → no episode picker; the agent flow auto-posts. The
    // rehab episode picker is a property of the override path only.
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledWith({
      patientId: 'pat_5',
      caseManagementId: null,
      episodeOfCareId: null,
      source: 'auto-none',
    });
  });
});

describe('StartVisitDialog — Sprint 0.13 override paths', () => {
  it('forceCaseId binds explicitly + skips the case picker', async () => {
    const submit = vi.fn().mockResolvedValue({ encounterId: 'enc6', noteId: 'note6' });

    render(
      <StartVisitDialog
        patientId="pat_6"
        activeCases={[caseDep]}
        viewerDivision={Division.MEDICAL}
        open
        forceCaseId={caseDep.id}
        onOpenChange={vi.fn()}
        onStarted={vi.fn()}
        submit={submit}
      />,
    );

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledWith({
      patientId: 'pat_6',
      caseManagementId: 'case_dep',
      episodeOfCareId: null,
      source: 'picker',
    });
  });

  it('forceCaseId on a REHAB case with 2 episodes opens the episode picker', async () => {
    const submit = vi.fn();

    render(
      <StartVisitDialog
        patientId="pat_7"
        activeCases={[caseTwoRehab]}
        viewerDivision={Division.REHAB}
        open
        forceCaseId={caseTwoRehab.id}
        onOpenChange={vi.fn()}
        onStarted={vi.fn()}
        submit={submit}
      />,
    );

    expect(await screen.findByText(/rehab episode for this case/i)).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it('forceDatePicker shows the visit-date picker without auto-post', () => {
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

  // Regression: late-entry submit was wedged disabled because the picker
  // required caseId, but Sprint 0.13's default flow has no case-picker UI —
  // caseId stays '' forever and Cleo routes server-side at review.
  it('forceDatePicker submit is enabled with no forceCaseId and posts with caseManagementId=null', async () => {
    const submit = vi.fn().mockResolvedValue({ encounterId: 'enc_late', noteId: 'note_late' });

    render(
      <StartVisitDialog
        patientId="pat_late_submit"
        activeCases={[]}
        viewerDivision={Division.MEDICAL}
        open
        onOpenChange={() => {}}
        onStarted={() => {}}
        submit={submit}
        forceDatePicker
      />,
    );

    const button = await screen.findByRole('button', { name: /start (late entry|visit)/i });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 'pat_late_submit',
        caseManagementId: null,
        source: 'auto-none',
      }),
    );
  });
});
