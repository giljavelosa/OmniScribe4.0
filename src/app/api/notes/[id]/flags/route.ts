import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import { deriveFlagAnalysisState } from '@/lib/notes/flag-analysis-state';

export const runtime = 'nodejs';

/**
 * GET /api/notes/[id]/flags
 *
 * Lists all flags for a note grouped by severity. Includes
 * resolved/dismissed too (filtered client-side); the surface UI shows
 * the OPEN counts in the severity cards + the GREEN auto-resolved count.
 *
 * Also returns the analyzer's lifecycle state so the polling client can
 * stop on `analysisState === 'completed'` rather than the brittle
 * "count unchanged" heuristic that produced the false-negative
 * "no flags surfaced" message while the worker was still running.
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
    },
  });
}
