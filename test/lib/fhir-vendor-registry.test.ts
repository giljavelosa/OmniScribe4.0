import { describe, expect, it } from 'vitest';

import { adaptResourceWithVendor } from '@/services/fhir/adapters';
import {
  EHR_VENDORS,
  extractMrn,
  getVendor,
  type VendorMetadata,
} from '@/services/fhir/vendor-registry';

describe('EHR_VENDORS registry', () => {
  it('lists exactly the v1 supported vendors', () => {
    expect(EHR_VENDORS.map((v) => v.id).sort()).toEqual(['cerner', 'epic', 'nextgen']);
  });

  it('only NextGen is active in v1; Epic + Cerner are planned', () => {
    expect(EHR_VENDORS.find((v) => v.id === 'nextgen')?.status).toBe('active');
    expect(EHR_VENDORS.find((v) => v.id === 'epic')?.status).toBe('planned');
    expect(EHR_VENDORS.find((v) => v.id === 'cerner')?.status).toBe('planned');
  });

  it('declares mrnIdentifierSystem for Epic + Cerner', () => {
    expect(EHR_VENDORS.find((v) => v.id === 'epic')?.mrnIdentifierSystem).toMatch(/^urn:oid:/);
    expect(EHR_VENDORS.find((v) => v.id === 'cerner')?.mrnIdentifierSystem).toMatch(/^urn:oid:/);
  });
});

describe('getVendor', () => {
  it('resolves a known vendor id', () => {
    expect(getVendor('nextgen')?.displayName).toBe('NextGen');
  });

  it('returns undefined for an unknown id', () => {
    expect(getVendor('athena')).toBeUndefined();
  });
});

describe('extractMrn', () => {
  const epicVendor: VendorMetadata = {
    id: 'epic',
    displayName: 'Epic',
    mrnIdentifierSystem: 'urn:oid:1.2.3',
    status: 'planned',
    enablementNote: '',
  };

  it('returns null for empty identifiers', () => {
    expect(extractMrn([])).toBeNull();
    expect(extractMrn(undefined)).toBeNull();
  });

  it('prefers the vendor-specific system OID match when set', () => {
    const mrn = extractMrn(
      [
        { type: { coding: [{ code: 'MR' }] }, value: 'wrong-mr-code-match' },
        { system: 'urn:oid:1.2.3', value: 'right-system-match' },
      ],
      epicVendor,
    );
    expect(mrn).toBe('right-system-match');
  });

  it('falls back to the FHIR R4 "MR" type-code when no system match', () => {
    const mrn = extractMrn(
      [
        { type: { coding: [{ code: 'MR' }] }, value: 'mr-type-match' },
        { value: 'other-value' },
      ],
      epicVendor,
    );
    expect(mrn).toBe('mr-type-match');
  });

  it('returns the first identifier value when neither system nor MR matches', () => {
    const mrn = extractMrn([{ value: 'fallback-1' }, { value: 'fallback-2' }]);
    expect(mrn).toBe('fallback-1');
  });

  it('vendor-blind call ignores system match + uses type-code match', () => {
    const mrn = extractMrn([
      { system: 'urn:oid:1.2.3', value: 'system-only' },
      { type: { coding: [{ code: 'MR' }] }, value: 'mr-code-match' },
    ]);
    expect(mrn).toBe('mr-code-match');
  });
});

describe('adaptResourceWithVendor — Patient', () => {
  it('uses the vendor-specific MRN extraction when vendor is passed', () => {
    const epic = getVendor('epic');
    const out = adaptResourceWithVendor(
      {
        resourceType: 'Patient',
        id: 'p1',
        name: [{ family: 'Doe', given: ['Jane'] }],
        gender: 'female',
        birthDate: '1985-04-12',
        identifier: [
          { type: { coding: [{ code: 'OTHER' }] }, value: 'non-mr' },
          { system: 'urn:oid:1.2.840.114350.1.13.0.1.7.5.737384.0', value: 'epic-mrn-42' },
        ],
      },
      epic,
    );
    expect(out).toEqual({
      given: ['Jane'],
      family: 'Doe',
      birthDate: '1985-04-12',
      gender: 'female',
      mrn: 'epic-mrn-42',
    });
  });

  it('falls back to the vendor-blind adapter when no vendor is passed', () => {
    const out = adaptResourceWithVendor({
      resourceType: 'Patient',
      id: 'p2',
      name: [{ family: 'Smith', given: ['John'] }],
      identifier: [{ type: { coding: [{ code: 'MR' }] }, value: 'MRN-1' }],
    });
    expect(out).toEqual({
      given: ['John'],
      family: 'Smith',
      birthDate: null,
      gender: null,
      mrn: 'MRN-1',
    });
  });

  it('non-Patient resources route through the standard adapter regardless of vendor', () => {
    const epic = getVendor('epic');
    const out = adaptResourceWithVendor(
      {
        resourceType: 'Condition',
        id: 'c1',
        code: { coding: [{ code: 'E11.9', display: 'Type 2 diabetes' }] },
        clinicalStatus: { coding: [{ code: 'active' }] },
      },
      epic,
    );
    expect(out).toMatchObject({ code: 'E11.9', display: 'Type 2 diabetes', clinicalStatus: 'active' });
  });
});
