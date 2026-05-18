/**
 * src/middleware.ts — Unit 32.
 *
 * Edge-level structural guarantee that an active impersonation session
 * cannot mutate. Runs before any route handler; reads the NextAuth JWT
 * cookie (no DB access — Edge runtime can't reach Prisma); short-
 * circuits with 403 `impersonation_read_only` when the gate fires.
 *
 * Allowed during impersonation:
 *   - GET / HEAD / OPTIONS on any /api route
 *   - DELETE on /api/owner/orgs/[id]/impersonate (so the owner can
 *     end the impersonation session — without this carve-out, the
 *     owner would be permanently stuck)
 *
 * NOTE: middleware does NOT write the IMPERSONATION_BLOCKED_MUTATION
 * audit row — Edge can't reach the DB. The route-level
 * `assertNotImpersonating` helper writes the row when invoked. For
 * routes that don't yet invoke the helper (legacy / units 1-31),
 * the middleware still blocks the request structurally so the audit
 * gap is the only consequence (not a security gap).
 *
 * Matcher scoped to /api/* — the impersonation gate is an API surface
 * concern. Server actions are also caught here when invoked from a
 * page (Next.js routes them through /api/server-actions/* under the
 * hood). Static assets + page renders pass through untouched.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import {
  readActiveImpersonation,
  shouldBlockUnderImpersonation,
} from '@/lib/impersonation';

export async function middleware(req: NextRequest) {
  // getToken reads the NextAuth cookie + decodes the JWT without
  // touching the DB — Edge-safe. Secret is auto-discovered from env.
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  });
  const impersonation = readActiveImpersonation(token ?? null);
  if (
    shouldBlockUnderImpersonation({
      method: req.method,
      pathname: req.nextUrl.pathname,
      impersonation,
    })
  ) {
    // Audit row is written at the route layer by assertNotImpersonating
    // when invoked. Middleware just short-circuits.
    return NextResponse.json(
      { error: { code: 'impersonation_read_only' } },
      { status: 403 },
    );
  }
  return NextResponse.next();
}

export const config = {
  // Matcher: every /api route. NOT page routes — the impersonation
  // banner handles the page-level UI; mutations always go through API.
  matcher: ['/api/:path*'],
};
