import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Division } from '@prisma/client';

import {
  StartVisitDialog,
  type StartVisitDialogEpisode,
} from '@/app/(clinical)/patients/[id]/_components/start-visit-dialog';

/**
 * StartVisitDialog branching tests.
 *
 * Exercises the four cases from the spec:
 *   - 0 active episodes  → submitter called with episodeOfCareId=null + source=auto-none
 *   - 1 active episode   → submitter called with episodeOfCareId=<id> + source=auto-single
 *   - 2+ episodes, pick → submitter called with the picked id + source=picker
 *   - 2+ episodes, skip → submitter called with episodeOfCareId=null + source=manual-skip
 *
 * Uses the `submit` prop so the test never touches fetch().
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
  id: 'ep_dep',
  diagnosis: 'Major depressive disorder, recurrent',
  bodyPart: null,
  division: Division.BEHAVIORAL_HEALTH,
  lastVisitAt: null,
  visitCount: 0,
};

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StartVisitDialog — branching logic', () => {
  it('with 0 active episodes, auto-posts with source=auto-none and no episode id', async () => {
    const submit = vi.fn().mockResolvedValue({ encounterId: 'enc1', noteId: 'note1' });
    const onStarted = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <StartVisitDialog
        patientId="pat_1"
        activeEpisodes={[]}
        open
        onOpenChange={onOpenChange}
        onStarted={onStarted}
        submit={submit}
      />,
    );

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledWith({
      patientId: 'pat_1',
      episodeOfCareId: null,
      source: 'auto-none',
    });
    await waitFor(() =>
      expect(onStarted).toHaveBeenCalledWith({ encounterId: 'enc1', noteId: 'note1' }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);

    // No picker UI rendered.
    expect(
      screen.queryByText(/which episode is this visit for/i),
    ).not.toBeInTheDocument();
  });

  it('with 1 active episode, auto-posts with that episode id and source=auto-single', async () => {
    const submit = vi.fn().mockResolvedValue({ encounterId: 'enc2', noteId: 'note2' });
    const onStarted = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <StartVisitDialog
        patientId="pat_2"
        activeEpisodes={[ep1]}
        open
        onOpenChange={onOpenChange}
        onStarted={onStarted}
        submit={submit}
      />,
    );

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledWith({
      patientId: 'pat_2',
      episodeOfCareId: 'ep_knee',
      source: 'auto-single',
    });
    await waitFor(() =>
      expect(onStarted).toHaveBeenCalledWith({ encounterId: 'enc2', noteId: 'note2' }),
    );
  });

  it('with 2+ active episodes, renders the picker and does NOT auto-post', async () => {
    const submit = vi.fn().mockResolvedValue({ encounterId: 'enc3', noteId: 'note3' });
    const onStarted = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <StartVisitDialog
        patientId="pat_3"
        activeEpisodes={[ep1, ep2]}
        open
        onOpenChange={onOpenChange}
        onStarted={onStarted}
        submit={submit}
      />,
    );

    expect(await screen.findByText(/which episode is this visit for/i)).toBeInTheDocument();
    // Both episodes rendered
    expect(screen.getByText('Right knee OA')).toBeInTheDocument();
    expect(screen.getByText('Major depressive disorder, recurrent')).toBeInTheDocument();
    // Skip option present
    expect(screen.getByText(/start without an episode link/i)).toBeInTheDocument();
    // No POST yet
    expect(submit).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
  });

  it('with 2+ episodes, picking one and clicking Start submits with source=picker', async () => {
    const submit = vi.fn().mockResolvedValue({ encounterId: 'enc4', noteId: 'note4' });
    const onStarted = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <StartVisitDialog
        patientId="pat_4"
        activeEpisodes={[ep1, ep2]}
        open
        onOpenChange={onOpenChange}
        onStarted={onStarted}
        submit={submit}
      />,
    );

    // Start button is disabled until a selection is made.
    const startBtn = screen.getByRole('button', { name: /^start visit$/i });
    expect(startBtn).toBeDisabled();

    await user.click(screen.getByLabelText(/right knee oa/i));
    expect(startBtn).not.toBeDisabled();
    await user.click(startBtn);

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledWith({
      patientId: 'pat_4',
      episodeOfCareId: 'ep_knee',
      source: 'picker',
    });
    await waitFor(() =>
      expect(onStarted).toHaveBeenCalledWith({ encounterId: 'enc4', noteId: 'note4' }),
    );
  });

  it('with 2+ episodes, picking Skip submits with episodeOfCareId=null and source=manual-skip', async () => {
    const submit = vi.fn().mockResolvedValue({ encounterId: 'enc5', noteId: 'note5' });
    const onStarted = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <StartVisitDialog
        patientId="pat_5"
        activeEpisodes={[ep1, ep2]}
        open
        onOpenChange={onOpenChange}
        onStarted={onStarted}
        submit={submit}
      />,
    );

    await user.click(screen.getByLabelText(/start without an episode link/i));
    await user.click(screen.getByRole('button', { name: /^start visit$/i }));

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledWith({
      patientId: 'pat_5',
      episodeOfCareId: null,
      source: 'manual-skip',
    });
  });

  it('surfaces a submitter error on the dialog rather than swallowing it', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('boom — server down'));
    const onStarted = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <StartVisitDialog
        patientId="pat_6"
        activeEpisodes={[ep1, ep2]}
        open
        onOpenChange={onOpenChange}
        onStarted={onStarted}
        submit={submit}
      />,
    );

    await user.click(screen.getByLabelText(/right knee oa/i));
    await user.click(screen.getByRole('button', { name: /^start visit$/i }));

    expect(await screen.findByText(/boom — server down/i)).toBeInTheDocument();
    expect(onStarted).not.toHaveBeenCalled();
  });

  it('exposes a link to /patients/[id]/episodes/new for the create-new flow', () => {
    render(
      <StartVisitDialog
        patientId="pat_7"
        activeEpisodes={[ep1, ep2]}
        open
        onOpenChange={() => {}}
        onStarted={() => {}}
        submit={vi.fn()}
      />,
    );
    const link = screen.getByRole('link', { name: /create a new episode/i });
    expect(link).toHaveAttribute('href', '/patients/pat_7/episodes/new');
  });
});
