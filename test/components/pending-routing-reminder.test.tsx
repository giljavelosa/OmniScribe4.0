import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PendingRoutingReminder } from '@/app/(clinical)/review/[noteId]/_components/pending-routing-reminder';

describe('PendingRoutingReminder', () => {
  it('renders the soft-nudge copy with the Awaiting routing pill', () => {
    render(<PendingRoutingReminder />);
    expect(
      screen.getByText(/Confirm Miss Cleo's routing before signing\./),
    ).toBeInTheDocument();
    expect(screen.getByText('Awaiting routing')).toBeInTheDocument();
  });

  it('exposes role=status so assistive tech treats it as a live notice, not an alert', () => {
    render(<PendingRoutingReminder />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
