import { describe, it, expect } from 'vitest';
import { assertPhiFreeMetadata, PhiInAuditMetadataError } from '@/lib/audit/phi-free-check';

describe('PHI-free check', () => {
  it('rejects raw PHI keys', () => {
    expect(() => assertPhiFreeMetadata({ patientName: 'Doe' })).toThrow(PhiInAuditMetadataError);
    expect(() => assertPhiFreeMetadata({ mrn: 'A1' })).toThrow(PhiInAuditMetadataError);
    expect(() => assertPhiFreeMetadata({ ssn: '123' })).toThrow(PhiInAuditMetadataError);
    expect(() => assertPhiFreeMetadata({ dob: '1980-01-01' })).toThrow(PhiInAuditMetadataError);
    expect(() => assertPhiFreeMetadata({ transcript: 'hi' })).toThrow(PhiInAuditMetadataError);
  });

  it('normalizes case + separators when matching', () => {
    expect(() => assertPhiFreeMetadata({ Patient_Name: 'Doe' })).toThrow(PhiInAuditMetadataError);
    expect(() => assertPhiFreeMetadata({ 'PATIENT-NAME': 'Doe' })).toThrow(PhiInAuditMetadataError);
    expect(() => assertPhiFreeMetadata({ FirstName: 'X' })).toThrow(PhiInAuditMetadataError);
  });

  it('accepts non-PHI metadata', () => {
    expect(() => assertPhiFreeMetadata({ role: 'ADMIN', method: 'totp' })).not.toThrow();
    expect(() => assertPhiFreeMetadata({ before: {}, after: {} })).not.toThrow();
    expect(() => assertPhiFreeMetadata(null)).not.toThrow();
    expect(() => assertPhiFreeMetadata(undefined)).not.toThrow();
  });
});
