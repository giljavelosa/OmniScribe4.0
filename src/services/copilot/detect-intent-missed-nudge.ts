// Server-only by import chain (Prisma + writeAuditLog). The explicit
// `server-only` marker is omitted because the test harness can't
// resolve it (Next.js synthesizes the module at build time, not in
// vitest); the import chain enforces the boundary at runtime.

import { EncounterIntent, type Division } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { PERSONA_VERSION } from '@/services/copilot/persona';
import { proposeIntent } from '@/services/copilot/intent-proposer';
import { isIntentAwarePairSupported } from '@/services/brief/IntentAwareBriefGenerator';
import { INTENT_DISPLAY_LABEL } from '@/services/copilot/intent-labels';

/**
 * Unit 48 PR5 — visit-type intent nudge safety net.
 *
 * Detects when the current encounter has `intent=UNSPECIFIED` AND the
 * deterministic IntentProposer would propose a SUPPORTED_INTENT_PAIRS
 * pair with medium/high confidence (i.e., the clinician dismissed
 * Cleo's chip at start-visit time without picking, or the auto-post
 * fired before the chip could engage). Upserts a `CleoNudge` row of
 * kind `INTENT_PROPOSAL_MISSED` so the visit-prepare nudge block
 * surfaces a "Heads up — this should be a Progress Note today.
 * Generate accordingly?" prompt with a single Apply-intent action.
 *
 * Idempotent via the compound unique key
 * (clinicianOrgUserId, patientId, kind, sourcePatternSnapshotHash) —
 * the snapshot hash includes the encounterId so re-loading /prepare
 * for the same encounter doesn't duplicate.
 *
 * Returns silently when:
 *   - encounter already has a non-UNSPECIFIED intent (nothing to fix)
 *   - proposer returns UNSPECIFIED or low confidence (no clear
 *     recommendation; clinician picks intent manually)
 *   - the proposed pair isn't yet in SUPPORTED_INTENT_PAIRS (no spine
 *     to render against; PR4 ships the four MVP pairs, future units
 *     add more)
 *   - a CleoNudge row already exists for this encounter (idempotent)
 *
 * Failure-tolerant: any internal error is logged + swallowed (no
 * throw) so prepare-page render isn't blocked by a nudge detector
 * hiccup. Audit captures `CLEO_NUDGE_PROPOSED` (rule 8 — no swallow
 * on audit) when a row gets created.
 */
export type DetectIntentMissedNudgeArgs = {
  orgId: string;
  patientId: string;
  clinicianOrgUserId: string;
  /** Clinician's division — drives proposer routing. */
  division: Division;
  /** Current encounter being prepared. */
  encounterId: string;
  /** Current encounter's recorded intent. Detector exits when this
   *  is anything other than UNSPECIFIED. */
  currentIntent: EncounterIntent;
  /** Current note's id (for the audit metadata + the affordance's
   *  back-link if needed). */
  noteId: string;
  /** Optional schedule id — when present, proposer reads
   *  schedule.notes for family/group/acute heuristics. */
  scheduleId?: string | null;
  /** Optional episode id — when present, scopes the proposer's prior-
   *  notes lookup + episode-state signals. */
  episodeId?: string | null;
};

export async function detectIntentMissedNudge(
  args: DetectIntentMissedNudgeArgs,
): Promise<void> {
  // 1. Fast exits — nothing to do when intent already set.
  if (args.currentIntent !== EncounterIntent.UNSPECIFIED) return;

  try {
    // 2. Pull the same projection the /proposed-intent endpoint uses.
    const [episode, scheduleRow, priorNotes, patient] = await Promise.all([
      args.episodeId
        ? prisma.episodeOfCare.findFirst({
            where: { id: args.episodeId, orgId: args.orgId, patientId: args.patientId },
          })
        : Promise.resolve(null),
      args.scheduleId
        ? prisma.schedule.findFirst({
            where: { id: args.scheduleId, orgId: args.orgId, patientId: args.patientId },
            select: { id: true, notes: true },
          })
        : Promise.resolve(null),
      prisma.note.findMany({
        where: {
          patientId: args.patientId,
          orgId: args.orgId,
          status: { in: ['SIGNED', 'TRANSFERRED'] },
          ...(args.episodeId ? { encounter: { episodeOfCareId: args.episodeId } } : {}),
        },
        select: { signedAt: true, encounter: { select: { intent: true } } },
        orderBy: { signedAt: 'asc' },
      }),
      prisma.patient.findFirst({
        where: { id: args.patientId, orgId: args.orgId },
        select: { dob: true },
      }),
    ]);

    const projectedEpisode = episode
      ? {
          status: episode.status as 'ACTIVE' | 'RECERT_DUE' | 'DISCHARGED' | 'CANCELLED',
          visitsCompleted: episode.visitsCompleted,
          startedAt: episode.startedAt,
          recertDueAt: episode.recertDueAt,
          lastProgressNoteAt: lastProgressNoteAtFrom(priorNotes),
          visitsSinceLastProgressNote: visitsSinceLastProgressNoteFrom(priorNotes),
        }
      : null;

    const projectedPriorNotes = priorNotes
      .filter((n) => n.signedAt !== null)
      .map((n) => ({
        signedAt: n.signedAt!,
        intent: n.encounter?.intent ?? EncounterIntent.UNSPECIFIED,
      }));

    const age = patient?.dob
      ? Math.floor((Date.now() - patient.dob.getTime()) / 31_557_600_000)
      : null;
    const projectedPatient = patient
      ? {
          medicareEligible: age !== null && age >= 65,
          lastAWVAt: null,
          lastHospitalDischargeAt: null,
          enrolledInCCM: false,
          daysSinceLastSeenInGroup: null,
        }
      : null;

    // 3. Run the proposer (pure, deterministic, ~sub-ms).
    const proposal = proposeIntent({
      division: args.division,
      episode: projectedEpisode,
      priorNotes: projectedPriorNotes,
      schedule: scheduleRow ? { notes: scheduleRow.notes } : null,
      patient: projectedPatient,
    });

    // 4. Filter — only fire when the proposed pair is one we can
    //    actually shape the brief for, and proposer is confident enough.
    if (proposal.intent === EncounterIntent.UNSPECIFIED) return;
    if (proposal.confidence === 'low') return;
    if (!isIntentAwarePairSupported(args.division, proposal.intent)) return;

    // 5. Stable snapshot hash includes the encounterId (per-encounter
    //    idempotency) + the proposed intent (escalation axis if the
    //    proposed intent changes during the day, which is rare).
    const snapshotHash = `intent-missed:${args.encounterId}:${proposal.intent}`;

    const snapshotJson = {
      encounterId: args.encounterId,
      noteId: args.noteId,
      proposedIntent: proposal.intent,
      proposedIntentLabel: INTENT_DISPLAY_LABEL[proposal.intent],
      reason: proposal.reason,
      confidence: proposal.confidence,
      division: args.division,
    };

    // 6. Upsert pattern — findUnique + create. Existing rows (any
    //    status) get left alone (idempotent re-runs).
    const existing = await prisma.cleoNudge.findUnique({
      where: {
        clinicianOrgUserId_patientId_kind_sourcePatternSnapshotHash: {
          clinicianOrgUserId: args.clinicianOrgUserId,
          patientId: args.patientId,
          kind: 'INTENT_PROPOSAL_MISSED',
          sourcePatternSnapshotHash: snapshotHash,
        },
      },
      select: { id: true },
    });
    if (existing) return;

    const created = await prisma.cleoNudge.create({
      data: {
        orgId: args.orgId,
        patientId: args.patientId,
        clinicianOrgUserId: args.clinicianOrgUserId,
        kind: 'INTENT_PROPOSAL_MISSED',
        priority: 'MEDIUM',
        eligibleSurfaces: 'VISIT_PREPARE',
        sourcePatternSnapshotHash: snapshotHash,
        sourcePatternSnapshotJson: snapshotJson,
        affordanceSlug: 'apply-intent-proposal',
        status: 'PROPOSED',
      },
      select: { id: true },
    });

    await writeAuditLog({
      orgId: args.orgId,
      action: 'CLEO_NUDGE_PROPOSED',
      resourceType: 'CleoNudge',
      resourceId: created.id,
      metadata: {
        nudgeId: created.id,
        kind: 'INTENT_PROPOSAL_MISSED',
        priority: 'MEDIUM',
        affordanceSlug: 'apply-intent-proposal',
        personaVersion: PERSONA_VERSION,
        // PHI-free — only categorical data.
        proposedIntent: proposal.intent,
        confidence: proposal.confidence,
        encounterId: args.encounterId,
      },
    });
  } catch (err) {
    // Decision 7 (Cleo's latency never blocks visit start) extended:
    // a nudge detector failure must not block /prepare render either.
    console.warn(
      '[detect-intent-missed-nudge] failed; continuing without nudge:',
      err instanceof Error ? err.message : err,
    );
  }
}

// =============================================================================
// Helpers — mirror the projector in /api/patients/[id]/proposed-intent
// so detector + endpoint agree on the proposer's input shape.
// =============================================================================

type PriorRow = {
  signedAt: Date | null;
  encounter: { intent: EncounterIntent } | null;
};

function lastProgressNoteAtFrom(priorNotes: PriorRow[]): Date | null {
  for (let i = priorNotes.length - 1; i >= 0; i--) {
    const n = priorNotes[i]!;
    if (n.encounter?.intent === EncounterIntent.REHAB_PROGRESS_NOTE) {
      return n.signedAt ?? null;
    }
  }
  return null;
}

function visitsSinceLastProgressNoteFrom(priorNotes: PriorRow[]): number {
  for (let i = priorNotes.length - 1; i >= 0; i--) {
    const n = priorNotes[i]!;
    if (n.encounter?.intent === EncounterIntent.REHAB_PROGRESS_NOTE) {
      return priorNotes.length - 1 - i;
    }
  }
  return priorNotes.length;
}
