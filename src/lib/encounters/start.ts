/**
 * Shared "start a visit" pipeline — minting Encounter + Note from either a
 * scheduled appointment (POST /api/schedules/[id]/start) or an ad-hoc create
 * (POST /api/encounters). Keeps the audit-log + division-resolution logic in
 * exactly one place.
 *
 * Note.division is LOCKED here per spec §E. Unit 05 reads it as immutable.
 */

import {
  Prisma,
  type PrismaClient,
  CaseManagementStatus,
  Division,
  EncounterStatus,
  ScheduleStatus,
  NoteStatus,
} from '@prisma/client';

import { writeAuditLog } from '@/lib/audit/log';
import { resolveDivisionForNote } from '@/lib/divisions/resolve';
import { assertCaseIsOpen, mayLinkEpisodeOnEncounter } from '@/lib/case-management/validate';

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
  /**
   * Sprint 0.11 — every encounter anchors to a CaseManagement. Optional
   * since Sprint 0.13: when omitted, startVisit auto-creates a
   * `PENDING_ROUTER` case and binds the encounter to it. The
   * "every encounter has a case" invariant is preserved either way.
   */
  caseManagementId?: string | null;
  episodeOfCareId?: string | null;
  actingUserId: string;
  pickerSource?: PickerSource;
  /**
   * Late-entry charting (spec: context/specs/late-entry-charting.md).
   * Caller-supplied values; the route already validated dateOfService against
   * the 30-day floor + today ceiling, computed isLateEntry, and computed
   * lateEntryDaysGap. We just persist them onto the new Note. Omit all three
   * for normal visits — Note.dateOfService defaults to encounter.startedAt
   * in that case.
   */
  dateOfService?: Date | null;
  isLateEntry?: boolean;
  lateEntryDaysGap?: number | null;
};

export async function startVisit(args: StartVisitArgs) {
  const [patient, org, clinician, caseRow, explicitEpisode] = await Promise.all([
    args.tx.patient.findUnique({ where: { id: args.patientId }, select: { id: true } }),
    args.tx.organization.findUnique({
      where: { id: args.orgId },
      select: { division: true, defaultDivision: true },
    }),
    args.tx.orgUser.findUnique({
      where: { id: args.clinicianOrgUserId },
      select: { professionType: true, division: true },
    }),
    args.caseManagementId
      ? args.tx.caseManagement.findFirst({
          where: {
            id: args.caseManagementId,
            patientId: args.patientId,
            orgId: args.orgId,
          },
          select: { id: true, status: true },
        })
      : Promise.resolve(null),
    args.episodeOfCareId && args.caseManagementId
      ? args.tx.episodeOfCare.findFirst({
          where: {
            id: args.episodeOfCareId,
            caseManagementId: args.caseManagementId,
            patientId: args.patientId,
            division: Division.REHAB,
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);
  if (!patient) throw new Error('startVisit: patient missing');
  if (!org) throw new Error('startVisit: org missing');
  if (!clinician) throw new Error('startVisit: clinician OrgUser missing');

  // Sprint 0.13 — caseManagementId is optional now. When the caller passed
  // one, it must exist + be open (ACTIVE or PENDING_ROUTER). When the caller
  // omitted it, we create a PENDING_ROUTER case in the same tx so Miss
  // Cleo's case-router worker can settle the routing at review time.
  let caseManagementIdForEncounter: string;
  if (args.caseManagementId) {
    if (!caseRow) throw new Error('startVisit: caseManagement missing');
    assertCaseIsOpen(caseRow.status);
    caseManagementIdForEncounter = caseRow.id;
  } else {
    const pending = await args.tx.caseManagement.create({
      data: {
        orgId: args.orgId,
        patientId: args.patientId,
        primaryIcd: null,
        primaryIcdLabel: 'Routing in progress',
        status: CaseManagementStatus.PENDING_ROUTER,
        openedByOrgUserId: args.clinicianOrgUserId,
        openedAt: new Date(),
      },
      select: { id: true },
    });
    caseManagementIdForEncounter = pending.id;
  }

  const division = resolveDivisionForNote({
    clinician: { professionType: clinician.professionType, division: clinician.division },
    org,
  });

  // Auto-link to the case's single ACTIVE rehab episode when caller omitted one
  // and the note division is REHAB. A pending-router case has no episodes
  // yet (we just created it); the loop below short-circuits to auto-none.
  let episode: { id: string } | null = explicitEpisode;
  let resolvedSource: PickerSource = args.pickerSource ?? 'unspecified';
  if (!episode && !args.episodeOfCareId && division === Division.REHAB) {
    const active = await args.tx.episodeOfCare.findMany({
      where: {
        caseManagementId: caseManagementIdForEncounter,
        patientId: args.patientId,
        status: 'ACTIVE',
      },
      select: { id: true },
      take: 2,
    });
    if (active.length === 1) {
      episode = active[0]!;
      if (resolvedSource === 'unspecified') resolvedSource = 'auto-single';
    } else if (active.length === 0 && resolvedSource === 'unspecified') {
      resolvedSource = 'auto-none';
    }
  }

  let encounterEpisodeId: string | null =
    division === Division.REHAB ? (args.episodeOfCareId ?? episode?.id ?? null) : null;

  if (
    !mayLinkEpisodeOnEncounter({
      noteDivision: division,
      episodeOfCareId: encounterEpisodeId,
    })
  ) {
    encounterEpisodeId = null;
  }

  const encounter = await args.tx.encounter.create({
    data: {
      orgId: args.orgId,
      patientId: args.patientId,
      clinicianOrgUserId: args.clinicianOrgUserId,
      siteId: args.siteId,
      roomId: args.roomId ?? null,
      scheduleId: args.scheduleId,
      departmentId: args.departmentId ?? null,
      caseManagementId: caseManagementIdForEncounter,
      episodeOfCareId: encounterEpisodeId,
      status: EncounterStatus.IN_PROGRESS,
      startedAt: new Date(),
    },
  });

  // Late-entry charting. When NOT a late entry, dateOfService anchors to the
  // encounter's startedAt so the column always has a meaningful "when did
  // care happen" value (matches the schema-default semantics). Encounter
  // startedAt is nullable in the schema; we always pass `new Date()` above,
  // but the fallback chain still belt-and-suspenders to `new Date()` so we
  // never persist a null dateOfService (column is NOT NULL).
  const isLateEntry = !!args.isLateEntry;
  const dateOfService: Date = args.dateOfService ?? encounter.startedAt ?? new Date();
  const lateEntryDaysGap = isLateEntry ? args.lateEntryDaysGap ?? null : null;

  const note = await args.tx.note.create({
    data: {
      orgId: args.orgId,
      patientId: args.patientId,
      encounterId: encounter.id,
      clinicianOrgUserId: args.clinicianOrgUserId,
      division,
      status: NoteStatus.PREPARING,
      dateOfService,
      isLateEntry,
      lateEntryDaysGap,
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
      caseManagementId: caseManagementIdForEncounter,
      caseRoutingPending: !args.caseManagementId,
      hasEpisodeLink: !!encounterEpisodeId,
      // Coerce explicit-link without picker context to 'picker' so the
      // metadata is still readable; only the truly-legacy case stays
      // 'unspecified'.
      pickerSource:
        resolvedSource === 'unspecified' && args.episodeOfCareId
          ? 'picker'
          : resolvedSource,
      isLateEntry,
    },
    tx: args.tx,
  });

  // Per-note late-entry audit row (spec § Audit additions). PHI-free —
  // dateOfService + day-gap only; no clinical content.
  if (isLateEntry) {
    await writeAuditLog({
      userId: args.actingUserId,
      orgId: args.orgId,
      action: 'NOTE_LATE_ENTRY_CREATED',
      resourceType: 'Note',
      resourceId: note.id,
      metadata: {
        dateOfService: dateOfService.toISOString(),
        lateEntryDaysGap,
      },
      tx: args.tx,
    });
  }

  return { encounter, note };
}
