import type { Prisma, PrismaClient } from '@prisma/client';

type Tx = Prisma.TransactionClient | PrismaClient;

export class CaseResolutionError extends Error {
  constructor(
    readonly code: 'case_required' | 'case_not_found',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'CaseResolutionError';
  }
}

/**
 * Resolve which CaseManagement anchors a new encounter.
 *
 * Precedence: explicit caseId → episode's parent case → sole ACTIVE case
 * → null. Sprint 0.13 changed the trailing branch from "throw case_required"
 * to "return null" so startVisit can auto-create a PENDING_ROUTER case
 * inside the same transaction. The "every encounter has a case" invariant
 * is still preserved — startVisit is the single owner of the auto-create
 * step.
 *
 * `case_not_found` is still thrown when the caller passed an explicit id
 * that doesn't resolve in the org/patient scope.
 */
export async function resolveCaseManagementIdForVisit(
  tx: Tx,
  args: {
    orgId: string;
    patientId: string;
    caseManagementId?: string;
    episodeOfCareId?: string | null;
  },
): Promise<string | null> {
  if (args.caseManagementId) {
    const row = await tx.caseManagement.findFirst({
      where: {
        id: args.caseManagementId,
        orgId: args.orgId,
        patientId: args.patientId,
      },
      select: { id: true },
    });
    if (!row) throw new CaseResolutionError('case_not_found');
    return row.id;
  }

  if (args.episodeOfCareId) {
    const ep = await tx.episodeOfCare.findFirst({
      where: {
        id: args.episodeOfCareId,
        orgId: args.orgId,
        patientId: args.patientId,
      },
      select: { caseManagementId: true },
    });
    if (ep) return ep.caseManagementId;
  }

  const active = await tx.caseManagement.findMany({
    where: {
      orgId: args.orgId,
      patientId: args.patientId,
      status: 'ACTIVE',
    },
    select: { id: true },
    take: 2,
  });
  if (active.length === 1) return active[0]!.id;

  // Sprint 0.13 — defer to startVisit, which auto-creates a PENDING_ROUTER
  // case when none can be resolved.
  return null;
}
