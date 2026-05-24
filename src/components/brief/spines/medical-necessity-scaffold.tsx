import { BriefSection } from '../brief-section';
import { SourcePill } from '../source-pill';
import type { MedicalNecessity } from '@/types/brief-intent-shapes';

/**
 * Unit 48 PR3 — medical-necessity talking-point scaffold for the REHAB
 * Progress Note spine. Three labeled fields:
 *   - Remaining functional limitations
 *   - Why skilled care is still required
 *   - Justification for continuing the POC vs. discharge
 *
 * These are TALKING POINTS the clinician says out loud during the visit
 * — Cleo extracts what's grounded in the chart, never asserts a
 * recommendation as fact (Rule 23 / Rule 24).
 *
 * Each field renders with a source pill when the spine attached one.
 * When `data` is missing (LLM dropped the section), the component
 * renders a banner instead of crashing — matches the "spine sections
 * degrade gracefully" requirement.
 */
export function MedicalNecessityScaffold({
  data,
}: {
  data: MedicalNecessity | null | undefined;
}) {
  if (!data) {
    return (
      <BriefSection label="Medical necessity">
        <p className="text-sm text-muted-foreground">
          Medical-necessity scaffold unavailable for this brief — speak from
          the prior assessment / last Progress Note.
        </p>
      </BriefSection>
    );
  }
  return (
    <BriefSection label="Medical necessity">
      <div className="space-y-3" data-testid="medical-necessity-scaffold">
        <ScaffoldField
          label="Remaining functional limitations"
          value={data.remainingLimitations}
        />
        <ScaffoldField
          label="Why skilled care is still required"
          value={data.whySkilledCare}
        />
        <ScaffoldField
          label="Justification for continuing the POC"
          value={data.pocJustification}
        />
        {data.source && (
          <SourcePill noteId={data.source.noteId} date={data.source.date} />
        )}
      </div>
    </BriefSection>
  );
}

function ScaffoldField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5" data-testid="medical-necessity-field" data-label={label}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm">{value}</p>
    </div>
  );
}
