/**
 * Shared "start a visit" pipeline — minting Encounter + Note from either a
 * scheduled appointment (POST /api/schedules/[id]/start) or an ad-hoc create
 * (POST /api/encounters). Keeps the audit-log + division-resolution logic in
 * exactly one place.
 *
 * Note.division is LOCKED here per spec §E. Unit 05 reads it as immutable.
 */

import { Prisma, type PrismaClient, EncounterStatus, ScheduleStatus, NoteStatus } from '@prisma/client';

import { writeAuditLog } from '@/lib/audit/log';
import { resolveDivisionForNote } from '@/lib/divisions/resolve';

type Tx = Prisma.TransactionClient | PrismaClient;

export type StartVisitArgs = {
  tx: Tx;
  orgId: string;
  patientId: string;
  clinicianOrgUserId: string;
  siteId: string;
  roomId?: string | null;
  scheduleId?: string;
  departmentId?: string | null;
  episodeOfCareId?: string | null;
  actingUserId: string;
};

export async function startVisit(args: StartVisitArgs) {
  const [patient, org, episode] = await Promise.all([
    args.tx.patient.findUnique({ where: { id: args.patientId } }),
    args.tx.organization.findUnique({
      where: { id: args.orgId },
      select: { division: true, defaultDivision: true },
    }),
    args.episodeOfCareId
      ? args.tx.episodeOfCare.findUnique({
          where: { id: args.episodeOfCareId },
          select: { division: true },
        })
      : Promise.resolve(null),
  ]);
  if (!patient) throw new Error('startVisit: patient missing');
  if (!org) throw new Error('startVisit: org missing');

  const division = resolveDivisionForNote({
    patient: { division: patient.division },
    episode: episode ? { division: episode.division } : null,
    org,
  });

  const encounter = await args.tx.encounter.create({
    data: {
      orgId: args.orgId,
      patientId: args.patientId,
      clinicianOrgUserId: args.clinicianOrgUserId,
      siteId: args.siteId,
      roomId: args.roomId ?? null,
      scheduleId: args.scheduleId,
      departmentId: args.departmentId ?? null,
      episodeOfCareId: args.episodeOfCareId ?? null,
      status: EncounterStatus.IN_PROGRESS,
      startedAt: new Date(),
    },
  });

  const note = await args.tx.note.create({
    data: {
      orgId: args.orgId,
      patientId: args.patientId,
      encounterId: encounter.id,
      clinicianOrgUserId: args.clinicianOrgUserId,
      division,
      status: NoteStatus.PREPARING,
    },
  });

  if (args.scheduleId) {
    await args.tx.schedule.update({
      where: { id: args.scheduleId },
      data: { status: ScheduleStatus.IN_PROGRESS },
    });
  }

  // Audit (writeAuditLog writes via its own prisma; not inside this tx, but
  // happens during the same request so any failure propagates to the caller).
  await writeAuditLog({
    userId: args.actingUserId,
    orgId: args.orgId,
    action: 'ENCOUNTER_CREATED',
    resourceType: 'Encounter',
    resourceId: encounter.id,
    metadata: { source: args.scheduleId ? 'schedule' : 'adhoc', division },
  });

  return { encounter, note };
}
