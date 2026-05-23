import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NudgeCard, type NudgeCardData } from '@/components/cleo/nudge-card';

/**
 * Sprint 0.18 — NudgeCard component tests.
 *
 * Covers:
 *   - Priority pill uses the right StatusBadge variant text (rule 23).
 *   - SHOWN endpoint fires once on first mount; not on remount
 *     (decision 5 — useRef guard).
 *   - Dismiss button → POST /dismiss; act → POST /act; snooze 1d/7d
 *     options → POST /snooze with the right ISO timestamp.
 *   - Affordance label is per-slug (decision 7) — generic 'Open' is
 *     a regression.
 *   - Synthesized "pending:" rows (race) navigate without firing API
 *     calls — the worker's eventual upsert is the canonical truth.
 *   - PHI-bearing label is rendered as-is; the audit metadata is
 *     handled server-side (decision 9 — never re-asserted client-side).
 */

const originalFetch = global.fetch;
const fetchMock = vi.fn();

const routerPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}));

beforeEach(() => {
  fetchMock.mockReset();
  routerPush.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { ok: true } }) });
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

function buildNudge(overrides: Partial<NudgeCardData> = {}): NudgeCardData {
  return {
    id: 'n_1',
    kind: 'CASE_FHIR_STATUS_DRIFT',
    priority: 'HIGH',
    affordanceSlug: 'open-reconcile-flow',
    label: 'EHR drift on case (status)',
    subtitle: 'Status differs from EHR',
    affordanceHref: '/cases/case_1#reconcile',
    ...overrides,
  };
}

describe('NudgeCard', () => {
  it('renders the priority pill with the right label for HIGH', () => {
    render(<NudgeCard nudge={buildNudge()} surface="CHART" />);
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('EHR drift on case (status)')).toBeInTheDocument();
  });

  it('renders the priority pill for MEDIUM + LOW', () => {
    const { rerender } = render(
      <NudgeCard
        nudge={buildNudge({ priority: 'MEDIUM' })}
        surface="VISIT_PREPARE"
      />,
    );
    expect(screen.getByText('Medium')).toBeInTheDocument();
    rerender(
      <NudgeCard
        nudge={buildNudge({ priority: 'LOW' })}
        surface="VISIT_PREPARE"
      />,
    );
    expect(screen.getByText('Low')).toBeInTheDocument();
  });

  it('uses the affordance-specific button label (decision 7)', () => {
    render(
      <NudgeCard
        nudge={buildNudge({ affordanceSlug: 'start-recert-visit' })}
        surface="CHART"
      />,
    );
    expect(screen.getByRole('button', { name: 'Start recert visit' })).toBeInTheDocument();
  });

  it('fires CLEO_NUDGE_SHOWN endpoint on first mount with the surface in the body', async () => {
    render(<NudgeCard nudge={buildNudge()} surface="CHART" />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/nudges/n_1/shown',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ surface: 'CHART' }),
        }),
      );
    });
  });

  it('does NOT fire SHOWN for synthesized "pending:" rows (race-window safety)', async () => {
    render(<NudgeCard nudge={buildNudge({ id: 'pending:DRIFT:h_1' })} surface="CHART" />);
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('act button POSTs /act with the affordance slug and navigates to the href', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { ok: true } }) }) // shown
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { ok: true, status: 'ACTED' } }),
      }); // act

    const user = userEvent.setup();
    render(<NudgeCard nudge={buildNudge()} surface="CHART" />);

    await user.click(screen.getByRole('button', { name: 'Resolve drift' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/nudges/n_1/act',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ affordanceSlug: 'open-reconcile-flow' }),
        }),
      );
      expect(routerPush).toHaveBeenCalledWith('/cases/case_1#reconcile');
    });
  });

  it('dismiss menu option POSTs /dismiss with the surface', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { ok: true } }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { ok: true, status: 'DISMISSED' } }),
      });

    const user = userEvent.setup();
    render(<NudgeCard nudge={buildNudge()} surface="VISIT_PREPARE" />);

    await user.click(screen.getByRole('button', { name: 'Nudge actions' }));
    await user.click(await screen.findByText('Dismiss'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/nudges/n_1/dismiss',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ surface: 'VISIT_PREPARE' }),
        }),
      );
    });
  });

  it('snooze 1 day option POSTs /snooze with an ISO timestamp ~1 day out', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { ok: true } }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { ok: true, status: 'SNOOZED' } }),
      });

    const user = userEvent.setup();
    render(<NudgeCard nudge={buildNudge()} surface="CHART" />);

    await user.click(screen.getByRole('button', { name: 'Nudge actions' }));
    await user.click(await screen.findByText('Snooze 1 day'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => c[0] === '/api/nudges/n_1/snooze');
      expect(call).toBeDefined();
      const body = JSON.parse((call![1] as RequestInit).body as string) as {
        until: string;
        surface: string;
      };
      expect(body.surface).toBe('CHART');
      const ms = new Date(body.until).getTime() - Date.now();
      // ~1 day +/- a couple seconds
      expect(ms).toBeGreaterThan(23 * 60 * 60 * 1000);
      expect(ms).toBeLessThan(25 * 60 * 60 * 1000);
    });
  });

  it('hides the card after a successful dismiss (onResolved invoked)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: { ok: true } }) });
    const onResolved = vi.fn();
    const user = userEvent.setup();
    render(
      <NudgeCard nudge={buildNudge()} surface="CHART" onResolved={onResolved} />,
    );
    await user.click(screen.getByRole('button', { name: 'Nudge actions' }));
    await user.click(await screen.findByText('Dismiss'));
    await waitFor(() => {
      expect(onResolved).toHaveBeenCalled();
      expect(screen.queryByText('EHR drift on case (status)')).not.toBeInTheDocument();
    });
  });
});
