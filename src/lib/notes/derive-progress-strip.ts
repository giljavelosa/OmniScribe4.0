import type { SectionStatusEntry, SectionStatusKind } from './section-status';
import type { NoteSectionDef } from './build-prompt';

export type ProgressStripCell = {
  sectionId: string;
  label: string;
  status: SectionStatusKind;
  isRequired: boolean;
};

/**
 * Pure derivation: given the template's section list + current
 * _sectionStatus, produce the strip cells the UI renders. Missing entries
 * default to 'empty'. The order matches the template.
 */
export function deriveProgressStrip(
  sections: NoteSectionDef[],
  sectionStatus: Record<string, SectionStatusEntry>,
): ProgressStripCell[] {
  return sections.map((s) => ({
    sectionId: s.id,
    label: s.label,
    status: sectionStatus[s.id]?.status ?? 'empty',
    isRequired: !!s.required,
  }));
}

export function isReadyForSign(cells: ProgressStripCell[]): boolean {
  // Every required section must be populated or edited (failed or generating
  // blocks sign).
  return cells.every((c) => {
    if (!c.isRequired) return true;
    return c.status === 'populated' || c.status === 'edited';
  });
}
