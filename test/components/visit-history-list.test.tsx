import { render, screen, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  VisitHistoryList,
  type VisitHistoryRow,
} from '@/components/patients/visit-history-list';

const baseRow: VisitHistoryRow = {
  id: 'note-A',
  signedAt: '2026-04-27T10:00:00.000Z',
  templateName: 'PT/OT Daily Note',
  division: 'REHAB',
  assessmentSnippet: null,
  isLateEntry: false,
  lateEntryDaysGap: null,
  dateOfService: '2026-04-27',
  clinicianId: 'cl-1',
  clinicianName: 'Dr. Sara Smith',
  clinicianProfessionLabel: 'Physical Therapist (PT)',
  episodeId: null,
  episodeDiagnosis: null,
  episodeDivision: null,
  episodeStatus: null,
  caseManagementId: 'case-shoulder',
  caseManagementPrimaryIcd: 'M75.41',
  caseManagementPrimaryIcdLabel: 'Right subacromial impingement syndrome',
  caseManagementStatus: 'ACTIVE',
};

const visits: VisitHistoryRow[] = [
  baseRow,
  {
    ...baseRow,
    id: 'note-B',
    signedAt: '2026-04-20T10:00:00.000Z',
    dateOfService: '2026-04-20',
  },
  {
    ...baseRow,
    id: 'note-C',
    signedAt: '2026-04-30T10:00:00.000Z',
    dateOfService: '2026-04-30',
    caseManagementId: 'case-pending',
    caseManagementPrimaryIcd: null,
    caseManagementPrimaryIcdLabel: 'Routing in progress',
    caseManagementStatus: 'PENDING_ROUTER',
  },
];

function switchToCaseView() {
  fireEvent.click(screen.getByRole('button', { name: 'By case' }));
}

// The component persists the active view-mode tab to this key. Tests run in
// a shared window, so each test scrubs that one key to avoid order-dependent
// defaults bleeding between cases. happy-dom doesn't expose `.clear()`, so
// targeted `removeItem` is the portable form.
const STORAGE_KEY = 'omniscribe.visit-history.view-mode';

describe('VisitHistoryList — By case view', () => {
  beforeEach(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // happy-dom may not provide localStorage in every env — component
      // tolerates it; tests do too.
    }
  });
  afterEach(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // see above
    }
  });

  it('exposes a "By case" tab alongside the existing views', () => {
    render(<VisitHistoryList visits={visits} />);
    // Existing views still render — additive change, not a replacement.
    expect(screen.getByRole('button', { name: 'By episode' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'By case' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'By clinician' })).toBeInTheDocument();
  });

  it('groups visits by caseManagementId when "By case" is selected', () => {
    render(<VisitHistoryList visits={visits} />);
    switchToCaseView();

    // Two case groups expected — the shoulder case (2 visits) + the pending
    // router case (1 visit).
    expect(screen.getByText('Right subacromial impingement syndrome')).toBeInTheDocument();
    expect(screen.getByText('Routing in progress')).toBeInTheDocument();

    const shoulderHeader = screen
      .getByText('Right subacromial impingement syndrome')
      .closest('div');
    expect(shoulderHeader).not.toBeNull();
    expect(within(shoulderHeader!).getByText(/2 visits/)).toBeInTheDocument();

    const pendingHeader = screen.getByText('Routing in progress').closest('div');
    expect(pendingHeader).not.toBeNull();
    expect(within(pendingHeader!).getByText(/1 visit\b/)).toBeInTheDocument();
  });

  it('renders ICD, label, and status as separate pills (structured header)', () => {
    render(<VisitHistoryList visits={visits} />);
    switchToCaseView();

    const shoulderHeader = screen
      .getByText('Right subacromial impingement syndrome')
      .closest('div');
    expect(shoulderHeader).not.toBeNull();
    // ICD code is its own pill — not concatenated into the label.
    expect(within(shoulderHeader!).getByText('M75.41')).toBeInTheDocument();
    // Status is its own pill — ACTIVE renders as a success-variant chip.
    expect(within(shoulderHeader!).getByText('ACTIVE')).toBeInTheDocument();
  });

  it('flags PENDING_ROUTER cases with an "Awaiting routing" warning pill', () => {
    render(<VisitHistoryList visits={visits} />);
    switchToCaseView();

    const pendingHeader = screen.getByText('Routing in progress').closest('div');
    expect(pendingHeader).not.toBeNull();
    expect(within(pendingHeader!).getByText('Awaiting routing')).toBeInTheDocument();
    // Active status string must NOT appear on a pending-router case header.
    expect(within(pendingHeader!).queryByText('ACTIVE')).toBeNull();
  });

  it('falls back to "Unrouted visit · No case" when caseManagementId is null', () => {
    const rows: VisitHistoryRow[] = [
      {
        ...baseRow,
        id: 'note-X',
        caseManagementId: null,
        caseManagementPrimaryIcd: null,
        caseManagementPrimaryIcdLabel: null,
        caseManagementStatus: null,
      },
    ];
    render(<VisitHistoryList visits={rows} />);
    switchToCaseView();
    expect(screen.getByText('Unrouted visit')).toBeInTheDocument();
    expect(screen.getByText('No case')).toBeInTheDocument();
  });

  it('reports total count when nothing is filtered out', () => {
    render(<VisitHistoryList visits={visits} />);
    // All 3 visits visible, no filter — straight count.
    expect(screen.getByText(/3 signed visits\./)).toBeInTheDocument();
    expect(screen.queryByText(/of 3 signed visits shown/)).toBeNull();
  });

  it('reports "N of M" when a division filter hides visits', () => {
    const mixed: VisitHistoryRow[] = [
      ...visits,
      { ...baseRow, id: 'note-D', division: 'MEDICAL' },
    ];
    render(<VisitHistoryList visits={mixed} />);
    // With more than PREVIEW_COUNT visits the panel starts collapsed; the
    // division filter only renders once it's expanded.
    fireEvent.click(screen.getByRole('button', { name: /Show all/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Medical' }));
    expect(screen.getByText(/1 of 4 signed visits shown\./)).toBeInTheDocument();
  });

  it('reports "N of M" while collapsed when more visits exist than the preview shows', () => {
    const many: VisitHistoryRow[] = Array.from({ length: 5 }, (_, i) => ({
      ...baseRow,
      id: `note-${i}`,
    }));
    render(<VisitHistoryList visits={many} />);
    // Default collapsed view shows the most-recent PREVIEW_COUNT (3) of 5.
    expect(screen.getByText(/3 of 5 signed visits shown\./)).toBeInTheDocument();
  });

  it('leaves the existing "By episode" view as the default (no behavior change for existing users)', () => {
    render(<VisitHistoryList visits={visits} />);
    // Default selected tab is still "By episode" — the additive PR must not
    // shift the landing view for clinicians whose localStorage is empty.
    expect(screen.getByRole('button', { name: 'By episode' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'By case' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('shows signed-note fact contribution chips on visit rows', () => {
    render(
      <VisitHistoryList
        visits={[
          {
            ...baseRow,
            factChips: ['Measures', 'Medications', 'Follow-ups'],
          },
        ]}
      />,
    );

    expect(screen.getByText('Measures')).toBeInTheDocument();
    expect(screen.getByText('Medications')).toBeInTheDocument();
    expect(screen.getByText('Follow-ups')).toBeInTheDocument();
  });
});
