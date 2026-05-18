import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AuditMetadataDiff } from '@/components/audit/audit-metadata-diff';

/**
 * AuditMetadataDiff tests — Unit 34.
 *
 * Covers the canonical shape (renders the field-by-field diff), the
 * other-keys footer (extra metadata after `changes`), and the legacy
 * fallback path (raw JSON when shape doesn't match).
 */

describe('AuditMetadataDiff', () => {
  it('renders em-dash when metadata is null', () => {
    render(<AuditMetadataDiff metadata={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders the canonical changes shape as a diff table', () => {
    render(
      <AuditMetadataDiff
        metadata={{
          changes: {
            status: { before: 'ACTIVE', after: 'DISCHARGED' },
            recertDueAt: { before: null, after: '2026-08-01' },
          },
          patientId: 'pat-1',
        }}
      />,
    );
    expect(screen.getByText('status:')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('DISCHARGED')).toBeInTheDocument();
    expect(screen.getByText('recertDueAt:')).toBeInTheDocument();
    expect(screen.getByText('null')).toBeInTheDocument();
    expect(screen.getByText('2026-08-01')).toBeInTheDocument();
    // Other-keys footer renders surviving metadata as a small inline line.
    expect(screen.getByText(/patientId=pat-1/)).toBeInTheDocument();
  });

  it('falls back to raw JSON when no changes key present', () => {
    render(<AuditMetadataDiff metadata={{ rowCount: 12, hasMore: false }} />);
    expect(screen.getByText(/"rowCount":12/)).toBeInTheDocument();
  });

  it('falls back to raw JSON when changes is not a field-map shape', () => {
    // changes is present but the values aren't { before, after } envelopes.
    render(
      <AuditMetadataDiff metadata={{ changes: 'something else', extra: 1 }} />,
    );
    expect(screen.getByText(/"extra":1/)).toBeInTheDocument();
  });

  it('renders numeric + boolean values cleanly', () => {
    render(
      <AuditMetadataDiff
        metadata={{
          changes: {
            count: { before: 5, after: 12 },
            enforced: { before: false, after: true },
          },
        }}
      />,
    );
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('false')).toBeInTheDocument();
    expect(screen.getByText('true')).toBeInTheDocument();
  });
});
