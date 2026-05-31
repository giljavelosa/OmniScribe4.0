import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SafetyBand } from '@/app/(clinical)/patients/[id]/_components/safety-band';

describe('SafetyBand', () => {
  it('shows allergy names from verified uploaded records instead of only a count', () => {
    render(
      <SafetyBand
        activeProblems={[]}
        verifiedAllergies={[
          {
            id: 'a1',
            externalContextId: 'doc-1',
            dateOfRecordIso: '2026-05-01T00:00:00.000Z',
            verifiedAtIso: '2026-05-02T00:00:00.000Z',
            sourceLabel: 'Outside packet',
            documentType: 'medical_record_packet',
            substance: 'Penicillin',
            reaction: 'Anaphylaxis',
            severity: 'severe',
            sourcePage: 1,
            confidence: 'high',
          },
          {
            id: 'a2',
            externalContextId: 'doc-1',
            dateOfRecordIso: '2026-05-01T00:00:00.000Z',
            verifiedAtIso: '2026-05-02T00:00:00.000Z',
            sourceLabel: 'Outside packet',
            documentType: 'medical_record_packet',
            substance: 'Latex',
            reaction: 'Rash',
            severity: 'moderate',
            sourcePage: 1,
            confidence: 'medium',
          },
        ]}
        onOpenProblems={vi.fn()}
      />,
    );

    expect(screen.getByText('Penicillin · Latex')).toBeInTheDocument();
    expect(screen.queryByText(/allergies from verified records/i)).not.toBeInTheDocument();
  });
});
