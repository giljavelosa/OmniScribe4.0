import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  outcome: z.enum(['accepted', 'dismissed']),
  /** Platforms list from BeforeInstallPromptEvent — typically
   *  ['web'] on Chromium browsers; iOS Safari doesn't fire the
   *  event so this surface won't see it. Capped at 10 entries
   *  to bound metadata size. */
  platforms: z.array(z.string().max(40)).max(10).nullable().optional(),
});

/**
 * POST /api/pwa/install-event — Unit 36.
 *
 * Records the outcome of a PWA install prompt. Auth-required (so the
 * audit row anchors to a real user); orgId pulled from session.
 *
 * Best-effort caller. The InstallPrompt component fires this without
 * awaiting + ignores failures; the install itself proceeds regardless.
 *
 * PHI-free by construction — body schema accepts only outcome +
 * platforms strings.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
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
    orgId: session.user.orgId ?? undefined,
    action: 'PWA_INSTALL_PROMPTED',
    resourceType: 'PWA',
    resourceId: 'install',
    metadata: {
      outcome: parsed.data.outcome,
      platforms: parsed.data.platforms ?? null,
    },
  });

  return NextResponse.json({ data: { ok: true } });
}
