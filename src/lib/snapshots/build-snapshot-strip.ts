import type { Division as PrismaDivision } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import type { PriorContextBriefContent } from '@/types/brief';

import {
  REHAB_MEASURES,
  MEDICAL_MEASURES,
  BH_MEASURES,
  type MeasureDef,
  type Division,
} from './registry';
import { derivePatientDivision, renderDivisionFor } from './division';
import type {
  PatientSnapshotStrip,
  SnapshotMeasure,
  SnapshotMeasureCase,
  SnapshotScope,
} from './types';

export const SNAPSHOT_GENERATOR_VERSION = 'snapshot-v2';

type BuildInput = {
  orgId: string;
  patientId: string;
  /**
   * Viewer's clinical lens. Drives sort order — the viewer's division's
   * measures float to the top of the strip. The strip still includes
   * measures from other divisions when the chart contains them, because a
   * rehab + medical clinician shouldn't be blind to a 180/100 BP on a PT
   * patient (or vice versa). Falls back to derivePatientDivision when
   * null/undefined (defensive — preserves the historical patient-centric
   * order for callers without a viewer in context).
   */
  viewerDivision?: PrismaDivision | null;
};

/**
 * buildSnapshotStrip — Unit 12 §7 compute-on-read pipeline.
 *
 * For the given patient:
 *   1. Load patient (with site), most-recent brief, active episode, org.
 *   2. Iterate the UNION of all registries (REHAB ∪ MEDICAL ∪ BH).
 *      The viewer's discipline drives only sort order, not membership —
 *      a PT looking at a hypertensive PT patient still sees the BP.
 *   3. For each registry def: fan out by case — emit one row per
 *      (measureKey, caseId) pair seen in the brief's objectiveMeasures.
 *      The case is resolved via Note → Encounter → CaseManagement on the
 *      source note. Overrides keep their original semantics (one per
 *      measureKey, no case fan-out — overrides don't carry case scope).
 *   4. Sort: viewer-division-first, then registry priority, then case
 *      label (deterministic).
 *
 * Returns null when the patient or org can't be found (defense; should
 * never happen on a real load).
 */
export async function buildSnapshotStrip(input: BuildInput): Promise<PatientSnapshotStrip | null> {
  const [patient, mostRecentBrief, activeEpisode] = await Promise.all([
    prisma.patient.findFirst({
      where: { id: input.patientId, orgId: input.orgId, isDeleted: false },
      include: {
        site: { select: { id: true, primaryDivision: true } },
      },
    }),
    prisma.noteBrief.findFirst({
      where: { patientId: input.patientId, orgId: input.orgId },
      orderBy: { generatedAt: 'desc' },
      select: { content: true, generatedAt: true },
    }),
    prisma.episodeOfCare.findFirst({
      where: {
        patientId: input.patientId,
        orgId: input.orgId,
        status: { in: ['ACTIVE', 'RECERT_DUE'] },
      },
      orderBy: { startedAt: 'desc' },
      select: { id: true, diagnosis: true, bodyPart: true, division: true },
    }),
  ]);
  if (!patient) return null;

  const org = await prisma.organization.findUnique({
    where: { id: input.orgId },
    select: { defaultDivision: true, division: true },
  });
  if (!org) return null;

  const fullDivision: PrismaDivision = input.viewerDivision
    ? input.viewerDivision
    : derivePatientDivision({
        activeEpisode: activeEpisode ? { division: activeEpisode.division } : null,
        site: patient.site ? { primaryDivision: patient.site.primaryDivision } : null,
        org,
      });
  const renderDivision = renderDivisionFor(fullDivision);
  if (fullDivision === 'MULTI') {
    console.debug('snapshot.multi.fallback', {
      patientId: input.patientId,
      fallback: renderDivision,
    });
  }

  // Union registry — all divisions' measures, viewer's discipline first.
  const unionRegistry = unionRegistryWithViewerFirst(renderDivision);
  const scope = pickScope({ registry: unionRegistry, activeEpisode });

  const overrideRows = await prisma.snapshotOverride.findMany({
    where: {
      patientId: input.patientId,
      orgId: input.orgId,
      supersededAt: null,
    },
  });
  const overrideByKey = new Map<string, (typeof overrideRows)[number]>();
  for (const o of overrideRows) {
    const sameScope =
      scope.kind === 'patient'
        ? o.episodeId === null
        : scope.kind === 'episode' && o.episodeId === scope.episodeId;
    if (sameScope) overrideByKey.set(o.measureKey, o);
  }

  const briefContent = (mostRecentBrief?.content ?? null) as PriorContextBriefContent | null;

  // Batch-resolve every distinct sourceNoteId in the brief → case row.
  const caseByNoteId = await resolveCasesForSourceNotes({
    orgId: input.orgId,
    sourceNoteIds: collectSourceNoteIds(briefContent),
  });

  const measures: SnapshotMeasure[] = [];
  for (const def of unionRegistry) {
    const override = overrideByKey.get(def.key);
    const extractedByCase = findExtractedMeasuresByCase(briefContent, def.key, caseByNoteId);

    // Override row first — overrides don't fan out by case today (scope is
    // patient or episode, not case-level). They render as a single card.
    if (override) {
      const firstExtractedForFallback = extractedByCase[0]?.[1];
      measures.push({
        measureKey: def.key,
        label: def.label,
        unit: override.unit ?? def.unit,
        value: stringifyOverrideValue(override.valueJson),
        trend: firstExtractedForFallback?.trend ?? 'unknown',
        source: 'manual',
        measureDivision: def.division,
        case: null,
        overrideId: override.id,
        overriddenByName: override.enteredByOrgUserId,
        overriddenAt: override.enteredAt.toISOString(),
        recordedAt: override.recordedAt.toISOString(),
        ...(firstExtractedForFallback?.lastValue
          ? { extractedFallbackValue: firstExtractedForFallback.lastValue }
          : {}),
      });
    }

    // Extracted measures — one row per distinct case that recorded this
    // measure. Skip cases already represented by the override row (the
    // override speaks for the no-case bucket).
    for (const [caseKey, extracted] of extractedByCase) {
      if (override && caseKey === '__no_case__') continue;
      measures.push({
        measureKey: def.key,
        label: def.label,
        unit: extracted.unit ?? def.unit,
        value: extracted.lastValue,
        trend: extracted.trend,
        source: 'extracted',
        measureDivision: def.division,
        case: extracted.case,
        extractedFromNoteId: extracted.sourceNoteId,
      });
    }
  }

  // Stable sort: registry order already places viewer-division first +
  // honors priority; tiebreaker by case label for determinism.
  measures.sort((a, b) => {
    const aIdx = unionRegistry.findIndex((m) => m.key === a.measureKey);
    const bIdx = unionRegistry.findIndex((m) => m.key === b.measureKey);
    if (aIdx !== bIdx) return aIdx - bIdx;
    const aLabel = a.case?.label ?? '';
    const bLabel = b.case?.label ?? '';
    return aLabel.localeCompare(bLabel);
  });

  return {
    scope,
    division: renderDivision,
    measures,
    generatedAt: new Date().toISOString(),
    generatorVersion: SNAPSHOT_GENERATOR_VERSION,
  };
}

/** Build the union registry sorted with viewer's discipline first.
 *  Within each block, original registry priority is preserved. */
function unionRegistryWithViewerFirst(viewer: Division): MeasureDef[] {
  const blocks: Record<Division, MeasureDef[]> = {
    REHAB: REHAB_MEASURES,
    MEDICAL: MEDICAL_MEASURES,
    BEHAVIORAL_HEALTH: BH_MEASURES,
  };
  const order: Division[] = [viewer, ...(['REHAB', 'MEDICAL', 'BEHAVIORAL_HEALTH'] as Division[]).filter((d) => d !== viewer)];
  return order.flatMap((d) => blocks[d]);
}

function pickScope(input: {
  registry: MeasureDef[];
  activeEpisode: { id: string; diagnosis: string; bodyPart: string | null } | null;
}): SnapshotScope {
  const hasEpisodeMeasures = input.registry.some((m) => m.scope === 'episode');
  if (hasEpisodeMeasures && input.activeEpisode) {
    return {
      kind: 'episode',
      episodeId: input.activeEpisode.id,
      episodeLabel:
        input.activeEpisode.bodyPart
          ? `${input.activeEpisode.diagnosis} (${input.activeEpisode.bodyPart})`
          : input.activeEpisode.diagnosis,
    };
  }
  return { kind: 'patient', patientId: '__patient_scope__' };
}

function collectSourceNoteIds(brief: PriorContextBriefContent | null): string[] {
  if (!brief) return [];
  return Array.from(new Set(brief.objectiveMeasures.map((m) => m.sourceNoteId).filter(Boolean)));
}

async function resolveCasesForSourceNotes(input: {
  orgId: string;
  sourceNoteIds: string[];
}): Promise<Map<string, SnapshotMeasureCase | null>> {
  const out = new Map<string, SnapshotMeasureCase | null>();
  if (input.sourceNoteIds.length === 0) return out;
  const rows = await prisma.note.findMany({
    where: { id: { in: input.sourceNoteIds }, orgId: input.orgId },
    select: {
      id: true,
      encounter: {
        select: {
          caseManagement: {
            select: { id: true, primaryIcd: true, primaryIcdLabel: true },
          },
        },
      },
    },
  });
  for (const r of rows) {
    const c = r.encounter?.caseManagement;
    if (!c) {
      out.set(r.id, null);
      continue;
    }
    out.set(r.id, {
      id: c.id,
      primaryIcd: c.primaryIcd,
      label: c.primaryIcdLabel,
    });
  }
  return out;
}

type ExtractedMeasure = {
  lastValue: string;
  unit: string | null;
  trend: SnapshotMeasure['trend'];
  sourceNoteId: string;
  case: SnapshotMeasureCase | null;
};

/** Returns one extracted entry per distinct case (keyed by case.id or
 *  '__no_case__'). If the brief has multiple entries with the same
 *  measureKey for the same case, the FIRST is kept (matches the legacy
 *  `.find(...)` semantics).
 *
 *  Entries are returned in case-first-seen order, which is the order the
 *  LLM emitted them — usually most-clinically-salient first within a
 *  visit, oldest visit first across visits. */
function findExtractedMeasuresByCase(
  brief: PriorContextBriefContent | null,
  measureKey: string,
  caseByNoteId: Map<string, SnapshotMeasureCase | null>,
): Array<[string, ExtractedMeasure]> {
  if (!brief) return [];
  const byCase = new Map<string, ExtractedMeasure>();
  for (const m of brief.objectiveMeasures) {
    if (m.measureKey !== measureKey) continue;
    const caseInfo = caseByNoteId.get(m.sourceNoteId) ?? null;
    const caseKey = caseInfo?.id ?? '__no_case__';
    if (byCase.has(caseKey)) continue;
    byCase.set(caseKey, {
      lastValue: m.lastValue,
      unit: m.unit ?? null,
      trend: m.trend,
      sourceNoteId: m.sourceNoteId,
      case: caseInfo,
    });
  }
  return Array.from(byCase.entries());
}

function stringifyOverrideValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    // Structured BP shape.
    if ('systolic' in v && 'diastolic' in v) return `${v.systolic}/${v.diastolic}`;
    return JSON.stringify(v);
  }
  return String(value);
}

/** Pure helper exposed for tests + the override route's auto-supersede
 *  pre-check. */
export type { Division };
