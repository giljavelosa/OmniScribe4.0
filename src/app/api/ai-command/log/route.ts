import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit/log';
import { classifyAiCommand } from '@/lib/ai-command/classify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/ai-command/log — Tier 2 telemetry sink for the home AI panel.
 *
 * Background
 * ----------
 * The home `<AiCommandPanel>` is a stub (Wave-8 placeholder). Today
 * it routes every query straight to /patients?query=…. We have no
 * idea WHAT clinicians type, so we can't design Tier 3's command
 * vocabulary from real data. This endpoint is the "wishlist
 * collector": every panel submission posts here, the server
 * classifies the SHAPE of the query, and writes a PHI-free audit
 * row. After a week of use the admin dashboard tells us what the
 * vocabulary actually is.
 *
 * Auth
 * ----
 * Session-only (no FeatureKey gate). Any authenticated org user can
 * submit — the panel is on /home which all roles see.
 *
 * PHI contract
 * ------------
 * The classifier (`src/lib/ai-command/classify.ts`) is deliberately
 * structural: it never returns user-typed substrings. The audit
 * row contains:
 *   - pattern        — closed enum (one of 6 shapes)
 *   - commandVerb    — closed enum (one of 8 canonical verbs) or null
 *   - queryLength    — bounded integer (chars)
 *   - wordCount      — bounded integer
 *   - surface        — 'home-desktop' | 'home-mobile'
 * The raw query text never leaves this handler — we read it,
 * classify it, and let it fall out of scope unpersisted. The
 * `writeAuditLog` PHI denylist additionally rejects any field
 * whose key matches a known PHI shape (defense in depth).
 *
 * Fire-and-forget
 * ---------------
 * The client calls this BEFORE its redirect but does NOT await the
 * response. A 5xx here cannot block the clinician's navigation —
 * telemetry is observability, not a user-facing feature.
 */

const SURFACE_VALUES = ['home-desktop', 'home-mobile'] as const;

const bodySchema = z.object({
  /** The raw query the clinician typed. Bounded so a malicious POST
   *  can't ship a 10 MB payload. We CLASSIFY this server-side then
   *  drop it; the bounded length is itself a guardrail. */
  query: z.string().min(1).max(500),
  /** Which variant of the panel was used. Passed by the panel so
   *  the dashboard can tell mobile usage from desktop usage. */
  surface: z.enum(SURFACE_VALUES),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.orgId) {
    return NextResponse.json(
      { error: { code: 'unauthenticated' } },
      { status: 401 },
    );
  }

  let payload: z.infer<typeof bodySchema>;
  try {
    const json = await req.json();
    payload = bodySchema.parse(json);
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_request' } },
      { status: 400 },
    );
  }

  // Classify FIRST — the trimmed query never leaves this scope.
  const classification = classifyAiCommand(payload.query);

  await writeAuditLog({
    userId: session.user.id,
    orgId: session.user.orgId,
    action: 'AI_PANEL_QUERY',
    resourceType: 'AiCommandPanel',
    metadata: {
      pattern: classification.pattern,
      commandVerb: classification.commandVerb,
      queryLength: classification.queryLength,
      wordCount: classification.wordCount,
      surface: payload.surface,
    },
  });

  return NextResponse.json({
    data: {
      ok: true,
      pattern: classification.pattern,
      commandVerb: classification.commandVerb,
    },
  });
}
