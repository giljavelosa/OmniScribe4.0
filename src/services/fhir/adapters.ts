import { extractMrn, type VendorMetadata } from './vendor-registry';

/**
 * Per-resource FHIR → simplified adapters — Unit 21.
 *
 * Pure functions. Each takes a raw FHIR resource and returns a simplified
 * shape the brief reader (Unit 22 / F4) can render in a one-line
 * summary. Both raw + simplified are stored under
 * `FhirCachedResource.resource` so F5's provenance UI can show either.
 *
 * The simplified shapes are deliberately narrow — wide enough for the
 * brief but not a mirror of the FHIR resource. Wide mirrors are a
 * future polish if downstream surfaces ever need more detail.
 *
 * Resource type set (v1): Patient + Condition + MedicationStatement +
 * MedicationRequest + Observation + AllergyIntolerance + Procedure +
 * DiagnosticReport. CarePlan + Goal are Wave 4.5.
 */

// =====================================================================
// Resource type constants
// =====================================================================

export const FHIR_RESOURCE_TYPES = [
  'Patient',
  'Condition',
  'MedicationStatement',
  'MedicationRequest',
  'Observation',
  'AllergyIntolerance',
  'Procedure',
  'DiagnosticReport',
] as const;

export type FhirResourceType = (typeof FHIR_RESOURCE_TYPES)[number];

// =====================================================================
// Simplified shapes — what F4's brief reader consumes
// =====================================================================

export type SimplifiedPatient = {
  given: string[];
  family: string;
  birthDate: string | null;
  gender: string | null;
  mrn: string | null;
};

export type SimplifiedCondition = {
  code: string | null;
  display: string | null;
  clinicalStatus: string | null;
  onsetDate: string | null;
  recordedDate: string | null;
};

export type SimplifiedMedicationStatement = {
  display: string | null;
  status: string | null;
  effectiveDate: string | null;
};

export type SimplifiedMedicationRequest = {
  display: string | null;
  status: string | null;
  intent: string | null;
  authoredOn: string | null;
};

export type SimplifiedObservation = {
  code: string | null;
  display: string | null;
  value: string | null;
  unit: string | null;
  effectiveDate: string | null;
  status: string | null;
};

export type SimplifiedAllergyIntolerance = {
  display: string | null;
  category: string | null;
  criticality: string | null;
  recordedDate: string | null;
};

export type SimplifiedProcedure = {
  display: string | null;
  status: string | null;
  performedDate: string | null;
};

export type SimplifiedDiagnosticReport = {
  display: string | null;
  status: string | null;
  effectiveDate: string | null;
  conclusion: string | null;
};

export type Simplified =
  | SimplifiedPatient
  | SimplifiedCondition
  | SimplifiedMedicationStatement
  | SimplifiedMedicationRequest
  | SimplifiedObservation
  | SimplifiedAllergyIntolerance
  | SimplifiedProcedure
  | SimplifiedDiagnosticReport;

// =====================================================================
// Adapter dispatch
// =====================================================================

type FhirResource = { resourceType: string; id?: string } & Record<string, unknown>;

/**
 * Dispatch by resourceType. Returns null for unknown types — keeps the
 * sync orchestrator from poisoning the cache with weird shapes.
 */
export function adaptResource(resource: FhirResource): Simplified | null {
  switch (resource.resourceType) {
    case 'Patient':
      return adaptPatient(resource);
    case 'Condition':
      return adaptCondition(resource);
    case 'MedicationStatement':
      return adaptMedicationStatement(resource);
    case 'MedicationRequest':
      return adaptMedicationRequest(resource);
    case 'Observation':
      return adaptObservation(resource);
    case 'AllergyIntolerance':
      return adaptAllergyIntolerance(resource);
    case 'Procedure':
      return adaptProcedure(resource);
    case 'DiagnosticReport':
      return adaptDiagnosticReport(resource);
    default:
      return null;
  }
}

/**
 * Vendor-aware dispatch — Unit 24 / F6. Most adapters are vendor-blind
 * (FHIR R4 standards), but Patient.mrn extraction varies by vendor
 * (NextGen 'MR' code; Epic + Cerner use system OIDs). Sync orchestrators
 * that know the EHR system call this entry point; pure-FHIR callers (e.g.
 * a test fixture rendering) keep using `adaptResource`.
 */
export function adaptResourceWithVendor(
  resource: FhirResource,
  vendor?: VendorMetadata,
): Simplified | null {
  if (resource.resourceType !== 'Patient' || !vendor) {
    return adaptResource(resource);
  }
  const name = (resource.name as Array<{ family?: string; given?: string[] }> | undefined)?.[0];
  return {
    given: name?.given ?? [],
    family: name?.family ?? '',
    birthDate: (resource.birthDate as string | undefined) ?? null,
    gender: (resource.gender as string | undefined) ?? null,
    mrn: extractMrn(
      resource.identifier as Array<{
        system?: string;
        value?: string;
        type?: { coding?: Array<{ code?: string }> };
      }> | undefined,
      vendor,
    ),
  };
}

// =====================================================================
// Per-resource adapters
// =====================================================================

function adaptPatient(r: FhirResource): SimplifiedPatient {
  const name = (r.name as Array<{ family?: string; given?: string[] }> | undefined)?.[0];
  // Default MRN extraction (vendor-blind; matches FHIR R4 'MR' type-code).
  // Vendor-aware extraction is exposed via the standalone extractMrn helper
  // in vendor-registry — callers that know the EHR system pass through
  // adaptResourceWithVendor() instead.
  const mrn = (r.identifier as Array<{
    value?: string;
    type?: { coding?: Array<{ code?: string }> };
  }> | undefined)?.find((i) => i.type?.coding?.some((c) => c.code === 'MR'));
  return {
    given: name?.given ?? [],
    family: name?.family ?? '',
    birthDate: (r.birthDate as string | undefined) ?? null,
    gender: (r.gender as string | undefined) ?? null,
    mrn: mrn?.value ?? null,
  };
}

function adaptCondition(r: FhirResource): SimplifiedCondition {
  const coding = firstCoding(r.code);
  const clinicalStatus = firstCoding(r.clinicalStatus);
  return {
    code: coding.code,
    display: coding.display,
    clinicalStatus: clinicalStatus.code,
    onsetDate: (r.onsetDateTime as string | undefined)?.slice(0, 10) ?? null,
    recordedDate: (r.recordedDate as string | undefined)?.slice(0, 10) ?? null,
  };
}

function adaptMedicationStatement(r: FhirResource): SimplifiedMedicationStatement {
  const med =
    (r.medicationCodeableConcept as { text?: string; coding?: Array<{ display?: string }> } | undefined) ??
    null;
  return {
    display: med?.text ?? med?.coding?.[0]?.display ?? null,
    status: (r.status as string | undefined) ?? null,
    effectiveDate: (r.effectiveDateTime as string | undefined)?.slice(0, 10) ?? null,
  };
}

function adaptMedicationRequest(r: FhirResource): SimplifiedMedicationRequest {
  const med =
    (r.medicationCodeableConcept as { text?: string; coding?: Array<{ display?: string }> } | undefined) ??
    null;
  return {
    display: med?.text ?? med?.coding?.[0]?.display ?? null,
    status: (r.status as string | undefined) ?? null,
    intent: (r.intent as string | undefined) ?? null,
    authoredOn: (r.authoredOn as string | undefined)?.slice(0, 10) ?? null,
  };
}

function adaptObservation(r: FhirResource): SimplifiedObservation {
  const coding = firstCoding(r.code);
  const value = r.valueQuantity as { value?: number; unit?: string } | undefined;
  const valueString = r.valueString as string | undefined;
  return {
    code: coding.code,
    display: coding.display,
    value: value?.value != null ? String(value.value) : valueString ?? null,
    unit: value?.unit ?? null,
    effectiveDate: (r.effectiveDateTime as string | undefined)?.slice(0, 10) ?? null,
    status: (r.status as string | undefined) ?? null,
  };
}

function adaptAllergyIntolerance(r: FhirResource): SimplifiedAllergyIntolerance {
  const coding = firstCoding(r.code);
  const categories = r.category as string[] | undefined;
  return {
    display: coding.display,
    category: categories?.[0] ?? null,
    criticality: (r.criticality as string | undefined) ?? null,
    recordedDate: (r.recordedDate as string | undefined)?.slice(0, 10) ?? null,
  };
}

function adaptProcedure(r: FhirResource): SimplifiedProcedure {
  const coding = firstCoding(r.code);
  return {
    display: coding.display,
    status: (r.status as string | undefined) ?? null,
    performedDate:
      (r.performedDateTime as string | undefined)?.slice(0, 10) ??
      (r.performedPeriod as { start?: string } | undefined)?.start?.slice(0, 10) ??
      null,
  };
}

function adaptDiagnosticReport(r: FhirResource): SimplifiedDiagnosticReport {
  const coding = firstCoding(r.code);
  return {
    display: coding.display,
    status: (r.status as string | undefined) ?? null,
    effectiveDate: (r.effectiveDateTime as string | undefined)?.slice(0, 10) ?? null,
    conclusion: (r.conclusion as string | undefined) ?? null,
  };
}

// =====================================================================
// Helpers
// =====================================================================

function firstCoding(
  field: unknown,
): { code: string | null; display: string | null } {
  if (!field || typeof field !== 'object') return { code: null, display: null };
  const wrapped = field as { coding?: Array<{ code?: string; display?: string }>; text?: string };
  const first = wrapped.coding?.[0];
  return {
    code: first?.code ?? null,
    display: first?.display ?? wrapped.text ?? null,
  };
}

/** Extract a sensitivity level from FHIR Resource.meta.security codes.
 *  v1 maps the common 42 CFR Part 2 codes to a coarse 'restricted' flag;
 *  more granular handling is F5 polish. */
export function extractSensitivityLevel(resource: FhirResource): string | null {
  const meta = resource.meta as
    | { security?: Array<{ system?: string; code?: string }> }
    | undefined;
  const security = meta?.security ?? [];
  for (const s of security) {
    // 'N' (Normal) is the default HL7 confidentiality and must NOT flag as
    // restricted — populating it would mark virtually every resource as
    // restricted. 'PROD' is a production-environment designation, not a
    // 42 CFR Part 2 sensitivity code.
    if (s.code && /^(R|ETH|HIV|PSY|SDV|SUD|GDIS|TBOO|DEMO)$/.test(s.code)) {
      return 'restricted';
    }
  }
  return null;
}
