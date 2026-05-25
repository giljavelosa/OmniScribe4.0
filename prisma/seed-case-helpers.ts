import { Division, EpisodeStatus, PrismaClient } from '@prisma/client';

type UpsertCaseArgs = {
  id: string;
  orgId: string;
  patientId: string;
  primaryIcdLabel: string;
  primaryIcd?: string | null;
  secondaryIcd?: string | null;
  secondaryIcdLabel?: string | null;
  description?: string | null;
  openedByOrgUserId?: string | null;
  /** Unit 49: case division stamp. If omitted, derived from
   *  `openedByOrgUserId → OrgUser.division`. Falls back to `MULTI`
   *  if no opener is set. Mirrors the migration's backfill logic. */
  division?: Division;
};

export async function upsertCaseManagement(
  prisma: PrismaClient,
  args: UpsertCaseArgs,
) {
  let division: Division;
  if (args.division) {
    division = args.division;
  } else if (args.openedByOrgUserId) {
    const opener = await prisma.orgUser.findUnique({
      where: { id: args.openedByOrgUserId },
      select: { division: true },
    });
    if (!opener) {
      throw new Error(
        `upsertCaseManagement: unknown openedByOrgUserId ${args.openedByOrgUserId} (cannot derive division)`,
      );
    }
    division = opener.division;
  } else {
    division = Division.MULTI;
  }

  return prisma.caseManagement.upsert({
    where: { id: args.id },
    update: {
      primaryIcdLabel: args.primaryIcdLabel,
      primaryIcd: args.primaryIcd ?? null,
      secondaryIcd: args.secondaryIcd ?? null,
      secondaryIcdLabel: args.secondaryIcdLabel ?? null,
      description: args.description ?? null,
    },
    create: {
      id: args.id,
      orgId: args.orgId,
      patientId: args.patientId,
      primaryIcd: args.primaryIcd ?? null,
      primaryIcdLabel: args.primaryIcdLabel,
      secondaryIcd: args.secondaryIcd ?? null,
      secondaryIcdLabel: args.secondaryIcdLabel ?? null,
      description: args.description ?? null,
      division,
      status: 'ACTIVE',
      openedByOrgUserId: args.openedByOrgUserId ?? null,
    },
  });
}

type UpsertRehabEpisodeArgs = {
  id: string;
  orgId: string;
  patientId: string;
  caseManagementId: string;
  clinicianOrgUserId: string;
  departmentId: string;
  diagnosis: string;
  bodyPart?: string | null;
  primaryIcd?: string | null;
  primaryIcdLabel?: string | null;
  secondaryIcd?: string | null;
  secondaryIcdLabel?: string | null;
};

/** REHAB-only EpisodeOfCare under a case (schema CHECK). */
export async function upsertRehabEpisode(
  prisma: PrismaClient,
  args: UpsertRehabEpisodeArgs,
) {
  return prisma.episodeOfCare.upsert({
    where: { id: args.id },
    update: {
      caseManagementId: args.caseManagementId,
      diagnosis: args.diagnosis,
      bodyPart: args.bodyPart ?? null,
      primaryIcd: args.primaryIcd ?? null,
      primaryIcdLabel: args.primaryIcdLabel ?? args.diagnosis,
      secondaryIcd: args.secondaryIcd ?? null,
      secondaryIcdLabel: args.secondaryIcdLabel ?? null,
    },
    create: {
      id: args.id,
      orgId: args.orgId,
      patientId: args.patientId,
      caseManagementId: args.caseManagementId,
      clinicianOrgUserId: args.clinicianOrgUserId,
      departmentId: args.departmentId,
      division: Division.REHAB,
      diagnosis: args.diagnosis,
      bodyPart: args.bodyPart ?? null,
      primaryIcd: args.primaryIcd ?? null,
      primaryIcdLabel: args.primaryIcdLabel ?? args.diagnosis,
      secondaryIcd: args.secondaryIcd ?? null,
      secondaryIcdLabel: args.secondaryIcdLabel ?? null,
      status: EpisodeStatus.ACTIVE,
    },
  });
}
