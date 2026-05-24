import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EncounterIntent } from '@prisma/client';

import {
  IntentChip,
  deriveIntentSource,
} from '@/app/(clinical)/patients/[id]/_components/intent-chip';

/**
 * Unit 48 PR2 — IntentChip rendering + intentSource derivation.
 *
 * Tests are pure component / pure function — no MSW, no Prisma mocks.
 * The Radix Select primitive renders the trigger button with the
 * currently-selected option's label, so we assert against the visible
 * label rather than clicking through the dropdown (which requires
 * portal interaction that's noisy in jsdom).
 */

const proposalProgress = {
  intent: EncounterIntent.REHAB_PROGRESS_NOTE,
  reason: 'visit 10 of 30 — first Progress Note for this episode',
  confidence: 'high' as const,
};

const proposalUnspecified = {
  intent: EncounterIntent.UNSPECIFIED,
  reason: 'visit type not auto-detected — pick from list',
  confidence: 'low' as const,
};

describe('IntentChip — rendering', () => {
  it("shows Cleo's proposed label when value equals the proposal", () => {
    render(
      <IntentChip
        proposedIntent={proposalProgress}
        value={EncounterIntent.REHAB_PROGRESS_NOTE}
        onChange={() => {}}
        division="REHAB"
      />,
    );
    expect(screen.getByText('Progress Note')).toBeInTheDocument();
    expect(screen.getByTestId('intent-chip-reason')).toHaveTextContent(
      'visit 10 of 30',
    );
  });

  it('marks data-intent-source=copilot-proposal when value matches the proposal', () => {
    render(
      <IntentChip
        proposedIntent={proposalProgress}
        value={EncounterIntent.REHAB_PROGRESS_NOTE}
        onChange={() => {}}
        division="REHAB"
      />,
    );
    const chip = screen.getByTestId('intent-chip');
    expect(chip).toHaveAttribute('data-intent-source', 'copilot-proposal');
    expect(chip).toHaveAttribute('data-intent', 'REHAB_PROGRESS_NOTE');
  });

  it('marks data-intent-source=clinician-override when value differs from the proposal', () => {
    render(
      <IntentChip
        proposedIntent={proposalProgress}
        value={EncounterIntent.REHAB_DAILY_NOTE}
        onChange={() => {}}
        division="REHAB"
      />,
    );
    const chip = screen.getByTestId('intent-chip');
    expect(chip).toHaveAttribute('data-intent-source', 'clinician-override');
    expect(screen.getByTestId('intent-chip-reason')).toHaveTextContent(
      /you changed it/i,
    );
  });

  it('renders the UNSPECIFIED placeholder when no proposal is confident', () => {
    render(
      <IntentChip
        proposedIntent={proposalUnspecified}
        value={EncounterIntent.UNSPECIFIED}
        onChange={() => {}}
        division="REHAB"
      />,
    );
    expect(screen.getByText('Visit type — choose')).toBeInTheDocument();
  });

  it('disables the trigger when `disabled` is true', () => {
    render(
      <IntentChip
        proposedIntent={proposalProgress}
        value={EncounterIntent.REHAB_PROGRESS_NOTE}
        onChange={() => {}}
        division="REHAB"
        disabled
      />,
    );
    const trigger = screen.getByLabelText('Visit type for this encounter');
    expect(trigger).toBeDisabled();
  });
});

describe('deriveIntentSource', () => {
  it('returns COPILOT_PROPOSAL_CONFIRMED when value matches the non-UNSPECIFIED proposal', () => {
    expect(
      deriveIntentSource(
        EncounterIntent.REHAB_PROGRESS_NOTE,
        EncounterIntent.REHAB_PROGRESS_NOTE,
      ),
    ).toBe('COPILOT_PROPOSAL_CONFIRMED');
  });

  it('returns CLINICIAN when value differs from the proposal', () => {
    expect(
      deriveIntentSource(
        EncounterIntent.REHAB_DAILY_NOTE,
        EncounterIntent.REHAB_PROGRESS_NOTE,
      ),
    ).toBe('CLINICIAN');
  });

  it('returns CLINICIAN when the proposal was UNSPECIFIED (no proposal to "confirm")', () => {
    expect(
      deriveIntentSource(
        EncounterIntent.REHAB_DAILY_NOTE,
        EncounterIntent.UNSPECIFIED,
      ),
    ).toBe('CLINICIAN');
  });

  it('returns CLINICIAN when both value and proposal are UNSPECIFIED (no proposal)', () => {
    expect(
      deriveIntentSource(
        EncounterIntent.UNSPECIFIED,
        EncounterIntent.UNSPECIFIED,
      ),
    ).toBe('CLINICIAN');
  });
});
