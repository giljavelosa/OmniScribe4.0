import { prisma } from '@/lib/prisma';
import { isStale } from '@/lib/fhir/staleness';
import type {
  SimplifiedAllergyIntolerance,
  SimplifiedCondition,
  SimplifiedDiagnosticReport,
  SimplifiedMedicationRequest,
  SimplifiedMedicationStatement,
  SimplifiedObservation,
  SimplifiedProcedure,
} from '@/services/fhir/adapters';

/**
 * Project cached FHIR resources into the brief generator's
 * <external_ehr_context> shape — Unit 22 (Wave 4 / F4).
 *
 * Stale rows (>7d) are EXCLUDED per spec — better to surface no EHR
 * context than stale EHR context. Active-status filtering happens here
 * so the LLM doesn't have to puzzle through inactive/resolved noise.
 *
 * `loadExternalEhrContext` is the DB-backed entry point;
 * `projectCachedRows` is the pure projection over already-loaded rows
 * so tests don't need a database.
 */

export type FhirProvenance = {
  source: 'fhir';
  ehrSystem: string;
  fhirResourceType: string;
  fhirResourceId: string;
  fetchedAt: string;
};

export type ExternalEhrContext = {
  ehrSystem: string;
  activeConditions: Array<{
    display: string;
    code: string | null;
    onsetDate: string | null;
    provenance: FhirProvenance;
  }>;
  currentMedications: Array<{
    display: string;
    status: string;
    sourceType: 'MedicationStatement' | 'MedicationRequest';
    provenance: FhirProvenance;
  }>;
  allergies: Array<{
    display: string;
    category: string | null;
    criticality: string | null;
    provenance: FhirProvenance;
  }>;
  recentObservations: Array<{
    display: string;
    code: string | null;
    value: string;
    unit: string | null;
    effectiveDate: string | null;
    provenance: FhirProvenance;
  }>;
  recentProcedures: Array<{
    display: string;
    performedDate: string | null;
    provenance: FhirProvenance;
  }>;
  recentDiagnosticReports: Array<{
    display: string;
    effectiveDate: string | null;
    conclusion: string | null;
    provenance: FhirProvenance;
  }>;
};

type CachedRow = {
  resourceType: string;
  fhirResourceId: string;
  fetchedAt: Date;
  resource: { raw: unknown; simplified: unknown } | unknown;
};

const RECENT_OBSERVATION_LIMIT = 10;
const RECENT_PROCEDURE_LIMIT = 5;
const RECENT_REPORT_LIMIT = 5;

export async function loadExternalEhrContext(opts: {
  patientId: string;
  ehrSystem: string;
  now?: Date;
}): Promise<ExternalEhrContext | null> {
  const verifiedLink = await prisma.patientFhirIdentity.findFirst({
    where: {
      patientId: opts.patientId,
      ehrSystem: opts.ehrSystem,
      matchConfidence: 'verified',
    },
  });
  if (!verifiedLink) return null;

  const rows = await prisma.fhirCachedResource.findMany({
    where: { patientId: opts.patientId, ehrSystem: opts.ehrSystem },
    orderBy: { fetchedAt: 'desc' },
  });
  if (rows.length === 0) return null;

  return projectCachedRows({
    ehrSystem: opts.ehrSystem,
    rows,
    now: opts.now ?? new Date(),
  });
}

export function projectCachedRows(input: {
  ehrSystem: string;
  rows: CachedRow[];
  now: Date;
}): ExternalEhrContext | null {
  const fresh = input.rows.filter((r) => !isStale(r.fetchedAt, input.now));
  if (fresh.length === 0) return null;

  const conditions: ExternalEhrContext['activeConditions'] = [];
  const medications: ExternalEhrContext['currentMedications'] = [];
  const allergies: ExternalEhrContext['allergies'] = [];
  const observations: ExternalEhrContext['recentObservations'] = [];
  const procedures: ExternalEhrContext['recentProcedures'] = [];
  const reports: ExternalEhrContext['recentDiagnosticReports'] = [];

  for (const row of fresh) {
    const simplified = (row.resource as { simplified?: unknown })?.simplified;
    if (!simplified) continue;
    const provenance: FhirProvenance = {
      source: 'fhir',
      ehrSystem: input.ehrSystem,
      fhirResourceType: row.resourceType,
      fhirResourceId: row.fhirResourceId,
      fetchedAt: row.fetchedAt.toISOString(),
    };

    switch (row.resourceType) {
      case 'Condition': {
        const c = simplified as SimplifiedCondition;
        if (c.clinicalStatus === 'active' && c.display) {
          conditions.push({
            display: c.display,
            code: c.code,
            onsetDate: c.onsetDate,
            provenance,
          });
        }
        break;
      }
      case 'MedicationStatement': {
        const m = simplified as SimplifiedMedicationStatement;
        if ((m.status === 'active' || m.status === 'intended') && m.display) {
          medications.push({
            display: m.display,
            status: m.status,
            sourceType: 'MedicationStatement',
            provenance,
          });
        }
        break;
      }
      case 'MedicationRequest': {
        const m = simplified as SimplifiedMedicationRequest;
        if ((m.status === 'active' || m.status === 'on-hold') && m.display) {
          medications.push({
            display: m.display,
            status: m.status,
            sourceType: 'MedicationRequest',
            provenance,
          });
        }
        break;
      }
      case 'AllergyIntolerance': {
        const a = simplified as SimplifiedAllergyIntolerance;
        if (a.display) {
          allergies.push({
            display: a.display,
            category: a.category,
            criticality: a.criticality,
            provenance,
          });
        }
        break;
      }
      case 'Observation': {
        const o = simplified as SimplifiedObservation;
        if (o.value && (o.display || o.code)) {
          observations.push({
            display: o.display ?? o.code ?? 'observation',
            code: o.code,
            value: o.value,
            unit: o.unit,
            effectiveDate: o.effectiveDate,
            provenance,
          });
        }
        break;
      }
      case 'Procedure': {
        const p = simplified as SimplifiedProcedure;
        if (p.display) {
          procedures.push({
            display: p.display,
            performedDate: p.performedDate,
            provenance,
          });
        }
        break;
      }
      case 'DiagnosticReport': {
        const r = simplified as SimplifiedDiagnosticReport;
        if (r.display) {
          reports.push({
            display: r.display,
            effectiveDate: r.effectiveDate,
            conclusion: r.conclusion,
            provenance,
          });
        }
        break;
      }
      // Patient is in the cache but its identity already lives in the
      // brief's own patient projection; nothing to add here.
      default:
        break;
    }
  }

  // Sort + cap the "recent" categories. Most-recent first by effective date
  // when present, otherwise fall back to fetchedAt as a stable ordering.
  observations.sort((a, b) => byDateDesc(a.effectiveDate, b.effectiveDate));
  procedures.sort((a, b) => byDateDesc(a.performedDate, b.performedDate));
  reports.sort((a, b) => byDateDesc(a.effectiveDate, b.effectiveDate));

  return {
    ehrSystem: input.ehrSystem,
    activeConditions: conditions,
    currentMedications: medications,
    allergies,
    recentObservations: observations.slice(0, RECENT_OBSERVATION_LIMIT),
    recentProcedures: procedures.slice(0, RECENT_PROCEDURE_LIMIT),
    recentDiagnosticReports: reports.slice(0, RECENT_REPORT_LIMIT),
  };
}

function byDateDesc(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? 1 : a > b ? -1 : 0;
}
