import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { decryptToken, encryptToken } from '@/lib/fhir/token-crypto';
import { refreshAccessToken, resolveSmartConfig } from '@/services/fhir/smart-client';

export const runtime = 'nodejs';

/**
 * POST /api/admin/integrations/fhir/[id]/refresh — manual token refresh.
 *
 * Primarily a dev / debugging hook in F1 — the resource sync worker
 * (F3 / Unit 21) will refresh proactively. Useful right now to verify
 * the refresh roundtrip end-to-end without waiting for token expiry.
 *
 * Audits FHIR_TOKEN_REFRESHED on success; on failure (refresh token
 * rejected by EHR) the row is NOT deleted — the clinician can re-launch
 * to re-authorize.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE');
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id } = await params;
  const identity = await prisma.fhirIdentity.findUnique({ where: { id } });
  if (!identity) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(identity.orgId, authorizationUser.orgId);

  const refreshToken = decryptToken(identity.refreshTokenEnc);
  const ehrConfig = await resolveSmartConfig(identity.fhirBaseUrl);

  let next;
  try {
    next = await refreshAccessToken({
      tokenEndpoint: ehrConfig.tokenEndpoint,
      refreshToken,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'refresh_failed',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 502 },
    );
  }

  const expiresAt = new Date(Date.now() + next.expiresInSeconds * 1000);
  const updated = await prisma.fhirIdentity.update({
    where: { id },
    data: {
      accessTokenEnc: encryptToken(next.accessToken),
      refreshTokenEnc: encryptToken(next.refreshToken),
      scope: next.scope,
      expiresAt,
      refreshedAt: new Date(),
    },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'FHIR_TOKEN_REFRESHED',
    resourceType: 'FhirIdentity',
    resourceId: id,
    metadata: {
      ehrSystem: identity.ehrSystem,
      expiresInSeconds: next.expiresInSeconds,
    },
  });

  return NextResponse.json({
    data: { id: updated.id, expiresAt: updated.expiresAt.toISOString() },
  });
}
