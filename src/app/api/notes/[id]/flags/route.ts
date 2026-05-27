import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import {
  FLAG_ANALYSIS_RUN_CAP,
  computeSectionHashes,
  deriveFlagAnalysisState,
  hasEditsSinceLastAnalysis,
  parseSectionHashes,
} from '@/lib/notes/flag-analysis-state';
import type { NoteSectionDef } from '@/lib/notes/build-prompt';

export const runtime = 'nodejs';

/**
 * GET /api/notes/[id]/flags
 *
 * Lists all flags for a note grouped by severity. Includes
 * resolved/dismissed too (filtered client-side); the surface UI shows
 * the OPEN counts in the severity cards + the GREEN auto-resolved count.
 *
 * Sprint 0 lockdown — the `meta` envelope now carries everything the
 * panel + the sign client need to render the right state:
 *
 *   analysisState              — existing 'idle' | 'pending' | 'completed'
 *   runCount                   — total analyzer runs against this note
 *   runsRemaining              — FLAG_ANALYSIS_RUN_CAP - runCount (≥ 0)
 *   canReanalyze               — convenience boolean for the button
 *   editedSinceLastAnalysis    — does current draftJson differ from the
 *                                hash snapshot the last run stamped?
 *                                Drives the sign-time attestation gate
 *                                surfaced inline near the Sign button.
 *   editedSectionIds           — which sections were edited (UI hint).
 *   lastAnalysisCompletedAt    — drives "analyzed N minutes ago" copy.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_REVIEW');
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;

  const { id } = await params;
  const note = await prisma.note.findFirst({
    where: { id, orgId: authorizationUser.orgId },
    select: {
      id: true,
      orgId: true,
      flagAnalysisStartedAt: true,
      flagAnalysisCompletedAt: true,
      flagAnalysisRunCount: true,
      flagAnalysisSectionHashes: true,
      draftJson: true,
      template: { select: { sectionSchema: true } },
    },
  });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(note.orgId, authorizationUser.orgId);

  const flags = await prisma.reviewFlag.findMany({
    where: { noteId: id },
    orderBy: [{ status: 'asc' }, { severity: 'asc' }, { createdAt: 'desc' }],
  });

  const analysisState = deriveFlagAnalysisState({
    flagAnalysisStartedAt: note.flagAnalysisStartedAt,
    flagAnalysisCompletedAt: note.flagAnalysisCompletedAt,
  });

  // Edited-since-analysis detection. Falls open when we don't have
  // either a baseline snapshot or a template (degenerate cases: the
  // sign route's gate is also a no-op in those cases so the surface
  // is consistent).
  const sectionsDef =
    (note.template?.sectionSchema as { sections: NoteSectionDef[] } | null)?.sections ?? [];
  const priorHashes = parseSectionHashes(note.flagAnalysisSectionHashes);
  const currentHashes =
    sectionsDef.length > 0
      ? computeSectionHashes(
          note.draftJson as Record<string, { content?: string | null }> | null,
          sectionsDef.map((s) => s.id),
        )
      : {};
  const edited = hasEditsSinceLastAnalysis(priorHashes, currentHashes);
  const editedSectionIds: string[] = priorHashes
    ? Object.keys(currentHashes).filter(
        (id) => priorHashes[id] !== undefined && priorHashes[id] !== currentHashes[id],
      )
    : [];

  const runsRemaining = Math.max(0, FLAG_ANALYSIS_RUN_CAP - note.flagAnalysisRunCount);

  return NextResponse.json({
    data: flags.map((f) => ({
      id: f.id,
      sectionId: f.sectionId,
      severity: f.severity,
      status: f.status,
      claim: f.claim,
      rationale: f.rationale,
      evidence: f.evidence,
      suggestion: f.suggestion,
      confidence: f.confidence,
      resolvedAt: f.resolvedAt?.toISOString() ?? null,
      resolutionAction: f.resolutionAction,
      resolutionNote: f.resolutionNote,
      createdAt: f.createdAt.toISOString(),
    })),
    meta: {
      analysisState,
      flagAnalysisStartedAt: note.flagAnalysisStartedAt?.toISOString() ?? null,
      flagAnalysisCompletedAt: note.flagAnalysisCompletedAt?.toISOString() ?? null,
      runCount: note.flagAnalysisRunCount,
      runsRemaining,
      cap: FLAG_ANALYSIS_RUN_CAP,
      canReanalyze: runsRemaining > 0 && analysisState !== 'pending',
      editedSinceLastAnalysis: edited,
      editedSectionIds,
      lastAnalysisCompletedAt: note.flagAnalysisCompletedAt?.toISOString() ?? null,
    },
  });
}
