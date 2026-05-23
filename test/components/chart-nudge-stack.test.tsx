import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChartNudgeStack } from '@/components/cleo/chart-nudge-stack';
import type { NudgeCardData } from '@/components/cleo/nudge-card';

/**
 * Sprint 0.18 — ChartNudgeStack tests.
 *
 * Covers:
 *   - Empty list → renders nothing (decision 10 backward compat).
 *   - Non-empty list → renders the "Cleo notes N things" pill.
 *   - Pill is default-collapsed; opens on click; collapses on click.
 *   - Cap of 3 enforced server-side; the component faithfully
 *     renders whatever it's given (server's job to slice).
 */

const originalFetch = global.fetch;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

beforeEach(() => {
  global.fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ data: { ok: true } }) }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

function nudge(overrides: Partial<NudgeCardData> = {}): NudgeCardData {
  return {
    id: `n_${Math.random().toString(36).slice(2, 6)}`,
    kind: 'CASE_FHIR_STATUS_DRIFT',
    priority: 'HIGH',
    affordanceSlug: 'open-reconcile-flow',
    label: 'EHR drift on case',
    subtitle: 'Status differs',
    ...overrides,
  };
}

describe('ChartNudgeStack', () => {
  it('renders nothing when the list is empty (decision 10)', () => {
    const { container } = render(<ChartNudgeStack nudges={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a collapsed pill with the count when 1 nudge present', () => {
    render(<ChartNudgeStack nudges={[nudge({ id: 'n_a' })]} />);
    expect(screen.getByTestId('chart-nudge-stack')).toBeInTheDocument();
    expect(screen.getByText(/Miss Cleo notes 1 thing/)).toBeInTheDocument();
  });

  it('pluralizes the pill copy when 2+ nudges present', () => {
    render(
      <ChartNudgeStack
        nudges={[
          nudge({ id: 'n_a' }),
          nudge({ id: 'n_b', kind: 'GOAL_STALLED', priority: 'MEDIUM' }),
        ]}
      />,
    );
    expect(screen.getByText(/Miss Cleo notes 2 things/)).toBeInTheDocument();
  });

  it('expands on click + renders each NudgeCard', async () => {
    const user = userEvent.setup();
    render(
      <ChartNudgeStack
        nudges={[
          nudge({ id: 'n_a', label: 'EHR drift A' }),
          nudge({ id: 'n_b', label: 'Recert due', kind: 'RECERT_DUE_SOON' }),
        ]}
      />,
    );
    expect(screen.queryByText('EHR drift A')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Miss Cleo notes 2 things/ }));
    expect(screen.getByText('EHR drift A')).toBeInTheDocument();
    expect(screen.getByText('Recert due')).toBeInTheDocument();
  });

  it('honors defaultOpen=true', () => {
    render(
      <ChartNudgeStack
        defaultOpen
        nudges={[nudge({ id: 'n_a', label: 'Visible immediately' })]}
      />,
    );
    expect(screen.getByText('Visible immediately')).toBeInTheDocument();
  });

  it('renders up to 3 cards faithfully (cap is server-side; not enforced here)', () => {
    render(
      <ChartNudgeStack
        defaultOpen
        nudges={[
          nudge({ id: 'a', label: 'A' }),
          nudge({ id: 'b', label: 'B' }),
          nudge({ id: 'c', label: 'C' }),
        ]}
      />,
    );
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
  });
});
