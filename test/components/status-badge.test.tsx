import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusBadge } from '@/components/ui/status-badge';

describe('StatusBadge', () => {
  it('renders text content', () => {
    render(<StatusBadge variant="success">Healthy</StatusBadge>);
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('exposes data-variant for downstream querying', () => {
    const { container } = render(<StatusBadge variant="danger">Down</StatusBadge>);
    const badge = container.querySelector('[data-slot="status-badge"]');
    expect(badge).toHaveAttribute('data-variant', 'danger');
  });

  it('defaults to neutral when no variant given', () => {
    const { container } = render(<StatusBadge>Pending</StatusBadge>);
    const badge = container.querySelector('[data-slot="status-badge"]');
    expect(badge).toHaveAttribute('data-variant', 'neutral');
  });

  it('renders a decorative icon by default (aria-hidden)', () => {
    const { container } = render(<StatusBadge variant="info">Note</StatusBadge>);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('hides the icon when noIcon is set', () => {
    const { container } = render(<StatusBadge variant="info" noIcon>Note</StatusBadge>);
    expect(container.querySelector('svg')).toBeNull();
  });
});
