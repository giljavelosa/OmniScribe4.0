import { prisma } from '@/lib/prisma';
import type { PriorContextBriefContent } from '@/types/brief';

import {
  registryForDivision,
  type MeasureDef,
  type Division,
} from './registry';
import { derivePatientDivision, renderDivisionFor } from './division';
import type {
  PatientSnapshotStrip,
  SnapshotMeasure,
  SnapshotScope,
} from './types';

export const SNAPSHOT_GENERATOR_VERSION = 'snapshot-v1';

type BuildInput = {
  orgId: string;
  patientId: string;
};

/**
 * buildSnapshotStrip — Unit 12 §7 compute-on-read pipeline.
 *
 * For the given patient:
 *   1. Load active episode (status ACTIVE or RECERT_DUE; most recent),
 *      patient.site (with primaryDivision), org (defaultDivision +
 *      division).
 *   2. Derive division via derivePatientDivision; collapse MULTI → REHAB.
 *   3. Pick scope: episode-scoped when an active episode exists AND the
 *      registry for the division has any episode-scoped measures; else
 *      patient-scoped.
 *   4. For each MeasureDef in the registry: query latest non-superseded
 *      SnapshotOverride for (measureKey, scope). Hit → manual row. Miss
 *      → look up the most recent brief.content.objectiveMeasures entry
 *      whose measureKey matches → extracted row. Miss both → omit.
 *   5. Sort by registry priority. Return PatientSnapshotStrip.
 *
 * Returns null when there's no patient + division to derive against
 * (defense; should never happen on a real load).
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

  const fullDivision = derivePatientDivision({
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

  const registry = registryForDivision(renderDivision);
  const scope = pickScope({ registry, activeEpisode });

  // Overrides: pull all non-superseded for the patient at once + index by
  // (measureKey, scopeKey) so the per-measure resolve is in-memory.
  //
  // `enteredByOrgUserId` is a scalar (not a relation) — see schema. The
  // consumer below reads it as a raw id; if we later need the OrgUser
  // row, batch-fetch by id rather than per-row include.
  const overrideRows = await prisma.snapshotOverride.findMany({
    where: {
      patientId: input.patientId,
      orgId: input.orgId,
      supersededAt: null,
    },
  });
  // Index overrides by (measureKey, scopeMatch).
  const overrideByKey = new Map<string, (typeof overrideRows)[number]>();
  for (const o of overrideRows) {
    // Override matches the current scope if either both scopes are
    // patient-wide (episodeId null) OR the episodeId matches.
    const sameScope =
      scope.kind === 'patient'
        ? o.episodeId === null
        : scope.kind === 'episode' && o.episodeId === scope.episodeId;
    if (sameScope) overrideByKey.set(o.measureKey, o);
  }

  const briefContent = (mostRecentBrief?.content ?? null) as PriorContextBriefContent | null;

  const measures: SnapshotMeasure[] = [];
  for (const def of registry) {
    const override = overrideByKey.get(def.key);
    const extracted = findExtractedMeasure(briefContent, def.key);

    if (override) {
      measures.push({
        measureKey: def.key,
        label: def.label,
        unit: override.unit ?? def.unit,
        value: stringifyOverrideValue(override.valueJson),
        trend: extracted?.trend ?? 'unknown',
        source: 'manual',
        overrideId: override.id,
        overriddenByName: override.enteredByOrgUserId,
        overriddenAt: override.enteredAt.toISOString(),
        recordedAt: override.recordedAt.toISOString(),
        ...(extracted?.lastValue ? { extractedFallbackValue: extracted.lastValue } : {}),
      });
    } else if (extracted) {
      measures.push({
        measureKey: def.key,
        label: def.label,
        unit: extracted.unit ?? def.unit,
        value: extracted.lastValue,
        trend: extracted.trend,
        source: 'extracted',
        extractedFromNoteId: extracted.sourceNoteId,
      });
    }
    // both miss → omit
  }

  // Already in registry order; explicit sort for safety against future
  // registry reordering at runtime.
  measures.sort((a, b) => {
    const aDef = registry.find((m) => m.key === a.measureKey);
    const bDef = registry.find((m) => m.key === b.measureKey);
    return (aDef?.priority ?? 99) - (bDef?.priority ?? 99);
  });

  return {
    scope,
    division: renderDivision,
    measures,
    generatedAt: new Date().toISOString(),
    generatorVersion: SNAPSHOT_GENERATOR_VERSION,
  };
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

function findExtractedMeasure(
  brief: PriorContextBriefContent | null,
  measureKey: string,
): { lastValue: string; unit: string | null; trend: SnapshotMeasure['trend']; sourceNoteId: string } | null {
  if (!brief) return null;
  const match = brief.objectiveMeasures.find((m) => m.measureKey === measureKey);
  if (!match) return null;
  return {
    lastValue: match.lastValue,
    unit: match.unit ?? null,
    trend: match.trend,
    sourceNoteId: match.sourceNoteId,
  };
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
