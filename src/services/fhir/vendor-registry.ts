/**
 * EHR vendor registry — Unit 24 / F6.
 *
 * Static metadata for the three vendors we plan to support. NextGen is
 * the only ACTIVE vendor in v1 (env-driven config via FHIR_NEXTGEN_*);
 * Epic + Cerner are PLANNED — adapter quirks are wired here so the
 * downstream paths (sync orchestrator, patient adapter) can branch
 * vendor-aware, but no live integration ships until a customer demands it.
 *
 * Adding a new vendor:
 *   1. Add an entry to EHR_VENDORS with the right id, displayName, and
 *      mrnIdentifierSystem.
 *   2. If the vendor needs different SMART scopes, extend the per-vendor
 *      metadata to carry them (don't fork smart-client.ts).
 *   3. Wire env vars + a new branch in the smart-client + admin UI
 *      enablement flow. THAT's a future unit, not F6.
 */

export type EhrVendor = 'nextgen' | 'epic' | 'cerner';

export type VendorMetadata = {
  id: EhrVendor;
  displayName: string;
  /** Vendor-specific Patient.identifier system OID for MRN. When set,
   *  the patient adapter prefers a system match over the generic 'MR'
   *  type-code match. Falls back to the type-code path for any vendor
   *  that doesn't populate this. */
  mrnIdentifierSystem?: string;
  /** 'active' = adapter wired + credentials configurable (NextGen v1).
   *  'planned' = adapter laid out but credentials NOT configurable —
   *  the admin UI shows the vendor with a "needs per-customer
   *  enablement" footnote. */
  status: 'active' | 'planned';
  /** One-line footnote shown in the admin UI's Supported EHRs panel
   *  next to the status chip. Tells the admin what's missing to flip
   *  'planned' → 'active'. */
  enablementNote: string;
};

export const EHR_VENDORS: VendorMetadata[] = [
  {
    id: 'nextgen',
    displayName: 'NextGen',
    status: 'active',
    enablementNote: 'Set FHIR_NEXTGEN_CLIENT_ID / _SECRET / _REDIRECT_URI in env to flip stub mode off.',
  },
  {
    id: 'epic',
    displayName: 'Epic',
    // Real Epic sandbox MRN system OID (publicly documented; example value).
    mrnIdentifierSystem: 'urn:oid:1.2.840.114350.1.13.0.1.7.5.737384.0',
    status: 'planned',
    enablementNote: 'Adapter ready; client credentials need a per-customer Epic app.',
  },
  {
    id: 'cerner',
    displayName: 'Cerner',
    mrnIdentifierSystem: 'urn:oid:2.16.840.1.113883.6.1000',
    status: 'planned',
    enablementNote: 'Adapter ready; client credentials need a per-customer Cerner app.',
  },
];

export function getVendor(id: string): VendorMetadata | undefined {
  return EHR_VENDORS.find((v) => v.id === id);
}

/** Vendor-aware MRN extraction. Used by the Patient adapter (Unit 21)
 *  + identity-match candidate simplification (Unit 20).
 *
 *  Strategy: if the vendor declares an mrnIdentifierSystem, prefer an
 *  identifier whose `system` matches. Otherwise fall back to the FHIR
 *  R4 'MR' type-code match. Otherwise return the first identifier value.
 *  Returns null if no identifier exists at all. */
export function extractMrn(
  identifiers: Array<{
    system?: string;
    value?: string;
    type?: { coding?: Array<{ code?: string }> };
  }> | undefined,
  vendor?: VendorMetadata,
): string | null {
  if (!identifiers || identifiers.length === 0) return null;
  if (vendor?.mrnIdentifierSystem) {
    const bySystem = identifiers.find((i) => i.system === vendor.mrnIdentifierSystem);
    if (bySystem?.value) return bySystem.value;
  }
  const byType = identifiers.find((i) => i.type?.coding?.some((c) => c.code === 'MR'));
  if (byType?.value) return byType.value;
  return identifiers[0]?.value ?? null;
}
