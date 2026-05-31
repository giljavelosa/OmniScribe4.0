import type {
  ExternalContextMediaKind,
  ExternalContextStatus,
} from '@prisma/client';

import {
  ExtractionJsonSchema,
  type ExtractedAllergy,
  type ExtractedDiagnosis,
  type ExtractedLab,
  type ExtractedMedication,
  type ExtractedProcedure,
  type ExtractedVital,
} from '@/types/external-context-extraction';

export type ClinicalFactSourceKind = 'signed_visit' | 'verified_uploaded_record' | 'clinician_entered';

export type ClinicalFactDisplay = {
  id: string;
  factType:
    | 'medication'
    | 'allergy'
    | 'diagnosis'
    | 'lab'
    | 'procedure'
    | 'imaging'
    | 'rehab'
    | 'objectiveMeasure'
    | 'followUp'
    | 'document';
  label: string;
  value: string | null;
  status: string | null;
  sourceKind: ClinicalFactSourceKind;
  sourceLabel: string;
  sourceDate: string | null;
  verifiedAt: string | null;
  noteId?: string | null;
  documentId?: string | null;
  pageNumber?: number | null;
  sourceMatchLabel?: string | null;
};

export type VerifiedMedicationFact = {
  id: string;
  externalContextId: string;
  dateOfRecordIso: string;
  verifiedAtIso: string;
  sourceLabel: string | null;
  documentType: string;
  name: string;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  status: ExtractedMedication['status'];
  sourcePage: number;
  confidence: ExtractedMedication['confidence'];
};

export type VerifiedAllergyFact = {
  id: string;
  externalContextId: string;
  dateOfRecordIso: string;
  verifiedAtIso: string;
  sourceLabel: string | null;
  documentType: string;
  substance: string;
  reaction: string | null;
  severity: ExtractedAllergy['severity'];
  sourcePage: number;
  confidence: ExtractedAllergy['confidence'];
};

export type VerifiedProblemFact = {
  id: string;
  externalContextId: string;
  dateOfRecordIso: string;
  verifiedAtIso: string;
  sourceLabel: string | null;
  documentType: string;
  text: string;
  icdHint: string | null;
  status: ExtractedDiagnosis['status'];
  sourcePage: number;
  confidence: ExtractedDiagnosis['confidence'];
};

export type VerifiedLabFact = {
  id: string;
  externalContextId: string;
  dateOfRecordIso: string;
  verifiedAtIso: string;
  sourceLabel: string | null;
  documentType: string;
  name: string;
  value: string;
  unit: string | null;
  referenceRange: string | null;
  abnormalFlag: ExtractedLab['abnormalFlag'];
  collectedDate: string | null;
  sourcePage: number;
  confidence: ExtractedLab['confidence'];
};

export type VerifiedVitalFact = {
  id: string;
  externalContextId: string;
  dateOfRecordIso: string;
  verifiedAtIso: string;
  sourceLabel: string | null;
  documentType: string;
  type: string;
  value: string;
  unit: string | null;
  measuredDate: string | null;
  sourcePage: number;
  confidence: ExtractedVital['confidence'];
};

export type VerifiedProcedureFact = {
  id: string;
  externalContextId: string;
  dateOfRecordIso: string;
  verifiedAtIso: string;
  sourceLabel: string | null;
  documentType: string;
  text: string;
  date: string | null;
  sourcePage: number;
  confidence: ExtractedProcedure['confidence'];
};

export type VerifiedDocumentDomain = {
  key: 'medications' | 'allergies' | 'diagnoses' | 'labs' | 'vitals' | 'procedures';
  label: string;
  count: number;
};

export type VerifiedDocumentDomainSummary = {
  externalContextId: string;
  verifiedAtIso: string;
  sourceLabel: string | null;
  documentType: string;
  pageCount: number | null;
  indexedPageCount: number;
  domains: VerifiedDocumentDomain[];
  hasPageText: boolean;
};

type VerifiedDocumentRow = {
  id: string;
  dateOfRecord: Date;
  sourceLabel: string | null;
  status: ExternalContextStatus;
  mediaKind: ExternalContextMediaKind;
  verifiedAt: Date | null;
  pageCount?: number | null;
  _count?: { documentPages?: number };
  vettedExtractionJson: unknown;
};

export function buildVerifiedMedicationFacts(rows: VerifiedDocumentRow[]): VerifiedMedicationFact[] {
  const meds: VerifiedMedicationFact[] = [];

  for (const row of rows) {
    if (row.mediaKind !== 'DOCUMENT' || row.status !== 'READY' || !row.verifiedAt) continue;
    const parsed = ExtractionJsonSchema.safeParse(row.vettedExtractionJson);
    if (!parsed.success) continue;

    for (const medication of parsed.data.medications) {
      meds.push({
        id: [
          row.id,
          normalizeMedicationPart(medication.name),
          normalizeMedicationPart(medication.dose),
          normalizeMedicationPart(medication.route),
          normalizeMedicationPart(medication.frequency),
          medication.status,
        ].join(':'),
        externalContextId: row.id,
        dateOfRecordIso: row.dateOfRecord.toISOString(),
        verifiedAtIso: row.verifiedAt.toISOString(),
        sourceLabel: row.sourceLabel,
        documentType: parsed.data.documentType,
        name: medication.name,
        dose: medication.dose,
        route: medication.route,
        frequency: medication.frequency,
        status: medication.status,
        sourcePage: medication.sourcePage,
        confidence: medication.confidence,
      });
    }
  }

  const bySignature = new Map<string, VerifiedMedicationFact>();
  for (const med of meds) {
    const signature = [
      normalizeMedicationPart(med.name),
      normalizeMedicationPart(med.dose),
      normalizeMedicationPart(med.route),
      normalizeMedicationPart(med.frequency),
      med.status,
    ].join('|');
    const existing = bySignature.get(signature);
    if (!existing || med.dateOfRecordIso > existing.dateOfRecordIso) {
      bySignature.set(signature, med);
    }
  }

  return [...bySignature.values()].sort((a, b) => {
    const statusRank = medicationStatusRank(a.status) - medicationStatusRank(b.status);
    if (statusRank !== 0) return statusRank;
    const dateRank = b.dateOfRecordIso.localeCompare(a.dateOfRecordIso);
    if (dateRank !== 0) return dateRank;
    return a.name.localeCompare(b.name);
  });
}

export function buildVerifiedAllergyFacts(rows: VerifiedDocumentRow[]): VerifiedAllergyFact[] {
  const allergies: VerifiedAllergyFact[] = [];

  for (const row of rows) {
    if (row.mediaKind !== 'DOCUMENT' || row.status !== 'READY' || !row.verifiedAt) continue;
    const parsed = ExtractionJsonSchema.safeParse(row.vettedExtractionJson);
    if (!parsed.success) continue;

    for (const allergy of parsed.data.allergies) {
      allergies.push({
        id: [
          row.id,
          normalizeMedicationPart(allergy.substance),
          normalizeMedicationPart(allergy.reaction),
          allergy.severity,
        ].join(':'),
        externalContextId: row.id,
        dateOfRecordIso: row.dateOfRecord.toISOString(),
        verifiedAtIso: row.verifiedAt.toISOString(),
        sourceLabel: row.sourceLabel,
        documentType: parsed.data.documentType,
        substance: allergy.substance,
        reaction: allergy.reaction,
        severity: allergy.severity,
        sourcePage: allergy.sourcePage,
        confidence: allergy.confidence,
      });
    }
  }

  const bySignature = new Map<string, VerifiedAllergyFact>();
  for (const allergy of allergies) {
    const signature = [
      normalizeMedicationPart(allergy.substance),
      normalizeMedicationPart(allergy.reaction),
      allergy.severity,
    ].join('|');
    const existing = bySignature.get(signature);
    if (!existing || allergy.dateOfRecordIso > existing.dateOfRecordIso) {
      bySignature.set(signature, allergy);
    }
  }

  return [...bySignature.values()].sort((a, b) =>
    a.substance.localeCompare(b.substance),
  );
}

export function buildVerifiedProblemFacts(rows: VerifiedDocumentRow[]): VerifiedProblemFact[] {
  const problems: VerifiedProblemFact[] = [];

  for (const row of rows) {
    if (row.mediaKind !== 'DOCUMENT' || row.status !== 'READY' || !row.verifiedAt) continue;
    const parsed = ExtractionJsonSchema.safeParse(row.vettedExtractionJson);
    if (!parsed.success) continue;

    for (const diagnosis of parsed.data.diagnoses) {
      problems.push({
        id: [
          row.id,
          normalizeMedicationPart(diagnosis.text),
          normalizeMedicationPart(diagnosis.icdHint),
          diagnosis.status,
        ].join(':'),
        externalContextId: row.id,
        dateOfRecordIso: row.dateOfRecord.toISOString(),
        verifiedAtIso: row.verifiedAt.toISOString(),
        sourceLabel: row.sourceLabel,
        documentType: parsed.data.documentType,
        text: diagnosis.text,
        icdHint: diagnosis.icdHint,
        status: diagnosis.status,
        sourcePage: diagnosis.sourcePage,
        confidence: diagnosis.confidence,
      });
    }
  }

  const bySignature = new Map<string, VerifiedProblemFact>();
  for (const problem of problems) {
    const signature = [
      normalizeMedicationPart(problem.text),
      normalizeMedicationPart(problem.icdHint),
      problem.status,
    ].join('|');
    const existing = bySignature.get(signature);
    if (!existing || problem.dateOfRecordIso > existing.dateOfRecordIso) {
      bySignature.set(signature, problem);
    }
  }

  return [...bySignature.values()].sort((a, b) => {
    const statusRank = problemStatusRank(a.status) - problemStatusRank(b.status);
    if (statusRank !== 0) return statusRank;
    return a.text.localeCompare(b.text);
  });
}

export function buildVerifiedLabFacts(rows: VerifiedDocumentRow[]): VerifiedLabFact[] {
  const labs: VerifiedLabFact[] = [];

  for (const row of rows) {
    if (row.mediaKind !== 'DOCUMENT' || row.status !== 'READY' || !row.verifiedAt) continue;
    const parsed = ExtractionJsonSchema.safeParse(row.vettedExtractionJson);
    if (!parsed.success) continue;

    for (const lab of parsed.data.labs) {
      labs.push({
        id: [
          row.id,
          normalizeMedicationPart(lab.name),
          normalizeMedicationPart(lab.value),
          normalizeMedicationPart(lab.unit),
          normalizeMedicationPart(lab.collectedDate),
        ].join(':'),
        externalContextId: row.id,
        dateOfRecordIso: row.dateOfRecord.toISOString(),
        verifiedAtIso: row.verifiedAt.toISOString(),
        sourceLabel: row.sourceLabel,
        documentType: parsed.data.documentType,
        name: lab.name,
        value: lab.value,
        unit: lab.unit,
        referenceRange: lab.referenceRange,
        abnormalFlag: lab.abnormalFlag,
        collectedDate: lab.collectedDate,
        sourcePage: lab.sourcePage,
        confidence: lab.confidence,
      });
    }
  }

  const bySignature = new Map<string, VerifiedLabFact>();
  for (const lab of labs) {
    const signature = [
      normalizeMedicationPart(lab.name),
      normalizeMedicationPart(lab.value),
      normalizeMedicationPart(lab.unit),
      normalizeMedicationPart(lab.collectedDate),
    ].join('|');
    const existing = bySignature.get(signature);
    if (!existing || lab.dateOfRecordIso > existing.dateOfRecordIso) {
      bySignature.set(signature, lab);
    }
  }

  return [...bySignature.values()].sort((a, b) => {
    const dateA = a.collectedDate ?? a.dateOfRecordIso;
    const dateB = b.collectedDate ?? b.dateOfRecordIso;
    const dateRank = dateB.localeCompare(dateA);
    if (dateRank !== 0) return dateRank;
    return a.name.localeCompare(b.name);
  });
}

export function buildVerifiedVitalFacts(rows: VerifiedDocumentRow[]): VerifiedVitalFact[] {
  const vitals: VerifiedVitalFact[] = [];

  for (const row of rows) {
    if (row.mediaKind !== 'DOCUMENT' || row.status !== 'READY' || !row.verifiedAt) continue;
    const parsed = ExtractionJsonSchema.safeParse(row.vettedExtractionJson);
    if (!parsed.success) continue;

    for (const vital of parsed.data.vitals) {
      vitals.push({
        id: [
          row.id,
          normalizeMedicationPart(vital.type),
          normalizeMedicationPart(vital.value),
          normalizeMedicationPart(vital.unit),
          normalizeMedicationPart(vital.measuredDate),
        ].join(':'),
        externalContextId: row.id,
        dateOfRecordIso: row.dateOfRecord.toISOString(),
        verifiedAtIso: row.verifiedAt.toISOString(),
        sourceLabel: row.sourceLabel,
        documentType: parsed.data.documentType,
        type: vital.type,
        value: vital.value,
        unit: vital.unit,
        measuredDate: vital.measuredDate,
        sourcePage: vital.sourcePage,
        confidence: vital.confidence,
      });
    }
  }

  return vitals.sort((a, b) => {
    const dateA = a.measuredDate ?? a.dateOfRecordIso;
    const dateB = b.measuredDate ?? b.dateOfRecordIso;
    const dateRank = dateB.localeCompare(dateA);
    if (dateRank !== 0) return dateRank;
    return a.type.localeCompare(b.type);
  });
}

export function buildVerifiedProcedureFacts(rows: VerifiedDocumentRow[]): VerifiedProcedureFact[] {
  const procedures: VerifiedProcedureFact[] = [];

  for (const row of rows) {
    if (row.mediaKind !== 'DOCUMENT' || row.status !== 'READY' || !row.verifiedAt) continue;
    const parsed = ExtractionJsonSchema.safeParse(row.vettedExtractionJson);
    if (!parsed.success) continue;

    for (const procedure of parsed.data.procedures) {
      procedures.push({
        id: [
          row.id,
          normalizeMedicationPart(procedure.text),
          normalizeMedicationPart(procedure.date),
        ].join(':'),
        externalContextId: row.id,
        dateOfRecordIso: row.dateOfRecord.toISOString(),
        verifiedAtIso: row.verifiedAt.toISOString(),
        sourceLabel: row.sourceLabel,
        documentType: parsed.data.documentType,
        text: procedure.text,
        date: procedure.date,
        sourcePage: procedure.sourcePage,
        confidence: procedure.confidence,
      });
    }
  }

  const bySignature = new Map<string, VerifiedProcedureFact>();
  for (const procedure of procedures) {
    const signature = [
      normalizeMedicationPart(procedure.text),
      normalizeMedicationPart(procedure.date),
    ].join('|');
    const existing = bySignature.get(signature);
    if (!existing || procedure.dateOfRecordIso > existing.dateOfRecordIso) {
      bySignature.set(signature, procedure);
    }
  }

  return [...bySignature.values()].sort((a, b) => {
    const dateA = a.date ?? a.dateOfRecordIso;
    const dateB = b.date ?? b.dateOfRecordIso;
    const dateRank = dateB.localeCompare(dateA);
    if (dateRank !== 0) return dateRank;
    return a.text.localeCompare(b.text);
  });
}

export function buildVerifiedDocumentDomainSummaries(rows: VerifiedDocumentRow[]): VerifiedDocumentDomainSummary[] {
  const summaries: VerifiedDocumentDomainSummary[] = [];

  for (const row of rows) {
    if (row.mediaKind !== 'DOCUMENT' || row.status !== 'READY' || !row.verifiedAt) continue;
    const parsed = ExtractionJsonSchema.safeParse(row.vettedExtractionJson);
    if (!parsed.success) continue;
    const domains = ([
      { key: 'medications', label: 'Medications', count: parsed.data.medications.length },
      { key: 'allergies', label: 'Allergies', count: parsed.data.allergies.length },
      { key: 'diagnoses', label: 'Problems', count: parsed.data.diagnoses.length },
      { key: 'labs', label: 'Labs', count: parsed.data.labs.length },
      { key: 'vitals', label: 'Vitals', count: parsed.data.vitals.length },
      { key: 'procedures', label: 'Procedures / imaging', count: parsed.data.procedures.length },
    ] satisfies VerifiedDocumentDomain[]).filter((domain) => domain.count > 0);
    const indexedPageCount = row._count?.documentPages ?? 0;
    summaries.push({
      externalContextId: row.id,
      verifiedAtIso: row.verifiedAt.toISOString(),
      sourceLabel: row.sourceLabel,
      documentType: parsed.data.documentType,
      pageCount: row.pageCount ?? null,
      indexedPageCount,
      hasPageText: indexedPageCount > 0,
      domains,
    });
  }

  return summaries;
}

export function sourceMatchLabel(confidence: 'high' | 'medium' | 'low'): string {
  switch (confidence) {
    case 'high':
      return 'Clear source match';
    case 'medium':
      return 'Needs clinician check';
    case 'low':
      return 'Weak or unclear source';
  }
}

function normalizeMedicationPart(value: string | null): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function medicationStatusRank(status: ExtractedMedication['status']): number {
  switch (status) {
    case 'current':
      return 0;
    case 'planned':
      return 1;
    case 'unknown':
      return 2;
    case 'historical':
      return 3;
    case 'discontinued':
      return 4;
  }
}

function problemStatusRank(status: ExtractedDiagnosis['status']): number {
  switch (status) {
    case 'active':
      return 0;
    case 'historical':
      return 1;
    case 'resolved':
      return 2;
    case 'suspected':
      return 3;
    case 'unknown':
      return 4;
    case 'ruled_out':
      return 5;
  }
}
