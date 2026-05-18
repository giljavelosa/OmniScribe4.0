import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { ReasoningChain } from '@/components/copilot/reasoning-chain';

describe('ReasoningChain', () => {
  const steps = [
    { index: 1, summary: 'Look up the last signed note for the plan.' },
    { index: 2, summary: 'Cross-reference with active follow-ups.' },
  ];

  it('renders nothing when steps is empty', () => {
    const { container } = render(<ReasoningChain steps={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a step-count chip closed by default', () => {
    render(<ReasoningChain steps={steps} />);
    const trigger = screen.getByRole('button', { expanded: false });
    expect(trigger).toHaveTextContent(/2 steps/i);
    // Chain body is hidden when collapsed.
    expect(screen.queryByText(/Look up the last signed note/)).toBeNull();
  });

  it('expands the chain on click + shows each summary', () => {
    render(<ReasoningChain steps={steps} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
    expect(screen.getByText(/Look up the last signed note/)).toBeInTheDocument();
    expect(screen.getByText(/Cross-reference with active/)).toBeInTheDocument();
  });

  it('singularizes "1 step" when there is exactly one', () => {
    render(<ReasoningChain steps={[{ index: 1, summary: 'one only' }]} />);
    expect(screen.getByRole('button')).toHaveTextContent(/1 step\b/);
  });

  it('renders the trust-calibration footer hint when expanded', () => {
    render(<ReasoningChain steps={steps} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/trust calibration/i)).toBeInTheDocument();
  });
});
