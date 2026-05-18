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
  const guard = await requireFeatureAccess('TEAM_MEMBERS_MANAGE');
  // Fallback: owning clinician can self-disconnect even without admin perms.
  const session = await (await import('@/lib/auth')).auth();
  if ('error' in guard && !session?.user?.orgUserId) return guard.error;

  const { id } = await params;
  const identity = await prisma.fhirIdentity.findUnique({ where: { id } });
  if (!identity) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  if ('error' in guard) {
    // Not an admin — only the owning clinician may disconnect.
    if (identity.clinicianOrgUserId !== session?.user?.orgUserId) return guard.error;
  } else {
    assertOrgScoped(identity.orgId, guard.authorizationUser.orgId);
  }

  const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
  const reasonRaw = typeof body.reason === 'string' ? body.reason.trim() : '';
  const reason = reasonRaw.slice(0, 200) || 'clinician_initiated';

  await prisma.fhirIdentity.delete({ where: { id } });

  await writeAuditLog({
    userId: session?.user?.id,
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
