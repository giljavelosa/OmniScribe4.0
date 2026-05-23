import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AwaitingRoutingBanner } from '@/app/(clinical)/patients/[id]/_components/awaiting-routing-banner';
import type { VisitHistoryRow } from '@/components/patients/visit-history-list';

const baseRow: VisitHistoryRow = {
  id: 'note-1',
  signedAt: '2026-04-30T10:00:00.000Z',
  templateName: 'PT/OT Daily Note',
  division: 'REHAB',
  assessmentSnippet: null,
  isLateEntry: false,
  lateEntryDaysGap: null,
  dateOfService: '2026-04-30',
  clinicianId: 'cl-1',
  clinicianName: 'Dr. Sara Smith',
  clinicianProfessionLabel: 'Physical Therapist (PT)',
  episodeId: null,
  episodeDiagnosis: null,
  episodeDivision: null,
  episodeStatus: null,
  caseManagementId: 'case-pending',
  caseManagementPrimaryIcd: null,
  caseManagementPrimaryIcdLabel: 'Routing in progress',
  caseManagementStatus: 'PENDING_ROUTER',
};

describe('AwaitingRoutingBanner', () => {
  it('renders nothing when no visits are pending router', () => {
    const { container } = render(
      <AwaitingRoutingBanner
        visits={[
          { ...baseRow, id: 'note-A', caseManagementStatus: 'ACTIVE' },
          { ...baseRow, id: 'note-B', caseManagementStatus: 'CLOSED' },
        ]}
      />,
    );
    // Zero visual weight in the happy path — empty container, no card.
    expect(container.firstChild).toBeNull();
  });

  it('singular copy for one pending visit', () => {
    render(<AwaitingRoutingBanner visits={[baseRow]} />);
    expect(
      screen.getByText('Miss Cleo is still routing 1 signed visit.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Awaiting routing')).toBeInTheDocument();
  });

  it('plural copy and one Resume link per pending visit', () => {
    const visits: VisitHistoryRow[] = [
      baseRow,
      { ...baseRow, id: 'note-2', clinicianName: 'Dr. Linh Nguyen' },
      // Active row must NOT count toward the pending total.
      { ...baseRow, id: 'note-3', caseManagementStatus: 'ACTIVE' },
    ];
    render(<AwaitingRoutingBanner visits={visits} />);
    expect(
      screen.getByText('Miss Cleo is still routing 2 signed visits.'),
    ).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /Resume in review/i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/review/note-1');
    expect(links[1]).toHaveAttribute('href', '/review/note-2');
  });
});
