import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { BrandWordmark } from '@/components/brand-wordmark';

describe('BrandWordmark', () => {
  it('renders the canonical "OmniScribe" string exactly', () => {
    render(<BrandWordmark />);
    // Brand rule: always one word, capital O + capital S. No variants.
    expect(screen.getByText('OmniScribe')).toBeInTheDocument();
  });

  it('uses the canonical aria-label', () => {
    const { container } = render(<BrandWordmark />);
    expect(container.querySelector('[aria-label="OmniScribe"]')).not.toBeNull();
  });

  it('renders the quill SVG with aria-hidden', () => {
    const { container } = render(<BrandWordmark />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('iconOnly mode hides the wordmark text', () => {
    render(<BrandWordmark iconOnly />);
    expect(screen.queryByText('OmniScribe')).toBeNull();
  });
});
