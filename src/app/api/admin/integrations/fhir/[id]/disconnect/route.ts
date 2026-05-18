import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';

export const runtime = 'nodejs';

/**
 * POST /api/admin/integrations/fhir/[id]/disconnect — wipe a FhirIdentity.
 *
 * Allowed callers: org admin (TEAM_MEMBERS_MANAGE) OR the owning
 * clinician (defense in depth — the clinician can always revoke their
 * own connection).
 *
 * Audits FHIR_DISCONNECTED with the EHR system + a brief reason
 * (allowlisted strings). Token rows are hard-deleted; the encrypted-at-
 * rest tokens are now unrecoverable, which is the right disposal
 * semantics for OAuth credentials.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Self-disconnect path uses NOTE_REVIEW (broadly granted) as a stand-in
  // feature key so we still go through requireFeatureAccess's MFA + active-user
  // re-check + DB-fresh role read + impersonation read-only gate. The actual
  // ownership/admin authorization is done below.
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id } = await params;
  const identity = await prisma.fhirIdentity.findUnique({ where: { id } });
  if (!identity) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(identity.orgId, authorizationUser.orgId);

  // Authorization: org admin (TEAM_MEMBERS_MANAGE) OR the owning clinician.
  const isAdmin = ['SUPER_ADMIN', 'ORG_ADMIN', 'SITE_ADMIN'].includes(authorizationUser.role);
  const isOwner = identity.clinicianOrgUserId === authorizationUser.orgUserId;
  if (!isAdmin && !isOwner) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
  const reasonRaw = typeof body.reason === 'string' ? body.reason.trim() : '';
  const reason = reasonRaw.slice(0, 200) || 'clinician_initiated';

  await prisma.fhirIdentity.delete({ where: { id } });

  await writeAuditLog({
    userId: user.id,
    orgId: identity.orgId,
    action: 'FHIR_DISCONNECTED',
    resourceType: 'FhirIdentity',
    resourceId: id,
    metadata: {
      ehrSystem: identity.ehrSystem,
      reason,
    },
  });

  return NextResponse.json({ data: { ok: true } });
}
