import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit/log';
import type { AuditAction } from '@/lib/audit/actions';

export const runtime = 'nodejs';

const SURFACES = ['prepare', 'capture', 'review', 'telehealth-room'] as const;
// Client-side fire-and-forget audit ingress. Each action is shape-locked
// here at the route boundary so PHI can't be smuggled through the
// metadata fields. Adding new actions: extend this allowlist AND update
// the bodySchema if a new metadata field is needed.
const ALLOWED_ACTIONS: ReadonlyArray<AuditAction> = [
  'COPILOT_CARD_RENDERED',
  'COPILOT_CARD_DISMISSED',
  'COPILOT_BEACON_OPENED',
  'COPILOT_BEACON_CLOSED',
  // Unit 10 — batch retry for failed sections, fired by the
  // FailureRecoveryBanner on /review. itemCount carries the count of
  // sections being retried; no PHI.
  'SECTION_REGEN_RETRY_BATCH',
  // Unit 14 — per-section copy-to-clipboard for EHR-paste workflows.
  // itemCount carries the character count of what was copied (no
  // content; the route's schema only accepts numbers).
  'SECTION_COPIED_TO_CLIPBOARD',
  // Unit 17 — telehealth audio pipeline drained its reconnect buffer
  // after a WS reopen. Fired by the room shell on the pipeline's
  // onReconnected callback. itemCount carries the count of buffered
  // chunks replayed.
  'TELEHEALTH_AUDIO_RECONNECTED',
  // Unit 18 — clinician's pre-call diagnostic failed one of the three
  // checks (mic / network / browser_compat). The noteId field carries
  // the scheduleId here since the preflight runs before a Note exists;
  // resourceType still resolves as Note in the audit row (acceptable
  // join compromise — the scheduleId is the natural anchor anyway).
  'TELEHEALTH_PRECALL_CHECK_FAILED',
  // Unit 26 — Watch v2 live trigger. Fired once per cardType per capture
  // session when a transcript mention raises rows in the card. itemCount
  // carries the count of rows raised in that card at first-fire moment.
  'COPILOT_CARD_RAISED',
];

const bodySchema = z.object({
  action: z.enum(ALLOWED_ACTIONS as readonly string[]),
  surface: z.enum(SURFACES),
  noteId: z.string().min(1).max(64),
  // Unit 25 — extended for Watch v1 FHIR-backed cards.
  cardType: z
    .enum([
      'open-followups',
      'plan-for-today',
      'active-conditions',
      'current-medications',
      'recent-observations',
      'allergies',
    ])
    .optional(),
  itemCount: z.number().int().min(0).max(100_000).optional(),
  // Unit 18: which preflight check failed + a shape-locked reason. Required
  // for ops triage — without these every TELEHEALTH_PRECALL_CHECK_FAILED row
  // looks identical. Reason is bounded to short tokens, no free PHI.
  check: z.enum(['mic', 'network', 'browser_compat']).optional(),
  reason: z.string().min(1).max(120).optional(),
});

/**
 * POST /api/audit/copilot-event — client-side audit ingress for Copilot
 * Watch v0 surfaces (Unit 07).
 *
 * Cards + beacon fire one POST per render / open. We deliberately do NOT
 * accept arbitrary metadata — the schema fences off PHI ingress at the
 * route boundary. Only the four shape-locked actions are accepted; everything
 * else is 400.
 *
 * Auth via the session; the audit row is org-scoped via the session.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.orgId || !session.user.id) {
    return NextResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad_request', issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  await writeAuditLog({
    userId: session.user.id,
    orgId: session.user.orgId,
    action: parsed.data.action as AuditAction,
    resourceType: 'Note',
    resourceId: parsed.data.noteId,
    metadata: {
      surface: parsed.data.surface,
      ...(parsed.data.cardType ? { cardType: parsed.data.cardType } : {}),
      ...(parsed.data.itemCount !== undefined ? { itemCount: parsed.data.itemCount } : {}),
      ...(parsed.data.check ? { check: parsed.data.check } : {}),
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    },
  });

  return NextResponse.json({ data: { ok: true } });
}
