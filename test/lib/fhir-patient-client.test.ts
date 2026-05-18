import { describe, expect, it } from 'vitest';

import { searchPatients, type FhirIdentitySnapshot } from '@/services/fhir/patient-client';

/**
 * Stub-mode coverage. Real-mode (network-backed) Patient.read is
 * exercised end-to-end via the manual NextGen sandbox path; the
 * orchestration around it (token refresh + URL building) is exercised
 * indirectly through Unit 19's audit-pipeline tests. Here we lock the
 * stub synthesizer's shape so the matching UI's three-candidate
 * pattern stays predictable.
 */

const STUB_IDENTITY: FhirIdentitySnapshot = {
  id: 'fid-stub',
  fhirBaseUrl: 'https://stub.fhir.local/r4',
  ehrSystem: 'stub',
  accessTokenEnc: 'v1:ignored',
  refreshTokenEnc: 'v1:ignored',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  scope: 'patient/Patient.read',
};

describe('searchPatients (stub mode)', () => {
  it('returns 3 candidates per query', async () => {
    const results = await searchPatients({
      identity: STUB_IDENTITY,
      lastName: 'Smith',
      given: 'John',
      birthDate: '1972-05-12',
    });
    expect(results).toHaveLength(3);
  });

  it('first candidate is an exact match on the requested fields', async () => {
    const results = await searchPatients({
      identity: STUB_IDENTITY,
      lastName: 'Smith',
      given: 'John',
      birthDate: '1972-05-12',
    });
    const [exact] = results;
    expect(exact!.family).toBe('Smith');
    expect(exact!.given).toEqual(['John']);
    expect(exact!.birthDate).toBe('1972-05-12');
  });

  it('second candidate has a typo in the given name (same dob)', async () => {
    const results = await searchPatients({
      identity: STUB_IDENTITY,
      lastName: 'Smith',
      given: 'John',
      birthDate: '1972-05-12',
    });
    const [, close] = results;
    expect(close!.family).toBe('Smith');
    expect(close!.given[0]).not.toBe('John');
    expect(close!.birthDate).toBe('1972-05-12');
  });

  it('third candidate is a false positive (same name, dob shifted)', async () => {
    const results = await searchPatients({
      identity: STUB_IDENTITY,
      lastName: 'Smith',
      given: 'John',
      birthDate: '1972-05-12',
    });
    const [, , falsePositive] = results;
    expect(falsePositive!.family).toBe('Smith');
    expect(falsePositive!.given).toEqual(['John']);
    expect(falsePositive!.birthDate).toBe('1977-05-12');
  });

  it('rejects an all-empty query', async () => {
    await expect(
      searchPatients({ identity: STUB_IDENTITY }),
    ).rejects.toThrow(/at least one search field/);
  });

  it('synthesizes deterministic stable ids per seed', async () => {
    const a = await searchPatients({
      identity: STUB_IDENTITY,
      lastName: 'Smith',
      given: 'John',
      birthDate: '1972-05-12',
    });
    const b = await searchPatients({
      identity: STUB_IDENTITY,
      lastName: 'Smith',
      given: 'John',
      birthDate: '1972-05-12',
    });
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });
});
