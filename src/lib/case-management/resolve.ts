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
 * Precedence: explicit caseId → episode's parent case → sole ACTIVE case.
 */
export async function resolveCaseManagementIdForVisit(
  tx: Tx,
  args: {
    orgId: string;
    patientId: string;
    caseManagementId?: string;
    episodeOfCareId?: string | null;
  },
): Promise<string> {
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

  throw new CaseResolutionError(
    'case_required',
    'Select a case management for this visit.',
  );
}
