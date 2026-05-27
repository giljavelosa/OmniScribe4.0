/**
 * Snapshot strip types — Unit 12.
 *
 * The wire shape on GET /api/patients/[id].snapshotStrip. Drives the
 * PatientSnapshotStrip component on /patients/[id].
 *
 * FHIR row support reserved at the type layer (source: 'fhir') but never
 * emitted in v1; Wave 4 FHIR work lights it up without a UI change.
 */

export type SnapshotSource = 'extracted' | 'manual' | 'fhir';

/** Case the measure came from — only present on extracted measures whose
 *  source note is linked to a CaseManagement. Null for ad-hoc visits
 *  without a case and for manual overrides (overrides don't carry case
 *  scope today). */
export type SnapshotMeasureCase = {
  id: string;
  /** ICD-10 code, e.g. "M25.551". null when the case has no primary ICD. */
  primaryIcd: string | null;
  /** Human label used in the strip — "Right hip pain" / "Rotator Cuff Injury". */
  label: string;
};

/** Division of the measure's registry def — drives grouping/sorting on the
 *  strip so the viewer's own discipline floats to the top. */
export type SnapshotMeasureDivision = 'REHAB' | 'MEDICAL' | 'BEHAVIORAL_HEALTH';

/** A single measure card on the snapshot strip. */
export type SnapshotMeasure = {
  measureKey: string;
  label: string;
  unit: string | null;
  value: string;
  /** Trend vs the prior reading: improving / stable / worsening / unknown. */
  trend: 'improving' | 'stable' | 'worsening' | 'unknown';
  source: SnapshotSource;
  /** Division of the measure's registry def — drives the viewer-discipline-first
   *  sort + lets the UI group across divisions. */
  measureDivision: SnapshotMeasureDivision;
  /** Case the measure came from. Null for measures with no case linkage
   *  (ad-hoc visits) or manual overrides. */
  case: SnapshotMeasureCase | null;
  /** When source='extracted', the source note id. */
  extractedFromNoteId?: string;
  /** When source='manual', who entered the override + when. */
  overrideId?: string;
  overriddenByName?: string;
  overriddenAt?: string;
  recordedAt?: string;
  /** When source='extracted', the value we'd fall back to if the
   *  user revokes the override. Surfaced in the override tooltip. */
  extractedFallbackValue?: string;
};

export type SnapshotScope =
  | { kind: 'episode'; episodeId: string; episodeLabel: string }
  | { kind: 'patient'; patientId: string };

/**
 * The full snapshot strip payload. measures.length is 0-6 (the registry
 * guarantees up to 6 slots; under-population is acceptable — the strip
 * auto-shrinks when measures aren't available).
 *
 * generatorVersion lets future cache-busting (precompute path) detect
 * stale rows.
 */
export type PatientSnapshotStrip = {
  scope: SnapshotScope;
  /** Render division — never 'MULTI' on the wire. The MULTI handling
   *  rule (M1: fall back to REHAB) collapses MULTI into REHAB before
   *  emitting. */
  division: 'REHAB' | 'MEDICAL' | 'BEHAVIORAL_HEALTH';
  measures: SnapshotMeasure[];
  generatedAt: string;
  generatorVersion: string;
};
