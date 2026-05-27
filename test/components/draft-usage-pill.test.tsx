import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BillingPlan } from '@prisma/client';

import { DraftUsagePill } from '@/components/billing/draft-usage-pill';

/**
 * DraftUsagePill — the live "X of Y drafts this month" counter on the
 * home cockpit. Tests cover:
 *   - Bundled-plan rendering (Solo / Practice / Duo)
 *   - Per-seat scaling for Practice
 *   - Unlimited variants (no denominator)
 *   - Color-tone thresholds (muted / warning / danger)
 *   - Click-target wiring (link to /account/usage)
 *   - Compact mode collapses the "Drafts:" label
 */

describe('DraftUsagePill — bundled plan rendering', () => {
  it('shows X of Y for SOLO_PRO under bundle (muted tone)', () => {
    render(
      <DraftUsagePill
        draftsUsed={87}
        billingPlan={BillingPlan.SOLO_PRO}
        seatCount={1}
      />,
    );
    expect(screen.getByText('87')).toBeInTheDocument();
    expect(screen.getByText('160')).toBeInTheDocument();
    // Link to the full usage page.
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/account/usage');
    // Aria label includes both numbers for screen-reader users.
    expect(link).toHaveAttribute(
      'aria-label',
      expect.stringContaining('87 of 160 drafts'),
    );
  });

  it('shows X of Y for SOLO_STARTER (smallest bundle)', () => {
    render(
      <DraftUsagePill
        draftsUsed={30}
        billingPlan={BillingPlan.SOLO_STARTER}
        seatCount={1}
      />,
    );
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
  });
});

describe('DraftUsagePill — per-seat scaling', () => {
  it('PRACTICE with 5 seats shows X of 800 (5 × 160)', () => {
    render(
      <DraftUsagePill
        draftsUsed={400}
        billingPlan={BillingPlan.PRACTICE}
        seatCount={5}
      />,
    );
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(screen.getByText('800')).toBeInTheDocument();
  });

  it('DUO is locked at 240 (2 seats × 120) regardless of seatCount', () => {
    // DUO has seatMin === seatCap === 2. Even if the DB shows 1 active
    // OrgUser (admin still onboarding their teammate), bundle stays at
    // the paid 2-seat amount.
    render(
      <DraftUsagePill
        draftsUsed={50}
        billingPlan={BillingPlan.DUO}
        seatCount={1}
      />,
    );
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('240')).toBeInTheDocument();
  });
});

describe('DraftUsagePill — unlimited variants (no denominator)', () => {
  it('SOLO_UNLIMITED shows just the count, no "of Y"', () => {
    render(
      <DraftUsagePill
        draftsUsed={250}
        billingPlan={BillingPlan.SOLO_UNLIMITED}
        seatCount={1}
      />,
    );
    expect(screen.getByText('250')).toBeInTheDocument();
    // No denominator anywhere.
    expect(screen.queryByText('of')).not.toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/unlimited/i),
    );
  });

  it('ENTERPRISE shows just the count', () => {
    render(
      <DraftUsagePill
        draftsUsed={1_500}
        billingPlan={BillingPlan.ENTERPRISE}
        seatCount={75}
      />,
    );
    expect(screen.getByText('1,500')).toBeInTheDocument();
    expect(screen.queryByText('of')).not.toBeInTheDocument();
  });
});

describe('DraftUsagePill — color tone thresholds', () => {
  it('< 80% of bundle → muted tone (default text-muted classes)', () => {
    const { container } = render(
      <DraftUsagePill
        draftsUsed={100}
        billingPlan={BillingPlan.SOLO_PRO}
        seatCount={1}
      />,
    );
    expect(container.firstChild).toHaveClass('text-muted-foreground');
  });

  it('80-99% of bundle → warning tone', () => {
    const { container } = render(
      <DraftUsagePill
        draftsUsed={140}
        billingPlan={BillingPlan.SOLO_PRO}
        seatCount={1}
      />,
    );
    // 140 / 160 = 87.5%
    expect(container.firstChild).toHaveClass(/status-warning/);
  });

  it('≥ 100% of bundle → danger tone', () => {
    const { container } = render(
      <DraftUsagePill
        draftsUsed={200}
        billingPlan={BillingPlan.SOLO_PRO}
        seatCount={1}
      />,
    );
    expect(container.firstChild).toHaveClass(/status-danger/);
  });

  it('Unlimited plans never enter warning/danger (no bundle to compare)', () => {
    const { container } = render(
      <DraftUsagePill
        draftsUsed={5_000}
        billingPlan={BillingPlan.SOLO_UNLIMITED}
        seatCount={1}
      />,
    );
    expect(container.firstChild).toHaveClass('text-muted-foreground');
  });
});

describe('DraftUsagePill — compact mode', () => {
  it('compact mode hides the "Drafts:" label', () => {
    render(
      <DraftUsagePill
        draftsUsed={87}
        billingPlan={BillingPlan.SOLO_PRO}
        seatCount={1}
        compact
      />,
    );
    expect(screen.queryByText(/drafts:/i)).not.toBeInTheDocument();
    // But the count itself is still there.
    expect(screen.getByText('87')).toBeInTheDocument();
  });
});

describe('DraftUsagePill — TRIAL', () => {
  it('TRIAL shows X of 50 (the soft-cap bundle)', () => {
    render(
      <DraftUsagePill
        draftsUsed={12}
        billingPlan={BillingPlan.TRIAL}
        seatCount={1}
      />,
    );
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
  });
});
