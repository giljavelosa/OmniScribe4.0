import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import {
  generatePkcePair,
  generateStateToken,
  resolveSmartConfig,
  REQUIRED_SMART_SCOPES,
  smartConfig,
} from '@/services/fhir/smart-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const EHR_SYSTEM = 'nextgen';

/**
 * GET /api/fhir/launch — provider-launched SMART entry.
 *
 * The clinician opens a patient chart in NextGen, clicks the OmniScribe
 * launch button, NextGen redirects browser here with `iss=<fhirBaseUrl>`
 * and `launch=<launchToken>`. We:
 *   1. Verify the clinician is signed into OmniScribe (NextAuth session).
 *   2. Resolve the EHR's SMART configuration (cached per-process for 1h).
 *   3. Generate a PKCE pair + opaque state token; persist them in a
 *      FhirLaunchState row keyed by state.
 *   4. Redirect to the EHR's authorization endpoint with our required
 *      scopes + state + code_challenge.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.orgId || !session.user.orgUserId) {
    return NextResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 });
  }

  const url = new URL(req.url);
  const iss = url.searchParams.get('iss');
  const launchToken = url.searchParams.get('launch');
  if (!iss) {
    return NextResponse.json(
      { error: { code: 'missing_iss', message: 'iss query param required' } },
      { status: 400 },
    );
  }

  const ehrConfig = await resolveSmartConfig(iss);
  const { verifier, challenge } = generatePkcePair();
  const state = generateStateToken();
  const expiresAt = new Date(Date.now() + STATE_TTL_MS);

  await prisma.fhirLaunchState.create({
    data: {
      state,
      orgId: session.user.orgId,
      clinicianOrgUserId: session.user.orgUserId,
      iss,
      launchToken: launchToken ?? null,
      codeVerifier: verifier,
      redirectUri: smartConfig.redirectUri,
      ehrSystem: EHR_SYSTEM,
      expiresAt,
    },
  });

  await writeAuditLog({
    userId: session.user.id,
    orgId: session.user.orgId,
    action: 'FHIR_LAUNCH_INITIATED',
    resourceType: 'FhirLaunchState',
    resourceId: state,
    metadata: {
      ehrSystem: EHR_SYSTEM,
      iss,
      hasLaunchToken: !!launchToken,
      stub: smartConfig.isStubMode,
    },
  });

  const authorizeUrl = new URL(ehrConfig.authorizationEndpoint);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', smartConfig.clientId || 'stub-client-id');
  authorizeUrl.searchParams.set('redirect_uri', smartConfig.redirectUri);
  authorizeUrl.searchParams.set('scope', REQUIRED_SMART_SCOPES.join(' '));
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('aud', iss);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  if (launchToken) authorizeUrl.searchParams.set('launch', launchToken);

  // Stub-mode shortcut: short-circuit straight to the callback with a
  // synthetic code. Lets the full launch → callback flow be exercised
  // end-to-end in dev without a real EHR sandbox.
  if (smartConfig.isStubMode) {
    const callbackUrl = new URL(smartConfig.redirectUri);
    callbackUrl.searchParams.set('code', `stub-code-${state.slice(0, 8)}`);
    callbackUrl.searchParams.set('state', state);
    return NextResponse.redirect(callbackUrl);
  }

  return NextResponse.redirect(authorizeUrl);
}
