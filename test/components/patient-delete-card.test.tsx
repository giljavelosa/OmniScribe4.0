import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PatientDeleteCard } from '@/app/(clinical)/patients/[id]/_components/patient-delete-card';

const routerPush = vi.fn();
const routerRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, refresh: routerRefresh }),
}));

describe('PatientDeleteCard', () => {
  beforeEach(() => {
    routerPush.mockReset();
    routerRefresh.mockReset();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { ok: true } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is hidden for users who cannot delete patients', () => {
    render(
      <PatientDeleteCard
        patientId="patient-1"
        patientName="Jane Doe"
        canDeletePatient={false}
      />,
    );

    expect(screen.queryByRole('button', { name: /delete patient record/i })).toBeNull();
  });

  it('uses an AlertDialog and DELETE request for org-admin deletion', async () => {
    const user = userEvent.setup();
    render(
      <PatientDeleteCard
        patientId="patient-1"
        patientName="Jane Doe"
        canDeletePatient
      />,
    );

    await user.click(screen.getByRole('button', { name: /delete patient record/i }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/delete jane doe/i)).toBeInTheDocument();

    const confirmButtons = screen.getAllByRole('button', { name: /delete patient record/i });
    await user.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/patients/patient-1', { method: 'DELETE' });
      expect(routerPush).toHaveBeenCalledWith('/patients');
      expect(routerRefresh).toHaveBeenCalled();
    });
  });
});
