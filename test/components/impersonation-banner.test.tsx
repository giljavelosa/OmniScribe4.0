import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImpersonationBanner } from '@/components/impersonation-banner';

/**
 * ImpersonationBanner tests — Unit 32.
 *
 * Mocks next-auth/react's useSession so we can drive the banner's
 * render path with both null + active impersonation contexts. The
 * router push/refresh + DELETE fetch are exercised in the integration
 * verify-when-done; this suite locks the conditional render +
 * accessibility shape.
 */

const mockUseSession = vi.fn();
vi.mock('next-auth/react', () => ({
  useSession: () => mockUseSession(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe('ImpersonationBanner', () => {
  it('renders nothing when no session', () => {
    mockUseSession.mockReturnValue({ data: null, update: vi.fn() });
    const { container } = render(<ImpersonationBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when session has no impersonation', () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: 'u1', email: 'a@b.c' }, impersonation: null },
      update: vi.fn(),
    });
    const { container } = render(<ImpersonationBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders danger-tinted banner when impersonation is active', () => {
    mockUseSession.mockReturnValue({
      data: {
        user: { id: 'owner-1', email: 'owner@platform.local' },
        impersonation: {
          targetUserId: 'usr-target',
          targetOrgId: 'org-target',
          beganAt: Date.now(),
          reason: 'Customer support — bug investigation',
        },
      },
      update: vi.fn(),
    });
    render(<ImpersonationBanner />);
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent('Impersonation active');
    expect(alert).toHaveTextContent('usr-target');
    expect(alert).toHaveTextContent('org-target');
    expect(alert).toHaveTextContent('Customer support');
  });

  it('shows the End-impersonation button when active', () => {
    mockUseSession.mockReturnValue({
      data: {
        user: { id: 'owner-1', email: 'owner@platform.local' },
        impersonation: {
          targetUserId: 't',
          targetOrgId: 'o',
          beganAt: Date.now(),
          reason: 'r',
        },
      },
      update: vi.fn(),
    });
    render(<ImpersonationBanner />);
    expect(screen.getByRole('button', { name: /end impersonation/i })).toBeInTheDocument();
  });
});
