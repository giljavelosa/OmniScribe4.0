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

/**
 * Where the episodeOfCareId decision came from. Audited inside
 * ENCOUNTER_CREATED metadata so the auditor lens can quantify picker usage:
 *   - 'picker'              — clinician chose from the multi-episode dialog
 *   - 'auto-single'         — only one active episode existed; auto-linked
 *                              (either inside startVisit when the caller
 *                              didn't supply, or upstream when the picker
 *                              short-circuited because length === 1)
 *   - 'auto-none'           — no active episodes existed; no link
 *   - 'manual-skip'         — clinician opened the picker and chose to skip
 *   - 'inherited-schedule'  — schedule had episodeOfCareId pre-linked; the
 *                              start-visit route passed it through
 *   - 'unspecified'         — legacy caller; recorded so we can find them
 */
export type PickerSource =
  | 'picker'
  | 'auto-single'
  | 'auto-none'
  | 'manual-skip'
  | 'inherited-schedule'
  | 'unspecified';

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
  pickerSource?: PickerSource;
};

export async function startVisit(args: StartVisitArgs) {
  const [patient, org, explicitEpisode] = await Promise.all([
    args.tx.patient.findUnique({ where: { id: args.patientId } }),
    args.tx.organization.findUnique({
      where: { id: args.orgId },
      select: { division: true, defaultDivision: true },
    }),
    args.episodeOfCareId
      ? args.tx.episodeOfCare.findUnique({
          where: { id: args.episodeOfCareId },
          select: { id: true, division: true },
        })
      : Promise.resolve(null),
  ]);
  if (!patient) throw new Error('startVisit: patient missing');
  if (!org) throw new Error('startVisit: org missing');

  // Auto-link to the patient's single active episode if the caller didn't
  // specify one. Common case for outpatient PT/OT/SLP where a patient comes
  // in for the SAME ongoing rehab episode — without this, the resolver falls
  // through to org.defaultDivision and a REHAB patient's notes get tagged
  // MEDICAL, missing the REHAB master prompt (CPT codes, skilled-care lens).
  // We deliberately do NOT auto-link if multiple ACTIVE episodes exist —
  // multi-episode patients require explicit clinician choice.
  let episode: { id: string; division: typeof patient.division } | null = explicitEpisode;
  // When startVisit auto-links because the caller didn't supply, mark the
  // audit row so the picker-vs-fallback split stays observable.
  let resolvedSource: PickerSource = args.pickerSource ?? 'unspecified';
  if (!episode && !args.episodeOfCareId) {
    const active = await args.tx.episodeOfCare.findMany({
      where: { patientId: args.patientId, status: 'ACTIVE' },
      select: { id: true, division: true },
      take: 2,
    });
    if (active.length === 1) {
      episode = active[0]!;
      if (resolvedSource === 'unspecified') resolvedSource = 'auto-single';
    } else if (active.length === 0 && resolvedSource === 'unspecified') {
      resolvedSource = 'auto-none';
    }
  }

  const division = resolveDivisionForNote({
    patient: { division: patient.division },
    episode: episode ? { division: episode.division } : null,
    org,
  });

  // If auto-link picked an episode, propagate it onto the encounter (overrides
  // the explicit null fallback below).
  const encounterEpisodeId = args.episodeOfCareId ?? episode?.id ?? null;

  const encounter = await args.tx.encounter.create({
    data: {
      orgId: args.orgId,
      patientId: args.patientId,
      clinicianOrgUserId: args.clinicianOrgUserId,
      siteId: args.siteId,
      roomId: args.roomId ?? null,
      scheduleId: args.scheduleId,
      departmentId: args.departmentId ?? null,
      episodeOfCareId: encounterEpisodeId,
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

  // Audit must commit/rollback with the encounter+note writes — pass the same
  // tx client so a transaction-commit failure doesn't leave orphan audit rows.
  await writeAuditLog({
    userId: args.actingUserId,
    orgId: args.orgId,
    action: 'ENCOUNTER_CREATED',
    resourceType: 'Encounter',
    resourceId: encounter.id,
    metadata: {
      source: args.scheduleId ? 'schedule' : 'adhoc',
      division,
      hasEpisodeLink: !!encounterEpisodeId,
      // Coerce explicit-link without picker context to 'picker' so the
      // metadata is still readable; only the truly-legacy case stays
      // 'unspecified'.
      pickerSource:
        resolvedSource === 'unspecified' && args.episodeOfCareId
          ? 'picker'
          : resolvedSource,
    },
    tx: args.tx,
  });

  return { encounter, note };
}
