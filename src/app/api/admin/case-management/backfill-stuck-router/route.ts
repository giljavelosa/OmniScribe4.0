import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';

const MAX_PER_SWEEP = 500;
const BACKFILL_LABEL = 'Uncategorized care';
const BACKFILL_DESCRIPTION_PREFIX = 'Backfilled from PENDING_ROUTER on';

/**
 * POST /api/admin/case-management/backfill-stuck-router — one-shot
 * operational migration that resolves CaseManagement rows stuck in
 * PENDING_ROUTER while at least one of their encounters carries a
 * SIGNED/TRANSFERRED note.
 *
 * Sprint 0.13 Decision 3 requires routing to lock at review before sign —
 * until that's enforced server-side, a handful of notes slip through and
 * disappear from the chart: CasesPanel excludes PENDING_ROUTER cases
 * (cases-panel.tsx line 63), and the new "By case" view labels them
 * "Routing in progress". This backfill clears the historical backlog so
 * the hard sign-block PR can ship without orphaning any signed notes.
 *
 * Promotes each stuck case to ACTIVE with the same "Uncategorized care"
 * placeholder Sprint 0.11's migration used for orphan encounters, plus a
 * human-readable description ("Backfilled from PENDING_ROUTER on ...")
 * so the next clinician to touch the case sees why it exists. The
 * promoted case carries the "Needs coding" badge in CasesPanel (because
 * `primaryIcd = null`); the clinician recodes it via EditCaseDialog.
 *
 * Idempotent: subsequent runs find no PENDING_ROUTER rows with signed
 * notes and report zero backfilled.
 *
 * Supports `?dryRun=true` (or `?dryRun=1`) — scans + reports candidates
 * but does NOT mutate, audit per-case, or touch CaseManagement state.
 * The summary audit row still fires (with `dryRun: true`) so operations
 * can verify the dry-run was scoped correctly before executing.
 *
 * Owner/admin-gated via TEAM_MEMBERS_MANAGE (same gate as the recert
 * sweep at /api/admin/episodes/sweep).
 */
export async function POST(request: Request) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const url = new URL(request.url);
  const dryRunParam = url.searchParams.get('dryRun');
  const dryRun = dryRunParam === 'true' || dryRunParam === '1';

  const sweepId = randomBytes(6).toString('hex');
  const startedAt = new Date();
  const backfillStampDate = startedAt.toISOString().slice(0, 10);

  const stuck = await prisma.caseManagement.findMany({
    where: {
      orgId: authorizationUser.orgId,
      status: 'PENDING_ROUTER',
      encounters: {
        some: {
          notes: {
            some: { status: { in: ['SIGNED', 'TRANSFERRED'] } },
          },
        },
      },
    },
    select: {
      id: true,
      encounters: {
        select: {
          notes: {
            where: { status: { in: ['SIGNED', 'TRANSFERRED'] } },
            select: { id: true },
          },
        },
      },
    },
    take: MAX_PER_SWEEP,
  });

  const candidates = stuck.map((c) => ({
    id: c.id,
    signedNoteCount: c.encounters.reduce((n, e) => n + e.notes.length, 0),
  }));

  let backfilled = 0;
  let errors = 0;

  if (!dryRun) {
    for (const candidate of candidates) {
      try {
        await prisma.caseManagement.update({
          where: { id: candidate.id },
          data: {
            status: 'ACTIVE',
            primaryIcd: null,
            primaryIcdLabel: BACKFILL_LABEL,
            description: `${BACKFILL_DESCRIPTION_PREFIX} ${backfillStampDate} (sweep ${sweepId}). Recode via Edit case.`,
          },
        });
        backfilled += 1;
        await writeAuditLog({
          userId: user.id,
          orgId: authorizationUser.orgId,
          action: 'CASE_BACKFILLED_FROM_PENDING_ROUTER',
          resourceType: 'CaseManagement',
          resourceId: candidate.id,
          metadata: {
            sweepId,
            signedNoteCount: candidate.signedNoteCount,
            prevStatus: 'PENDING_ROUTER',
            newStatus: 'ACTIVE',
          },
        });
      } catch (err) {
        errors += 1;
        console.warn(
          `[case-management/backfill-stuck-router] update failed for ${candidate.id}:`,
          err,
        );
      }
    }
  }

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'CASE_BACKFILL_SWEEP_RUN',
    resourceType: 'CaseManagement',
    resourceId: 'sweep',
    metadata: {
      sweepId,
      scanned: candidates.length,
      backfilled,
      errors,
      reachedCap: candidates.length === MAX_PER_SWEEP,
      dryRun,
    },
  });

  return NextResponse.json({
    data: {
      sweepId,
      scanned: candidates.length,
      candidates,
      backfilled,
      errors,
      reachedCap: candidates.length === MAX_PER_SWEEP,
      dryRun,
    },
  });
}
