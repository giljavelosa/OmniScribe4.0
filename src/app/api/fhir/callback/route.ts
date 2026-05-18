import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { encryptToken } from '@/lib/fhir/token-crypto';
import { exchangeAuthCode, resolveSmartConfig } from '@/services/fhir/smart-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/fhir/callback — OAuth2 redirect target after the EHR
 * authorizes the launch. The state param resolves the FhirLaunchState
 * row we wrote in /api/fhir/launch; the code is exchanged at the EHR's
 * token endpoint, tokens are encrypted and upserted into FhirIdentity,
 * and the launch row is deleted.
 *
 * Failure paths all redirect to /admin/integrations/fhir?error=... so
 * the clinician sees a clear surface; the audit row carries the
 * internal reason for ops triage. No auth gate here — the state token
 * IS the auth (random 32-byte opaque value, 10-min TTL).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const errorParam = url.searchParams.get('error');

  // The EHR may redirect with error=access_denied if the clinician
  // cancelled the authorization screen. Audit + surface a soft error.
  if (errorParam) {
    return failRedirect(req, state ?? null, `ehr_${errorParam}`);
  }
  if (!state || !code) {
    return failRedirect(req, state ?? null, 'missing_state_or_code');
  }

  const launchRow = await prisma.fhirLaunchState.findUnique({ where: { state } });
  if (!launchRow) {
    return failRedirect(req, null, 'state_unknown');
  }
  if (launchRow.expiresAt.getTime() < Date.now()) {
    await prisma.fhirLaunchState.delete({ where: { state } }).catch(() => {});
    return failRedirect(req, launchRow.state, 'state_expired', launchRow.orgId);
  }

  try {
    const ehrConfig = await resolveSmartConfig(launchRow.iss);
    const tokens = await exchangeAuthCode({
      tokenEndpoint: ehrConfig.tokenEndpoint,
      code,
      codeVerifier: launchRow.codeVerifier,
    });
    const expiresAt = new Date(Date.now() + tokens.expiresInSeconds * 1000);

    // Encrypt before upsert; both tokens at rest are GCM-sealed.
    const accessTokenEnc = encryptToken(tokens.accessToken);
    const refreshTokenEnc = encryptToken(tokens.refreshToken);

    await prisma.$transaction(async (tx) => {
      await tx.fhirIdentity.upsert({
        where: {
          clinicianOrgUserId_ehrSystem: {
            clinicianOrgUserId: launchRow.clinicianOrgUserId,
            ehrSystem: launchRow.ehrSystem,
          },
        },
        update: {
          fhirBaseUrl: launchRow.iss,
          accessTokenEnc,
          refreshTokenEnc,
          scope: tokens.scope,
          expiresAt,
          launchPatientFhirId: tokens.patient ?? null,
        },
        create: {
          orgId: launchRow.orgId,
          clinicianOrgUserId: launchRow.clinicianOrgUserId,
          ehrSystem: launchRow.ehrSystem,
          fhirBaseUrl: launchRow.iss,
          accessTokenEnc,
          refreshTokenEnc,
          scope: tokens.scope,
          expiresAt,
          launchPatientFhirId: tokens.patient ?? null,
        },
      });
      await tx.fhirLaunchState.delete({ where: { state } });
    });

    await writeAuditLog({
      // No authenticated user on the OAuth callback — the state token IS
      // the auth. The audit row's orgId still anchors the org context.
      orgId: launchRow.orgId,
      action: 'FHIR_AUTH_GRANTED',
      resourceType: 'FhirIdentity',
      resourceId: `${launchRow.clinicianOrgUserId}:${launchRow.ehrSystem}`,
      metadata: {
        ehrSystem: launchRow.ehrSystem,
        scope: tokens.scope,
        expiresInSeconds: tokens.expiresInSeconds,
        hasLaunchPatient: !!tokens.patient,
      },
    });

    return NextResponse.redirect(
      absoluteUrl(req, `/admin/integrations/fhir?connected=${encodeURIComponent(launchRow.ehrSystem)}`),
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message.slice(0, 200) : 'unknown_error';
    return failRedirect(req, launchRow.state, `token_exchange_failed:${reason}`, launchRow.orgId);
  }
}

function absoluteUrl(req: Request, path: string): URL {
  return new URL(path, new URL(req.url).origin);
}

async function failRedirect(
  req: Request,
  state: string | null,
  reason: string,
  orgId?: string,
): Promise<Response> {
  if (orgId) {
    await writeAuditLog({
      // No authenticated user on the OAuth callback — the state token IS
      // the auth. The audit row's orgId still anchors the org context.
      orgId,
      action: 'FHIR_AUTH_FAILED',
      resourceType: 'FhirLaunchState',
      resourceId: state ?? 'unknown',
      metadata: { reason },
    }).catch(() => {});
  }
  return NextResponse.redirect(
    absoluteUrl(req, `/admin/integrations/fhir?error=${encodeURIComponent(reason)}`),
  );
}
