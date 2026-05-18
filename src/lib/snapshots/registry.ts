/**
 * Per-division measure registry — Unit 12.
 *
 * Source of truth for the snapshot strip's allowed measures + their
 * display labels + units + priority order. Hardcoded in TS for v1;
 * per-org configurability deferred to Wave 2 templates work.
 *
 * Keys MUST match the Phase-13b registry keys baked into the brief
 * prompt (src/lib/notes/build-brief-prompt.ts MEASURE_KEY_BLOCK). Adding
 * a key here without adding it to the prompt's allowlist means the
 * extracted-measures path will never populate it — only manual overrides
 * + future FHIR rows will surface.
 */

export type Division = 'REHAB' | 'MEDICAL' | 'BEHAVIORAL_HEALTH';

export type MeasureDef = {
  key: string;
  label: string;
  /** Display unit (e.g. "mmHg", "/10"). null for unitless scores. */
  unit: string | null;
  /** Scope: 'episode' means the row is per-episode (rehab); 'patient'
   *  means per-patient (medical vitals, BH totals). */
  scope: 'patient' | 'episode';
  division: Division;
  /** Lower priority sorts first on the strip. */
  priority: number;
};

export const REHAB_MEASURES: MeasureDef[] = [
  { key: 'pain-nrs',           label: 'Pain',                unit: '/10',   scope: 'episode', division: 'REHAB', priority: 10 },
  { key: 'rom-primary',        label: 'ROM (primary)',       unit: '°',     scope: 'episode', division: 'REHAB', priority: 20 },
  { key: 'strength-primary',   label: 'Strength (MMT)',      unit: '/5',    scope: 'episode', division: 'REHAB', priority: 30 },
  { key: 'gait-speed',         label: 'Gait speed',          unit: 'm/s',   scope: 'episode', division: 'REHAB', priority: 40 },
  { key: 'outcome-tool-score', label: 'Outcome tool',        unit: 'score', scope: 'episode', division: 'REHAB', priority: 50 },
];

export const MEDICAL_MEASURES: MeasureDef[] = [
  { key: 'bp',     label: 'BP',     unit: 'mmHg', scope: 'patient', division: 'MEDICAL', priority: 10 },
  { key: 'hr',     label: 'HR',     unit: 'bpm',  scope: 'patient', division: 'MEDICAL', priority: 20 },
  { key: 'weight', label: 'Weight', unit: 'kg',   scope: 'patient', division: 'MEDICAL', priority: 30 },
  { key: 'bmi',    label: 'BMI',    unit: null,   scope: 'patient', division: 'MEDICAL', priority: 40 },
  { key: 'spo2',   label: 'SpO₂',   unit: '%',    scope: 'patient', division: 'MEDICAL', priority: 50 },
  { key: 'temp',   label: 'Temp',   unit: '°C',   scope: 'patient', division: 'MEDICAL', priority: 60 },
];

export const BH_MEASURES: MeasureDef[] = [
  { key: 'phq9-total',  label: 'PHQ-9',       unit: 'score', scope: 'patient', division: 'BEHAVIORAL_HEALTH', priority: 10 },
  { key: 'gad7-total',  label: 'GAD-7',       unit: 'score', scope: 'patient', division: 'BEHAVIORAL_HEALTH', priority: 20 },
  { key: 'mood-rating', label: 'Mood (0–10)', unit: '/10',   scope: 'patient', division: 'BEHAVIORAL_HEALTH', priority: 30 },
];

const REGISTRY_BY_DIVISION: Record<Division, MeasureDef[]> = {
  REHAB: REHAB_MEASURES,
  MEDICAL: MEDICAL_MEASURES,
  BEHAVIORAL_HEALTH: BH_MEASURES,
};

export function registryForDivision(d: Division): MeasureDef[] {
  return REGISTRY_BY_DIVISION[d] ?? [];
}

const BY_KEY: Map<string, MeasureDef> = new Map(
  [...REHAB_MEASURES, ...MEDICAL_MEASURES, ...BH_MEASURES].map((m) => [m.key, m]),
);

export function findMeasureDef(measureKey: string): MeasureDef | null {
  return BY_KEY.get(measureKey) ?? null;
}
