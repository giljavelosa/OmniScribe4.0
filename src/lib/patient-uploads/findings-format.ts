import type { PatientUploadKind } from '@prisma/client';

/**
 * Pure formatter that converts a PatientUpload's structured extraction
 * (`extractedJson` / `attestedJson`) into a list of human-readable
 * sections for <ScanReviewSheet>.
 *
 * Why this exists
 * ---------------
 * The original component dumped `JSON.stringify(json, null, 2)` into a
 * `<pre>` whenever it didn't have a hand-written branch for the kind.
 * Five of the seven `PatientUploadKind` values (OUTSIDE_RECORDS,
 * INSURANCE_CARD, ID_CARD, OTHER, plus the catch-all default) hit that
 * fallback, so a clinician opening one of those scans saw raw JSON
 * with curly braces and key names — which the user reported as a
 * UX bug on 2026-05-25 (screenshot showed `{ "dateIso": …, "summary":
 * "MRI brain without contrast…" }` in a code block).
 *
 * This module is the single source of truth for "how do we describe
 * the structured fields for kind X to a clinician?" Each branch
 * matches the prompt the worker sends to the vision LLM in
 * `src/workers/patient-upload-extract/handler.ts:systemPromptFor()`,
 * so adding a new kind means updating both files together (and the
 * test file pins that contract).
 *
 * The formatter NEVER throws on malformed input — a stub-mode
 * extraction or a partial response just produces a "Nothing
 * structured…" fallback; the underlying JSON is preserved on the row
 * for audit either way.
 */

export type FindingsSection = {
  /** Title shown to the clinician, e.g. "Document date", "Medications". */
  label: string;
  /** Either a single paragraph (string) or a bullet list (string[]). */
  value: string | string[];
};

export type FindingsResult = {
  sections: FindingsSection[];
  /** True when no recognizable fields could be extracted from `json`.
   *  The UI renders an empty-state message instead of empty sections. */
  isEmpty: boolean;
};

/**
 * Build the structured section list for a given upload kind.
 *
 * The branches mirror the prompts in `systemPromptFor()`:
 *   - MED_LIST       → { medications: [{ name, dose, frequency, route }] }
 *   - LAB_REPORT     → { collectionDateIso, labs: [{ name, value, unit, refLow, refHigh, flag }] }
 *   - IMAGING_REPORT → { studyType, dateIso, findings, impression }
 *   - INSURANCE_CARD → { carrier, memberId, groupId, planName }
 *   - ID_CARD        → { lastName, firstName, dob, idNumber }
 *   - OUTSIDE_RECORDS→ { summary, dateIso, diagnoses[], medications[] }
 *   - OTHER / default→ { summary } (or any object — we render its keys)
 */
export function buildFindings(
  kind: PatientUploadKind,
  json: unknown,
): FindingsResult {
  if (!json || typeof json !== 'object') {
    return { sections: [], isEmpty: true };
  }
  const o = json as Record<string, unknown>;

  switch (kind) {
    case 'MED_LIST':
      return formatMedList(o);
    case 'LAB_REPORT':
      return formatLabReport(o);
    case 'IMAGING_REPORT':
      return formatImagingReport(o);
    case 'INSURANCE_CARD':
      return formatInsuranceCard(o);
    case 'ID_CARD':
      return formatIdCard(o);
    case 'OUTSIDE_RECORDS':
      return formatOutsideRecords(o);
    case 'OTHER':
    default:
      return formatGeneric(o);
  }
}

function formatMedList(o: Record<string, unknown>): FindingsResult {
  const meds = Array.isArray(o.medications)
    ? (o.medications as Array<Record<string, unknown>>)
    : [];
  if (meds.length === 0) return { sections: [], isEmpty: true };
  const lines = meds
    .map((m) => {
      const parts = [
        str(m.name),
        str(m.dose),
        str(m.frequency),
        str(m.route),
      ].filter(Boolean);
      return parts.join(' · ');
    })
    .filter(Boolean);
  if (lines.length === 0) return { sections: [], isEmpty: true };
  return {
    sections: [{ label: 'Medications', value: lines }],
    isEmpty: false,
  };
}

function formatLabReport(o: Record<string, unknown>): FindingsResult {
  const labs = Array.isArray(o.labs)
    ? (o.labs as Array<Record<string, unknown>>)
    : [];
  const sections: FindingsSection[] = [];
  const collectionDate = formatDateLong(str(o.collectionDateIso));
  if (collectionDate) {
    sections.push({ label: 'Collection date', value: collectionDate });
  }
  const lines = labs
    .map((l) => {
      const name = str(l.name) ?? '?';
      const value = str(l.value) ?? '?';
      const unit = str(l.unit) ?? '';
      const flag = str(l.flag);
      const ref =
        str(l.refLow) && str(l.refHigh)
          ? ` (ref ${l.refLow}–${l.refHigh}${unit ? ` ${unit}` : ''})`
          : '';
      return `${name}: ${value}${unit ? ` ${unit}` : ''}${flag ? ` [${flag}]` : ''}${ref}`.trim();
    })
    .filter(Boolean);
  if (lines.length > 0) {
    sections.push({ label: 'Labs', value: lines });
  }
  return { sections, isEmpty: sections.length === 0 };
}

function formatImagingReport(o: Record<string, unknown>): FindingsResult {
  const sections: FindingsSection[] = [];
  if (str(o.studyType)) sections.push({ label: 'Study', value: str(o.studyType)! });
  const date = formatDateLong(str(o.dateIso));
  if (date) sections.push({ label: 'Study date', value: date });
  if (str(o.findings)) sections.push({ label: 'Findings', value: str(o.findings)! });
  if (str(o.impression)) sections.push({ label: 'Impression', value: str(o.impression)! });
  return { sections, isEmpty: sections.length === 0 };
}

function formatInsuranceCard(o: Record<string, unknown>): FindingsResult {
  const sections: FindingsSection[] = [];
  if (str(o.carrier)) sections.push({ label: 'Carrier', value: str(o.carrier)! });
  if (str(o.planName)) sections.push({ label: 'Plan', value: str(o.planName)! });
  if (str(o.memberId)) sections.push({ label: 'Member ID', value: str(o.memberId)! });
  if (str(o.groupId)) sections.push({ label: 'Group ID', value: str(o.groupId)! });
  return { sections, isEmpty: sections.length === 0 };
}

function formatIdCard(o: Record<string, unknown>): FindingsResult {
  const sections: FindingsSection[] = [];
  const fullName = [str(o.firstName), str(o.lastName)].filter(Boolean).join(' ');
  if (fullName) sections.push({ label: 'Name', value: fullName });
  const dob = formatDateLong(str(o.dob));
  if (dob) sections.push({ label: 'Date of birth', value: dob });
  if (str(o.idNumber)) sections.push({ label: 'ID number', value: str(o.idNumber)! });
  return { sections, isEmpty: sections.length === 0 };
}

function formatOutsideRecords(o: Record<string, unknown>): FindingsResult {
  const sections: FindingsSection[] = [];
  const date = formatDateLong(str(o.dateIso));
  if (date) sections.push({ label: 'Document date', value: date });
  if (str(o.summary)) sections.push({ label: 'Summary', value: str(o.summary)! });
  const dx = Array.isArray(o.diagnoses)
    ? (o.diagnoses as unknown[]).map(str).filter((x): x is string => !!x)
    : [];
  if (dx.length > 0) sections.push({ label: 'Diagnoses mentioned', value: dx });
  const meds = Array.isArray(o.medications)
    ? (o.medications as unknown[]).map(str).filter((x): x is string => !!x)
    : [];
  if (meds.length > 0) sections.push({ label: 'Medications mentioned', value: meds });
  return { sections, isEmpty: sections.length === 0 };
}

/**
 * Generic fallback for OTHER + the default branch — walks every
 * top-level key, prettifies the camelCase key as a label, and renders
 * primitives / string arrays sensibly. Anything more nested than that
 * (objects-of-objects) gets rendered as a single line of compact JSON
 * so the user at least sees something rather than nothing — never a
 * full multi-line JSON dump like the original fallback.
 */
function formatGeneric(o: Record<string, unknown>): FindingsResult {
  const sections: FindingsSection[] = [];
  for (const [key, raw] of Object.entries(o)) {
    if (raw == null || raw === '') continue;
    const label = humanizeKey(key);
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      // Special-case "dateIso" / "dob" / "*Date" string fields so the
      // generic branch doesn't lag behind the kind-specific branches.
      const looksLikeDate = /date|dob/i.test(key) && typeof raw === 'string';
      const formatted = looksLikeDate ? (formatDateLong(raw) ?? raw) : String(raw);
      sections.push({ label, value: formatted });
      continue;
    }
    if (Array.isArray(raw)) {
      const lines = raw.map(str).filter((x): x is string => !!x);
      if (lines.length > 0) sections.push({ label, value: lines });
      continue;
    }
    if (typeof raw === 'object') {
      // Last-resort one-liner — never the multi-line JSON dump.
      sections.push({ label, value: JSON.stringify(raw) });
    }
  }
  return { sections, isEmpty: sections.length === 0 };
}

// ---------- helpers ----------

function str(x: unknown): string | undefined {
  if (typeof x !== 'string') return undefined;
  const t = x.trim();
  return t.length > 0 ? t : undefined;
}

/** "2025-04-30" → "April 30, 2025"; falls through to undefined for
 *  anything that doesn't parse. Locale-fixed to en-US so test
 *  assertions stay deterministic across CI environments. */
function formatDateLong(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** "memberId" → "Member id"; "studyType" → "Study type". Naive but
 *  sufficient for the generic branch's labels. The kind-specific
 *  branches above use hand-curated copy. */
function humanizeKey(key: string): string {
  const spaced = key.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
