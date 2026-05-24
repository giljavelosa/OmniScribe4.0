import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { EditCaseDialog } from '@/app/(clinical)/patients/[id]/_components/edit-case-dialog';

/**
 * Smoke tests for EditCaseDialog. The dialog is the only UI surface that
 * wires the long-standing PATCH /api/case-management/[id] endpoint, so if
 * a future refactor removes any of these affordances clinicians will lose
 * the ability to fix "Needs coding" cases without an engineer's help.
 */
describe('EditCaseDialog', () => {
  const baseCase = {
    id: 'case_123',
    primaryIcd: null,
    primaryIcdLabel: 'Routing in progress',
    secondaryIcd: null,
    secondaryIcdLabel: null,
  };

  beforeEach(() => {
    // Stable fetch mock — tests that assert call shape will overwrite.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ data: {} }), { status: 200 }))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pre-fills primary label from the case row when opened', () => {
    render(
      <EditCaseDialog open onOpenChange={() => {}} caseRow={baseCase} onSaved={() => {}} />,
    );
    expect(screen.getByLabelText('Primary diagnosis label')).toHaveValue('Routing in progress');
  });

  it('renders empty ICD inputs when the case has none', () => {
    render(
      <EditCaseDialog open onOpenChange={() => {}} caseRow={baseCase} onSaved={() => {}} />,
    );
    expect(screen.getByLabelText('Primary ICD-10 (optional)')).toHaveValue('');
    expect(screen.getByLabelText('Secondary ICD-10 (optional)')).toHaveValue('');
  });

  it('PATCHes /api/case-management/[id] with the entered values', async () => {
    const onSaved = vi.fn();
    render(
      <EditCaseDialog open onOpenChange={() => {}} caseRow={baseCase} onSaved={onSaved} />,
    );

    fireEvent.change(screen.getByLabelText('Primary ICD-10 (optional)'), { target: { value: 'M75.121' } });
    fireEvent.change(screen.getByLabelText('Primary diagnosis label'), {
      target: { value: 'Right shoulder rotator cuff tendinopathy' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save case/i }));

    // Wait a tick for the transition + fetch.
    await new Promise((r) => setTimeout(r, 0));

    expect(fetch).toHaveBeenCalledWith(
      '/api/case-management/case_123',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('"primaryIcd":"M75.121"'),
      }),
    );
  });

  it('blocks save when primary label is empty', () => {
    render(
      <EditCaseDialog
        open
        onOpenChange={() => {}}
        caseRow={{ ...baseCase, primaryIcdLabel: '' }}
        onSaved={() => {}}
      />,
    );
    const save = screen.getByRole('button', { name: /save case/i });
    expect(save).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
