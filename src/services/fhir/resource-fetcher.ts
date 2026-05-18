import { decryptToken, encryptToken } from '@/lib/fhir/token-crypto';
import { prisma } from '@/lib/prisma';
import {
  refreshAccessToken,
  resolveSmartConfig,
  smartConfig,
} from '@/services/fhir/smart-client';
import type { FhirResourceType } from '@/services/fhir/adapters';

/**
 * Generic FHIR resource fetcher for Unit 21 sync. Same token-refresh +
 * URL-building pattern as patient-client; returns the raw FHIR Bundle.
 *
 * Stub mode synthesizes 2-3 entries per resource type — enough to
 * exercise the cache writer + brief enrichment paths.
 */

const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const DEFAULT_COUNT = 50;

export type FetcherIdentity = {
  id: string;
  fhirBaseUrl: string;
  ehrSystem: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  expiresAt: Date;
  scope: string;
};

export type FhirBundleEntry = {
  resource: { resourceType: string; id?: string } & Record<string, unknown>;
};

export type FhirBundle = {
  resourceType: 'Bundle';
  entry?: FhirBundleEntry[];
};

export async function fetchResourceBundle(opts: {
  identity: FetcherIdentity;
  resourceType: FhirResourceType;
  fhirPatientId: string;
}): Promise<FhirBundle> {
  if (smartConfig.isStubMode) {
    return synthesizeStubBundle(opts.resourceType, opts.fhirPatientId);
  }
  const accessToken = await ensureFreshToken(opts.identity);
  const url = new URL(joinUrl(opts.identity.fhirBaseUrl, opts.resourceType));
  // Patient resource is the patient themselves — search by _id, not by `patient`.
  if (opts.resourceType === 'Patient') {
    url.searchParams.set('_id', opts.fhirPatientId);
  } else {
    url.searchParams.set('patient', opts.fhirPatientId);
  }
  url.searchParams.set('_count', String(DEFAULT_COUNT));
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/fhir+json',
    },
  });
  if (!res.ok) {
    throw new Error(`${opts.resourceType} search returned ${res.status}`);
  }
  return (await res.json()) as FhirBundle;
}

async function ensureFreshToken(identity: FetcherIdentity): Promise<string> {
  if (identity.expiresAt.getTime() > Date.now() + REFRESH_BUFFER_MS) {
    return decryptToken(identity.accessTokenEnc);
  }
  const refreshPlaintext = decryptToken(identity.refreshTokenEnc);
  const ehrConfig = await resolveSmartConfig(identity.fhirBaseUrl);
  const next = await refreshAccessToken({
    tokenEndpoint: ehrConfig.tokenEndpoint,
    refreshToken: refreshPlaintext,
  });
  const newExpiresAt = new Date(Date.now() + next.expiresInSeconds * 1000);
  await prisma.fhirIdentity.update({
    where: { id: identity.id },
    data: {
      accessTokenEnc: encryptToken(next.accessToken),
      refreshTokenEnc: encryptToken(next.refreshToken),
      scope: next.scope,
      expiresAt: newExpiresAt,
      refreshedAt: new Date(),
    },
  });
  identity.accessTokenEnc = encryptToken(next.accessToken);
  identity.refreshTokenEnc = encryptToken(next.refreshToken);
  identity.expiresAt = newExpiresAt;
  identity.scope = next.scope;
  return next.accessToken;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

// =====================================================================
// Stub-mode bundle synthesis
// =====================================================================

/**
 * Per resource type, return a Bundle with 2-3 plausible entries seeded
 * off the patient's FHIR id so repeated syncs in the same dev session
 * produce stable rows.
 */
function synthesizeStubBundle(resourceType: FhirResourceType, fhirPatientId: string): FhirBundle {
  const seed = `${resourceType}:${fhirPatientId}`;
  const factories: Record<FhirResourceType, () => FhirBundleEntry[]> = {
    Patient: () => [
      {
        resource: {
          resourceType: 'Patient',
          id: fhirPatientId,
          name: [{ family: 'Stub', given: ['Patient'] }],
          gender: 'unknown',
          birthDate: '1980-01-01',
          identifier: [{ type: { coding: [{ code: 'MR' }] }, value: `MRN-${fhirPatientId.slice(-6).toUpperCase()}` }],
        },
      },
    ],
    Condition: () => [
      {
        resource: {
          resourceType: 'Condition',
          id: `${stableId(seed, 1)}`,
          code: { text: 'Type 2 diabetes mellitus', coding: [{ code: 'E11.9', display: 'Type 2 diabetes mellitus' }] },
          clinicalStatus: { coding: [{ code: 'active' }] },
          onsetDateTime: '2019-03-15',
          recordedDate: '2019-03-20',
        },
      },
      {
        resource: {
          resourceType: 'Condition',
          id: `${stableId(seed, 2)}`,
          code: { text: 'Essential hypertension', coding: [{ code: 'I10', display: 'Essential hypertension' }] },
          clinicalStatus: { coding: [{ code: 'active' }] },
          onsetDateTime: '2017-11-02',
          recordedDate: '2017-11-02',
        },
      },
    ],
    MedicationStatement: () => [
      {
        resource: {
          resourceType: 'MedicationStatement',
          id: `${stableId(seed, 1)}`,
          status: 'active',
          medicationCodeableConcept: { text: 'metformin 500 mg oral tablet' },
          effectiveDateTime: '2024-01-15',
        },
      },
      {
        resource: {
          resourceType: 'MedicationStatement',
          id: `${stableId(seed, 2)}`,
          status: 'active',
          medicationCodeableConcept: { text: 'lisinopril 10 mg oral tablet' },
          effectiveDateTime: '2024-01-15',
        },
      },
    ],
    MedicationRequest: () => [
      {
        resource: {
          resourceType: 'MedicationRequest',
          id: `${stableId(seed, 1)}`,
          status: 'active',
          intent: 'order',
          medicationCodeableConcept: { text: 'atorvastatin 20 mg oral tablet' },
          authoredOn: '2025-08-12',
        },
      },
    ],
    Observation: () => [
      {
        resource: {
          resourceType: 'Observation',
          id: `${stableId(seed, 1)}`,
          status: 'final',
          code: { coding: [{ code: '4548-4', display: 'Hemoglobin A1c' }] },
          valueQuantity: { value: 7.2, unit: '%' },
          effectiveDateTime: '2025-09-04',
        },
      },
      {
        resource: {
          resourceType: 'Observation',
          id: `${stableId(seed, 2)}`,
          status: 'final',
          code: { coding: [{ code: '85354-9', display: 'Blood pressure systolic & diastolic' }] },
          valueString: '132/84 mmHg',
          effectiveDateTime: '2026-01-12',
        },
      },
    ],
    AllergyIntolerance: () => [
      {
        resource: {
          resourceType: 'AllergyIntolerance',
          id: `${stableId(seed, 1)}`,
          code: { text: 'Penicillin', coding: [{ display: 'Penicillin' }] },
          category: ['medication'],
          criticality: 'high',
          recordedDate: '2010-06-21',
        },
      },
    ],
    Procedure: () => [
      {
        resource: {
          resourceType: 'Procedure',
          id: `${stableId(seed, 1)}`,
          status: 'completed',
          code: { text: 'Appendectomy', coding: [{ display: 'Appendectomy' }] },
          performedDateTime: '2005-08-30',
        },
      },
    ],
    DiagnosticReport: () => [
      {
        resource: {
          resourceType: 'DiagnosticReport',
          id: `${stableId(seed, 1)}`,
          status: 'final',
          code: { text: 'Lipid panel', coding: [{ display: 'Lipid panel' }] },
          effectiveDateTime: '2025-09-04',
          conclusion: 'LDL elevated; recommend continued statin therapy.',
        },
      },
    ],
  };
  return {
    resourceType: 'Bundle',
    entry: factories[resourceType](),
  };
}

function stableId(seed: string, n: number): string {
  let h = n;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  }
  return `stub-${Math.abs(h).toString(36).slice(0, 10)}`;
}
