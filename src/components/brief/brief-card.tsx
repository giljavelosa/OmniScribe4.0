import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { PriorContextBriefContent } from '@/types/brief';

import { BriefHeader } from './brief-header';
import { BriefSection } from './brief-section';
import { TrajectoryTable, trajectoryDirectionGlyph } from './trajectory-table';
import { FollowUpPreviewList } from './follow-up-preview-list';
import { GoalsSnapshot } from './goals-snapshot';
import { WatchList, isWatchEmpty } from './watch-list';
import { BriefFooter, formatBriefAge } from './brief-footer';
import { EhrEnrichmentBlock } from './ehr-enrichment-block';

/**
 * BriefCard — top-level container for the prior-context brief. Renders on
 * /prepare and inside the /capture PriorContextPanel (expanded body).
 *
 * Section order matches the UI spec wireframe:
 *   1. Header (always)
 *   2. WHY (chiefConcern)
 *   3. LAST CLINICAL IMPRESSION (priorAssessment)
 *   4. TRAJECTORY (objective measures + direction glyph)
 *   5. LAST VISIT DID (interventionsPerformed + homeProgram + educationGiven)
 *   6. PLAN SAID FOR TODAY (carryForwardPlan)
 *   7. OPEN FOLLOW-UPS (preview list — read-only here; chips in capture)
 *   8. ACTIVE GOALS (collapsed by default)
 *   9. WATCH (collapsed by default; omitted entirely when empty)
 *   10. Footer (generation meta + provenance hint)
 *
 * `followUpsSlot` lets the capture screen swap the read-only list for the
 * action-chip variant without forking the whole card.
 */
export function BriefCard({
  content,
  patientName,
  followUpsSlot,
  nowMs,
  className,
}: {
  content: PriorContextBriefContent;
  /** Patient display name (first + last, or first + last initial per the
   *  caller's PHI posture) — rendered in the Miss Cleo attribution heading
   *  per Sprint 0.12. Required so the heading is never anonymous. */
  patientName: string;
  /** Optional override for the open-follow-ups slot (capture screen passes
   *  the interactive variant; prepare passes nothing). */
  followUpsSlot?: React.ReactNode;
  /** Caller-supplied "now" (epoch ms) so the footer's "X days ago" stays
   *  pure across re-renders. Required — page-level server components pass
   *  Date.now() once at request time. */
  nowMs: number;
  className?: string;
}) {
  const { daysOld, relativeLabel } = formatBriefAge(content.generatedAt, nowMs);
  const dir = trajectoryDirectionGlyph(content.trajectory?.direction ?? null);
  const episodeLabel = content.episodeContext?.label
    ? `${content.episodeContext.label}${
        content.episodeContext.visitNumber && content.episodeContext.plannedVisits
          ? `, week ${content.episodeContext.visitNumber} of ${content.episodeContext.plannedVisits}`
          : ''
      }`
    : null;

  const hasLastVisitDid =
    content.interventionsPerformed.length > 0 ||
    content.homeProgram ||
    content.educationGiven.length > 0;

  const watchEmpty = isWatchEmpty(content.watch);

  return (
    <Card className={className}>
      <CardHeader>
        <BriefHeader
          patientName={patientName}
          patientOneLine={content.patientOneLine}
          episodeLabel={episodeLabel}
          lastVisit={content.lastVisit}
        />
      </CardHeader>
      <CardContent className="space-y-5">
        {content.chiefConcern && (
          <BriefSection label="Why she's here">
            <p>{content.chiefConcern}</p>
          </BriefSection>
        )}

        {content.priorAssessment && (
          <BriefSection label="Last clinical impression">
            <p>{content.priorAssessment}</p>
            {content.trajectory?.summary && (
              <p className="mt-1 text-muted-foreground">{content.trajectory.summary}</p>
            )}
          </BriefSection>
        )}

        <BriefSection
          label="Trajectory"
          count={content.objectiveMeasures.length || undefined}
          trailing={
            dir.glyph ? (
              <span className={dir.color} aria-label={dir.label} title={dir.label}>
                {dir.glyph}
              </span>
            ) : undefined
          }
        >
          <TrajectoryTable measures={content.objectiveMeasures} />
        </BriefSection>

        <Separator />

        {hasLastVisitDid && (
          <BriefSection label="Last visit did" collapsible defaultExpanded={false}>
            <div className="space-y-2">
              {content.interventionsPerformed.length > 0 && (
                <ul className="list-disc pl-5">
                  {content.interventionsPerformed.map((i, idx) => (
                    <li key={idx}>{i}</li>
                  ))}
                </ul>
              )}
              {content.homeProgram && (
                <p>
                  <span className="text-xs uppercase tracking-wide text-muted-foreground mr-1">HEP:</span>
                  {content.homeProgram}
                </p>
              )}
              {content.educationGiven.length > 0 && (
                <p>
                  <span className="text-xs uppercase tracking-wide text-muted-foreground mr-1">Education:</span>
                  {content.educationGiven.join(' · ')}
                </p>
              )}
            </div>
          </BriefSection>
        )}

        {content.carryForwardPlan.length > 0 && (
          <BriefSection label="Plan said for today">
            <ul className="list-disc pl-5 space-y-1">
              {content.carryForwardPlan.map((p, idx) => (
                <li key={idx}>{p}</li>
              ))}
            </ul>
          </BriefSection>
        )}

        <BriefSection label="Open follow-ups" count={content.openFollowUps.length}>
          {followUpsSlot ?? <FollowUpPreviewList followUps={content.openFollowUps} />}
        </BriefSection>

        <BriefSection
          label="Active goals"
          count={content.topActiveGoals.length || undefined}
          collapsible
          defaultExpanded={false}
        >
          <GoalsSnapshot goals={content.topActiveGoals} />
        </BriefSection>

        {!watchEmpty && (
          <BriefSection label="Watch" collapsible defaultExpanded={false}>
            <WatchList watch={content.watch} />
          </BriefSection>
        )}

        <EhrEnrichmentBlock ehrEnrichment={content.ehrEnrichment} nowMs={nowMs} />

        <BriefFooter
          generatorVersion={content.generatorVersion}
          sourceNoteCount={content.sourceNoteIds.length}
          daysOld={daysOld}
          relativeLabel={relativeLabel}
        />
      </CardContent>
    </Card>
  );
}
