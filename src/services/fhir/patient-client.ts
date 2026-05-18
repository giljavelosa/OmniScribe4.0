import { decryptToken, encryptToken } from '@/lib/fhir/token-crypto';
import { prisma } from '@/lib/prisma';
import {
  refreshAccessToken,
  resolveSmartConfig,
  smartConfig,
} from '@/services/fhir/smart-client';

/**
 * FHIR Patient client — Unit 20 (Wave 4 / F2).
 *
 * Thin wrapper around the EHR's Patient.read + Patient.search endpoints.
 * The full FHIR Patient resource is sprawling; we surface a simplified
 * candidate shape for the matching UI + audit metadata. F3 (Unit 21)
 * will read full resources for the brief; this unit only needs enough
 * to render a "Is this the right person?" picker.
 *
 * Stub mode (FHIR_NEXTGEN_CLIENT_ID unset): searchPatients synthesizes
 * three candidates per query — one exact match, one close-but-not-exact,
 * one false positive. Lets the clinician practice the confirmation UI
 * without a real EHR.
 *
 * Token handling: each call decrypts the FhirIdentity tokens on demand
 * + auto-refreshes if expiresAt < now + 5min. The new tokens are
 * persisted before the upstream call fires, so a parallel call sees the
 * fresh value instead of triple-refreshing.
 */

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export type FhirPatientCandidate = {
  /** EHR-side Patient.id (e.g. "12345"). NOT a HIPAA Safe Harbor identifier. */
  id: string;
  given: string[];
  family: string;
  /** YYYY-MM-DD (FHIR Patient.birthDate is date-typed, never datetime). */
  birthDate: string | null;
  /** First non-MR identifier or the MR identifier value (the EHR's MRN if exposed). */
  identifier: string | null;
  gender: 'male' | 'female' | 'other' | 'unknown' | null;
};

export type FhirIdentitySnapshot = {
  id: string;
  fhirBaseUrl: string;
  ehrSystem: string;
  /** Encrypted at rest. Decrypted lazily by the client. */
  accessTokenEnc: string;
  refreshTokenEnc: string;
  expiresAt: Date;
  scope: string;
};

export type SearchPatientsInput = {
  identity: FhirIdentitySnapshot;
  lastName?: string;
  given?: string;
  birthDate?: string;
  identifier?: string;
};

export type ReadPatientInput = {
  identity: FhirIdentitySnapshot;
  fhirPatientId: string;
};

/** GET /Patient?…  Returns up to 20 simplified candidates. */
export async function searchPatients(input: SearchPatientsInput): Promise<FhirPatientCandidate[]> {
  if (!hasAnyCriteria(input)) {
    throw new Error('searchPatients: at least one search field required');
  }
  if (smartConfig.isStubMode) {
    return synthesizeStubCandidates(input);
  }
  const accessToken = await ensureFreshToken(input.identity);
  const url = new URL(joinUrl(input.identity.fhirBaseUrl, 'Patient'));
  if (input.lastName) url.searchParams.set('family', input.lastName);
  if (input.given) url.searchParams.set('given', input.given);
  if (input.birthDate) url.searchParams.set('birthdate', input.birthDate);
  if (input.identifier) url.searchParams.set('identifier', input.identifier);
  url.searchParams.set('_count', '20');
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/fhir+json',
    },
  });
  if (!res.ok) {
    throw new Error(`Patient search returned ${res.status}`);
  }
  const bundle = (await res.json()) as FhirBundle;
  return (bundle.entry ?? [])
    .map((e) => e.resource)
    .filter((r): r is FhirPatientResource => r?.resourceType === 'Patient')
    .map(simplifyFhirPatient);
}

/** GET /Patient/{id}. Returns one candidate or null on 404. */
export async function readPatient(input: ReadPatientInput): Promise<FhirPatientCandidate | null> {
  if (smartConfig.isStubMode) {
    return synthesizeStubCandidate(input.fhirPatientId);
  }
  const accessToken = await ensureFreshToken(input.identity);
  const url = joinUrl(input.identity.fhirBaseUrl, `Patient/${encodeURIComponent(input.fhirPatientId)}`);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/fhir+json',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Patient/${input.fhirPatientId} returned ${res.status}`);
  }
  const resource = (await res.json()) as FhirPatientResource;
  if (resource.resourceType !== 'Patient') return null;
  return simplifyFhirPatient(resource);
}

/** Lazy refresh + persist. Returns the plaintext access token. */
async function ensureFreshToken(identity: FhirIdentitySnapshot): Promise<string> {
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
  // Mutate the snapshot so subsequent calls in the same request reuse it.
  identity.accessTokenEnc = encryptToken(next.accessToken);
  identity.refreshTokenEnc = encryptToken(next.refreshToken);
  identity.expiresAt = newExpiresAt;
  identity.scope = next.scope;
  return next.accessToken;
}

function hasAnyCriteria(input: SearchPatientsInput): boolean {
  return Boolean(input.lastName || input.given || input.birthDate || input.identifier);
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

// =====================================================================
// FHIR Patient resource → simplified candidate
// =====================================================================

type FhirPatientResource = {
  resourceType: 'Patient';
  id: string;
  name?: Array<{ family?: string; given?: string[] }>;
  birthDate?: string;
  gender?: 'male' | 'female' | 'other' | 'unknown';
  identifier?: Array<{ system?: string; value?: string; type?: { coding?: Array<{ code?: string }> } }>;
};

type FhirBundle = {
  resourceType: 'Bundle';
  entry?: Array<{ resource?: FhirPatientResource }>;
};

function simplifyFhirPatient(p: FhirPatientResource): FhirPatientCandidate {
  const name = p.name?.[0];
  const mrn = p.identifier?.find((i) => i.type?.coding?.some((c) => c.code === 'MR'));
  const identifier = mrn?.value ?? p.identifier?.[0]?.value ?? null;
  return {
    id: p.id,
    given: name?.given ?? [],
    family: name?.family ?? '',
    birthDate: p.birthDate ?? null,
    identifier,
    gender: p.gender ?? null,
  };
}

// =====================================================================
// Stub-mode candidate synthesis
// =====================================================================

function synthesizeStubCandidates(input: SearchPatientsInput): FhirPatientCandidate[] {
  const family = input.lastName ?? 'Doe';
  const given = input.given ?? 'Jane';
  const dob = input.birthDate ?? '1980-01-01';
  const seed = `${family}:${given}:${dob}`.toLowerCase();
  return [
    {
      // Exact match — what the clinician is looking for in the happy path.
      id: `stub-pat-${hashFromSeed(seed)}-1`,
      given: [given],
      family,
      birthDate: dob,
      identifier: `MRN-${hashFromSeed(seed).toUpperCase()}`,
      gender: 'unknown',
    },
    {
      // Close-but-not-exact (typo'd given name) — practice the careful read.
      id: `stub-pat-${hashFromSeed(seed)}-2`,
      given: [misspell(given)],
      family,
      birthDate: dob,
      identifier: `MRN-${hashFromSeed(seed + ':alt').toUpperCase()}`,
      gender: 'unknown',
    },
    {
      // False positive (same name, different dob) — make sure clinician notices.
      id: `stub-pat-${hashFromSeed(seed)}-3`,
      given: [given],
      family,
      birthDate: shiftYearBy(dob, 5),
      identifier: `MRN-${hashFromSeed(seed + ':wrong').toUpperCase()}`,
      gender: 'unknown',
    },
  ];
}

function synthesizeStubCandidate(fhirPatientId: string): FhirPatientCandidate {
  return {
    id: fhirPatientId,
    given: ['Stub'],
    family: 'Patient',
    birthDate: '1980-01-01',
    identifier: `MRN-${fhirPatientId.toUpperCase()}`,
    gender: 'unknown',
  };
}

function hashFromSeed(seed: string): string {
  // Tiny deterministic hash so the candidate ids are stable per-seed
  // without pulling crypto into the stub path.
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).slice(0, 8);
}

function misspell(s: string): string {
  if (s.length < 3) return s + 'x';
  // Swap chars at index 1 and 2 — common typo + obvious to read.
  return `${s.charAt(0)}${s.charAt(2)}${s.charAt(1)}${s.slice(3)}`;
}

function shiftYearBy(iso: string, deltaYears: number): string {
  const [y, m, d] = iso.split('-');
  if (!y) return iso;
  return `${(parseInt(y, 10) + deltaYears).toString().padStart(4, '0')}-${m}-${d}`;
}
