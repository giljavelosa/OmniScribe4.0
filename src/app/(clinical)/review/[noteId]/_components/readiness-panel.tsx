'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { IntentFitChip } from '@/components/copilot/intent-fit-chip';
import type { ProgressStripCell } from '@/lib/notes/derive-progress-strip';

type Props = {
  noteId: string;
  cells: ProgressStripCell[];
  readyForSign: boolean;
  noteStatus: string;
  /** Unit 49 §G — when set, renders a SOFT pre-sign chip below the
   *  panel's body and above the Sign button. Non-null only when the
   *  org has `cleo.caseRule.v1` ON AND the encounter's intent doesn't
   *  match the attached case's ICD. The chip is informational — sign
   *  is NOT blocked by a misfit. */
  cleoIntentFit?: { reason: string; matchedIcd: string | null } | null;
};

/**
 * Readiness panel — right side on desktop, collapsible on mobile (mobile
 * collapse handled by parent layout). Surfaces what's blocking sign:
 *   - Required sections not populated/edited
 *   - Compliance flags (Unit 14 will surface AI flags here too)
 *   - Open follow-ups from prior visit (Unit 06 will populate)
 *
 * For Unit 05 we ship section-completeness only; the AI-flag + follow-up
 * surfaces are stubs noting which units fill them in.
 */
export function ReadinessPanel({ noteId, cells, readyForSign, noteStatus, cleoIntentFit = null }: Props) {
  const required = cells.filter((c) => c.isRequired);
  const requiredDone = required.filter((c) => c.status === 'populated' || c.status === 'edited');
  const requiredBlocked = required.filter((c) => c.status !== 'populated' && c.status !== 'edited');
  const optionalEmpty = cells.filter((c) => !c.isRequired && c.status === 'empty');

  const isSigned = noteStatus === 'SIGNED';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-md">Readiness</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex items-center gap-2">
          <StatusBadge variant={readyForSign ? 'success' : 'warning'}>
            {readyForSign ? 'Ready to sign' : 'Not ready'}
          </StatusBadge>
          <span className="text-muted-foreground">
            {requiredDone.length} / {required.length} required sections
          </span>
        </div>

        {requiredBlocked.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Required, not yet ready</p>
            <ul className="space-y-1">
              {requiredBlocked.map((c) => (
                <li key={c.sectionId} className="flex items-center justify-between">
                  <span>{c.label}</span>
                  <StatusBadge variant={c.status === 'failed' ? 'danger' : 'warning'} noIcon>
                    {c.status}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          </div>
        )}

        {optionalEmpty.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Optional, empty</p>
            <ul className="space-y-1 text-muted-foreground">
              {optionalEmpty.map((c) => (
                <li key={c.sectionId}>{c.label}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="border-t border-border pt-3 space-y-2">
          <p className="text-xs text-muted-foreground italic">
            AI compliance flags (Unit 14) + open follow-ups from prior visits (Unit 06) will surface here.
          </p>
        </div>

        {cleoIntentFit && !isSigned && <IntentFitChip reason={cleoIntentFit.reason} />}

        {!isSigned && (
          <Button asChild className="w-full" disabled={!readyForSign}>
            <Link href={`/sign/${noteId}`}>Continue to sign →</Link>
          </Button>
        )}
        {isSigned && (
          <StatusBadge variant="success" className="w-full justify-center">Signed</StatusBadge>
        )}
      </CardContent>
    </Card>
  );
}
