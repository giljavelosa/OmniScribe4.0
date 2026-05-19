import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/notes/[id]/stream?include=sections
 *
 * Server-Sent Events stream of Note lifecycle events (spec §F).
 *
 * Modes:
 *   - default              : STATUS events only. Closes when the note exits
 *                            DRAFTING (i.e. the /processing reassurance
 *                            screen has nothing more to show).
 *   - ?include=sections    : Also emits section-progress events from
 *                            Note.inferenceLog._sectionStatus. Unit 05's
 *                            ai-generation worker writes that field; for
 *                            Unit 04 the diff path is wired but the source
 *                            JSON is empty so no events fire.
 *
 * Cadence: polls every 2 seconds (spec calls for transitions within 2s).
 * Cap: 10 minutes — a stalled note shouldn't keep a connection forever; the
 * client reopens if needed.
 *
 * Race-safety: every controller.enqueue + controller.close call is wrapped
 * in a try/catch so a rapid client disconnect (which puts the controller
 * into a closed state) doesn't throw uncaught from the polling interval.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_REVIEW');
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;

  const { id } = await params;
  const url = new URL(req.url);
  const includeSections = (url.searchParams.get('include') ?? '').includes('sections');

  // Verify the note exists + same-org BEFORE opening the stream, so a 404
  // returns synchronously instead of mid-SSE.
  const note = await prisma.note.findFirst({
    where: { id, orgId: authorizationUser.orgId },
    select: {
      id: true,
      orgId: true,
      status: true,
      clinicianOrgUserId: true,
      interruptedAt: true,
      lastWorkerError: true,
    },
  });
  if (!note) return new Response('not found', { status: 404 });
  assertOrgScoped(note.orgId, authorizationUser.orgId);
  if (
    note.clinicianOrgUserId !== authorizationUser.orgUserId &&
    authorizationUser.role !== 'ORG_ADMIN' &&
    authorizationUser.role !== 'VIEWER'
  ) {
    return new Response('forbidden', { status: 403 });
  }

  const POLL_MS = 2_000;
  const MAX_DURATION_MS = 10 * 60 * 1000;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastStatus: string | null = null;
      let lastSectionJson = '';
      let elapsed = 0;
      let closed = false;

      function safeEnqueue(payload: string) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          closed = true;
        }
      }
      function safeClose() {
        // Always clear timers so a closed-controller doesn't leak the polling
        // interval (which would otherwise run noop-prisma queries up to the cap).
        clearInterval(intervalId);
        clearInterval(heartbeatId);
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      }

      // Heartbeat so proxies don't kill an idle connection.
      const heartbeatId = setInterval(() => {
        safeEnqueue(':\n\n');
      }, 15_000);

      const intervalId = setInterval(async () => {
        elapsed += POLL_MS;
        if (elapsed > MAX_DURATION_MS) {
          clearInterval(heartbeatId);
          safeEnqueue(`event: TIMEOUT\ndata: ${JSON.stringify({ elapsed })}\n\n`);
          safeClose();
          return;
        }

        let fresh;
        try {
          fresh = await prisma.note.findFirst({
            where: { id, orgId: authorizationUser.orgId },
            select: { status: true, inferenceLog: true, lastWorkerError: true, interruptedAt: true },
          });
        } catch (err) {
          // Transient DB error — emit an error event but don't close; next
          // poll may succeed.
          safeEnqueue(`event: ERROR\ndata: ${JSON.stringify({ message: err instanceof Error ? err.message : String(err) })}\n\n`);
          return;
        }

        if (!fresh) {
          clearInterval(heartbeatId);
          safeEnqueue(`event: NOT_FOUND\ndata: {}\n\n`);
          safeClose();
          return;
        }

        if (fresh.status !== lastStatus) {
          safeEnqueue(
            `event: STATUS\ndata: ${JSON.stringify({
              status: fresh.status,
              ...(fresh.status === 'INTERRUPTED'
                ? {
                    interruptedAt: fresh.interruptedAt?.toISOString(),
                    lastWorkerError: fresh.lastWorkerError,
                  }
                : {}),
            })}\n\n`,
          );
          lastStatus = fresh.status;
        }

        if (includeSections) {
          const sectionStatus =
            (fresh.inferenceLog as { _sectionStatus?: unknown } | null)?._sectionStatus ?? null;
          const sectionJson = JSON.stringify(sectionStatus);
          if (sectionJson !== lastSectionJson) {
            safeEnqueue(`event: SECTIONS\ndata: ${sectionJson}\n\n`);
            lastSectionJson = sectionJson;
          }
        }

        // Default-mode close: once the note exits the active pipeline
        // (TRANSCRIBING/DRAFTING), there's nothing more for /processing
        // to show. The section-progress UI (Unit 05) keeps streaming via
        // ?include=sections and closes on a different signal.
        if (!includeSections && fresh.status !== 'TRANSCRIBING' && fresh.status !== 'DRAFTING') {
          clearInterval(heartbeatId);
          safeClose();
        }
      }, POLL_MS);

      // Emit initial STATUS so the client doesn't wait 2s for the first event.
      // Include INTERRUPTED metadata up front so a client opening the stream on
      // an already-INTERRUPTED note sees the error reason without waiting for
      // a status change (which never comes — we close immediately after).
      safeEnqueue(
        `event: STATUS\ndata: ${JSON.stringify({
          status: note.status,
          initial: true,
          ...(note.status === 'INTERRUPTED'
            ? {
                interruptedAt: note.interruptedAt?.toISOString(),
                lastWorkerError: note.lastWorkerError,
              }
            : {}),
        })}\n\n`,
      );
      lastStatus = note.status;

      // Wire the abort signal: if the client disconnects, controller.close
      // gets invoked, and our safe wrappers swallow the throw.
      req.signal?.addEventListener('abort', () => {
        clearInterval(heartbeatId);
        safeClose();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disables proxy buffering for Nginx/Cloudfront
    },
  });
}
