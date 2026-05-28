import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  CleoReadCard,
  type CleoReadCardData,
} from '@/app/(clinical)/patients/[id]/_components/cleo-read-card';

/**
 * Sprint 0.14 — CleoReadCard tests.
 *
 * Covers the two states: populated (renders patterns + headline +
 * "Ask me anything" CTA) + empty (renders the "I'm just learning"
 * stub + a "get started" CTA). The CTA fires onAskOpen so the chart
 * can dispatch the global cleo:open-sheet event.
 */

describe('CleoReadCard — populated', () => {
  const data: CleoReadCardData = {
    cases: { activeCaseCount: 4, topCaseLabel: 'M54.81 · Cervicogenic headache' },
    patterns: [
      {
        kind: 'topic_mentioned_unaddressed',
        label: 'Sleep mentioned in last 3 visits (unaddressed)',
      },
      {
        kind: 'recert_due_soon',
        label: 'Recert due in 8 days — Right knee OA',
      },
    ],
    openFollowUpCount: 2,
    lastRebuiltAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  };

  it('renders the headline + patterns + CTA', () => {
    const onAsk = vi.fn();
    render(
      <CleoReadCard
        patientFirstName="James"
        data={data}
        onAskOpen={onAsk}
      />,
    );
    expect(screen.getByText(/cleo.+read.+james/i)).toBeInTheDocument();
    expect(screen.getByText(/4 active cases/i)).toBeInTheDocument();
    expect(screen.getByText(/2 open follow-ups/i)).toBeInTheDocument();
    expect(
      screen.getByText(/sleep mentioned in last 3 visits/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/recert due in 8 days/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ask me anything/i })).toBeInTheDocument();
  });

  it('fires onAskOpen when the CTA is clicked', async () => {
    const onAsk = vi.fn();
    const user = userEvent.setup();
    render(
      <CleoReadCard
        patientFirstName="James"
        data={data}
        onAskOpen={onAsk}
      />,
    );
    await user.click(screen.getByRole('button', { name: /ask me anything/i }));
    expect(onAsk).toHaveBeenCalledOnce();
  });

  it('caps the pattern list to 3 + still shows the overflow count', () => {
    const many: CleoReadCardData = {
      ...data,
      patterns: Array.from({ length: 7 }).map((_, i) => ({
        kind: 'topic_mentioned_unaddressed',
        label: `Pattern ${i + 1}`,
      })),
    };
    render(
      <CleoReadCard patientFirstName="J" data={many} onAskOpen={() => {}} />,
    );
    expect(screen.getByText(/\+4 more patterns/i)).toBeInTheDocument();
    for (let i = 1; i <= 3; i += 1) {
      expect(screen.getByText(`Pattern ${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByText('Pattern 4')).toBeNull();
  });

  it('hides the CTA when no onAskOpen is supplied', () => {
    render(<CleoReadCard patientFirstName="J" data={data} />);
    expect(screen.queryByRole('button', { name: /ask me anything/i })).toBeNull();
  });
});

describe('CleoReadCard — empty', () => {
  it('renders the learning-stub + Ask CTA', () => {
    const onAsk = vi.fn();
    render(
      <CleoReadCard patientFirstName="James" data={null} onAskOpen={onAsk} />,
    );
    expect(screen.getByText(/still learning james.+chart/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^ask$/i })).toBeInTheDocument();
  });

  it('fires onAskOpen on the empty-state CTA', async () => {
    const onAsk = vi.fn();
    const user = userEvent.setup();
    render(
      <CleoReadCard patientFirstName="James" data={null} onAskOpen={onAsk} />,
    );
    await user.click(screen.getByRole('button', { name: /^ask$/i }));
    expect(onAsk).toHaveBeenCalledOnce();
  });
});
