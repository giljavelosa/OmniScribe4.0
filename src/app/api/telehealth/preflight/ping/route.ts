import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/telehealth/preflight/ping — Unit 18 preflight RTT probe.
 *
 * Tiny payload, no DB calls, no external side effects — purely measures
 * round-trip from the clinician's browser to the app server. NextAuth
 * session-gated since preflight is a clinician-only workflow; the patient
 * surfaces don't use it.
 *
 * Returns the server-side timestamp so the client can also detect clock
 * skew (rare but worth surfacing if it ever shows up as a "slow network"
 * red herring).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 });
  }
  return NextResponse.json({ data: { ok: true, t: Date.now() } });
}
