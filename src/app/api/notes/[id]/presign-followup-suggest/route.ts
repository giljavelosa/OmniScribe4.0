import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { PresignFollowupSuggester } from '@/services/brief/PresignFollowupSuggester';

export const runtime = 'nodejs';

const bodySchema = z
  .object({
    /** Manual button-press bypasses the planHash cache check. */
    force: z.boolean().optional(),
  })
  .strict();

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_PER_WINDOW = 6;

/**
 * POST /api/notes/[id]/presign-followup-suggest
 *
 * Triggers Cleo's pre-sign FollowupExtractor against a DRAFT note's Plan
 * section. Output: `FollowUp` rows in PROPOSED status with provenance
 * (sourceText, extractorVersion, planHash). Idempotent via planHash —
 * repeated calls on the same Plan content return the cached PROPOSED
 * set without re-running the LLM.
 *
 * Anti-regression Rule 20 (narrow carve-out): this endpoint reads DRAFT
 * Plan content because outputs are PROPOSED (non-binding). See the
 * carve-out rationale in `context/specs/sprint-0-presign-followup-suggest.md`
 * + the architecture.md amendment.
 *
 * Safety:
 *   - Auth via NOTE_REVIEW (same gate as the sections editor + the
 *     existing manual /followups endpoint).
 *   - Clinician must be org-scoped on the note (Prisma where-clause
 *     enforces).
 *   - Note must be in DRAFT (PresignFollowupSuggester refuses otherwise).
 *   - Rate limit: ≤6 extractions per note per 60s (defends against the
 *     OQ-3 auto-refresh thrash mode if the client misbehaves).
 *
 * Body (optional):
 *   { force?: boolean }   — true skips the planHash cache. Used by the
 *                           manual "Suggest follow-ups" button when the
 *                           clinician explicitly wants to re-run.
 *
 * Returns:
 *   200 { status: 'created' | 'cached', proposalCount, planHash, ... }
 *   400 bad_request (bad body)
 *   404 note_not_found / not_draft
 *   409 plan_too_short / no_plan_content
 *   429 rate_limit_exceeded
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const rawBody = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }
  const { force } = parsed.data;

  const { id: noteId } = await params;

  // Defense-in-depth org check before we run the (relatively expensive)
  // LLM call. PresignFollowupSuggester also re-checks; we keep both so
  // a future refactor can't accidentally drop the auth boundary.
  const ownership = await prisma.note.findFirst({
    where: { id: noteId, orgId: authorizationUser.orgId },
    select: { id: true },
  });
  if (!ownership) {
    return NextResponse.json(
      { error: { code: 'note_not_found' } },
      { status: 404 },
    );
  }

  // Rate limit — count recent FOLLOWUP_PROPOSAL_PROPOSED audit rows for this
  // note in the last RATE_LIMIT_WINDOW_SECONDS. Audit log is the source of
  // truth (Redis-free rate limit; sufficient for the OQ-3 auto-refresh
  // cadence ceiling of 1 per 5s).
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000);
  const recentRunCount = await prisma.auditLog.count({
    where: {
      orgId: authorizationUser.orgId,
      resourceType: 'Note',
      resourceId: noteId,
      action: 'FOLLOWUP_PROPOSAL_PROPOSED',
      createdAt: { gt: windowStart },
    },
  });
  if (recentRunCount >= RATE_LIMIT_MAX_PER_WINDOW) {
    return NextResponse.json(
      {
        error: {
          code: 'rate_limit_exceeded',
          retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS,
        },
      },
      {
        status: 429,
        headers: { 'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS) },
      },
    );
  }

  const suggester = new PresignFollowupSuggester();
  const result = await suggester.suggestForDraft(noteId, authorizationUser.orgId, {
    force: force === true,
  });

  if (!result.ok) {
    const status =
      result.reason === 'note_not_found'
        ? 404
        : result.reason === 'not_draft'
          ? 409
          : 409;
    return NextResponse.json({ error: { code: result.reason } }, { status });
  }

  // Audit the trigger (separate from per-row FOLLOWUP_PROPOSAL_PROPOSED rows
  // emitted by the suggester). Lets us reconstruct "how often did the /review
  // page actually fire the auto-suggest?" without joining against per-row
  // audits.
  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action:
      result.status === 'cached'
        ? 'FOLLOWUP_PROPOSAL_PROPOSED' // cache hit still counts toward audit lens
        : 'FOLLOWUP_PROPOSAL_PROPOSED',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: {
      result: result.status,
      proposalCount: result.proposalCount,
      planHash: result.planHash,
      force: force === true,
      ...(result.status === 'created'
        ? {
            supersededCount: result.supersededCount,
            extractorVersion: result.extractorVersion,
          }
        : {}),
    },
  });

  return NextResponse.json(result, { status: 200 });
}
