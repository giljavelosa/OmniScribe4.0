import { describe, it, expect } from 'vitest';

import { detectAttestedScansOnFile } from '@/services/copilot/state-builder';

describe('detectAttestedScansOnFile', () => {
  it('emits one pattern per attested upload', () => {
    const patterns = detectAttestedScansOnFile([
      {
        id: 'up_1',
        kind: 'LAB_REPORT',
        attestedAt: new Date('2026-05-01'),
        captureContext: null,
      },
    ]);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.kind).toBe('attested_scan_on_file');
    expect(patterns[0]?.label).toContain('Lab report');
  });
});
