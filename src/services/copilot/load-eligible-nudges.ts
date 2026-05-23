import 'server-only';

import type {
  CleoNudge,
  CleoNudgeKind,
  CleoNudgePriority,
} from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { PERSONA_VERSION } from '@/services/copilot/persona';
import {
  ObservedPatternsJsonSchema,
  type ObservedPatternsJson,
} from '@/services/copilot/state-builder';
import {
  generateNudgeCandidates,
} from '@/services/copilot/nudge-generator';
import {
  selectNudgesForSurface,
  type SurfaceTarget,
} from '@/services/copilot/nudge-selector';
import type { NudgeCardData } from '@/components/cleo/nudge-card';

/**
 * Sprint 0.18 — page-level loader for the chart + visit-prepare
 * surfaces.
 *
 * Pulls the per-(patient × clinician) `CopilotPatientState` row to
 * get `observedPatternsJson`, the open `CleoNudge` rows, runs the
 * selector, and projects each surfaced row into a `NudgeCardData`
 * the UI can render. Also applies the read-time expiry sweep
 * (decision 8): rows whose underlying pattern is gone get flipped
 * to EXPIRED + audited in a small batch outside any swallowing
 * try-catch (rule 8).
 *
 * Returns an empty array when no projection state exists (decision
 * 10 — backward compat for patients pre-Sprint-0.14).
 */
export async function loadEligibleNudgesForSurface(args: {
  orgId: string;
  patientId: string;
  clinicianOrgUserId: string;
  surface: SurfaceTarget;
  now?: Date;
}): Promise<NudgeCardData[]> {
  const now = args.now ?? new Date();

  const state = await prisma.copilotPatientState.findUnique({
    where: {
      orgId_patientId_clinicianOrgUserId: {
        orgId: args.orgId,
        patientId: args.patientId,
        clinicianOrgUserId: args.clinicianOrgUserId,
      },
    },
    select: { observedPatternsJson: true },
  });
  // No projection yet — empty stack (decision 10).
  const observedPatterns: ObservedPatternsJson = state
    ? safeParseObservedPatterns(state.observedPatternsJson)
    : { patterns: [] };

  const existingRows = await prisma.cleoNudge.findMany({
    where: {
      orgId: args.orgId,
      patientId: args.patientId,
      clinicianOrgUserId: args.clinicianOrgUserId,
      status: { in: ['PROPOSED', 'SHOWN', 'SNOOZED'] },
    },
    orderBy: { proposedAt: 'desc' },
  });

  // Sprint 0.17 outcome state — feed the failures list so the
  // selector sees fresh candidates for proposals that haven't been
  // through a state-rebuild yet.
  const failedRows = await prisma.fhirWriteBackProposal.findMany({
    where: {
      orgId: args.orgId,
      patientId: args.patientId,
      status: 'FAILED',
      failureKind: { in: ['PERMANENT', 'CONFLICT'] },
    },
    select: {
      id: true,
      caseManagementId: true,
      failureKind: true,
      failureCount: true,
      failedAt: true,
    },
  });

  const candidates = generateNudgeCandidates({
    orgId: args.orgId,
    patientId: args.patientId,
    clinicianOrgUserId: args.clinicianOrgUserId,
    observedPatterns,
    pendingPermanentWritebackFailures: failedRows.map((r) => ({
      proposalId: r.id,
      caseManagementId: r.caseManagementId,
      failedAt: (r.failedAt ?? now).toISOString(),
      failureKind: r.failureKind === 'CONFLICT' ? 'CONFLICT' : 'PERMANENT',
      failureCount: r.failureCount,
    })),
  });

  const { surfaced, expired } = selectNudgesForSurface({
    candidates,
    existingRows,
    observedPatterns,
    surface: args.surface,
    now,
  });

  // Read-time expiry sweep (decision 8). Batch-flip + per-row audit
  // OUTSIDE any swallowing try-catch (rule 8).
  if (expired.length > 0) {
    await prisma.cleoNudge.updateMany({
      where: { id: { in: expired.map((r) => r.id) } },
      data: { status: 'EXPIRED', expiredAt: now },
    });
    for (const row of expired) {
      await writeAuditLog({
        orgId: args.orgId,
        action: 'CLEO_NUDGE_EXPIRED',
        resourceType: 'CleoNudge',
        resourceId: row.id,
        metadata: {
          nudgeId: row.id,
          kind: row.kind,
          priority: row.priority,
          personaVersion: PERSONA_VERSION,
        },
      });
    }
  }

  // Project surfaced rows into the UI shape.
  return surfaced.map(({ row }) => projectRowToCardData(row));
}

// =============================================================================
// Helpers.
// =============================================================================

function safeParseObservedPatterns(value: unknown): ObservedPatternsJson {
  const parsed = ObservedPatternsJsonSchema.safeParse(value);
  return parsed.success ? parsed.data : { patterns: [] };
}

/** Project a Cleo nudge row into the card payload the UI renders.
 *  The label + subtitle + affordanceHref are derived from the
 *  snapshot JSON — the row carries everything needed to re-render
 *  the moment-in-time card without re-reading the source pattern. */
function projectRowToCardData(row: CleoNudge): NudgeCardData {
  const snap = (row.sourcePatternSnapshotJson ?? {}) as Record<string, unknown>;
  const { label, subtitle, href } = renderForKind(row.kind, row.priority, snap);
  return {
    id: row.id,
    kind: row.kind,
    priority: row.priority,
    affordanceSlug: row.affordanceSlug as NudgeCardData['affordanceSlug'],
    label,
    subtitle,
    affordanceHref: href,
  };
}

function renderForKind(
  kind: CleoNudgeKind,
  _priority: CleoNudgePriority,
  snap: Record<string, unknown>,
): { label: string; subtitle?: string; href?: string } {
  switch (kind) {
    case 'RECERT_DUE_SOON': {
      const days = typeof snap.daysUntilDue === 'number' ? snap.daysUntilDue : null;
      const episodeId = typeof snap.episodeId === 'string' ? snap.episodeId : null;
      return {
        label: days !== null ? `Recert due in ${days} day${days === 1 ? '' : 's'}` : 'Recert due soon',
        subtitle: typeof snap.diagnosis === 'string' ? snap.diagnosis : undefined,
        href: episodeId ? `/episodes/${episodeId}` : undefined,
      };
    }
    case 'CASE_FHIR_STATUS_DRIFT': {
      const driftKind = typeof snap.driftKind === 'string' ? snap.driftKind : null;
      const caseId = typeof snap.caseManagementId === 'string' ? snap.caseManagementId : null;
      return {
        label:
          driftKind === 'ICD'
            ? 'EHR ICD differs from case'
            : 'EHR status differs from case',
        subtitle: 'Open reconcile to resolve',
        href: caseId ? `/cases/${caseId}#reconcile` : undefined,
      };
    }
    case 'FHIR_WRITEBACK_FAILED_PERMANENT': {
      const caseId = typeof snap.caseManagementId === 'string' ? snap.caseManagementId : null;
      const fk = typeof snap.failureKind === 'string' ? snap.failureKind : null;
      return {
        label: 'EHR write blocked — needs review',
        subtitle:
          fk === 'CONFLICT'
            ? 'EHR moved between detection + write.'
            : 'Permanent error — review the EHR side or cancel.',
        href: caseId ? `/cases/${caseId}` : undefined,
      };
    }
    case 'MEASURE_TREND': {
      const name = typeof snap.measureName === 'string' ? snap.measureName : null;
      const values = Array.isArray(snap.valuesWindow)
        ? (snap.valuesWindow as Array<number | string>)
        : null;
      const noteId = typeof snap.latestNoteId === 'string' ? snap.latestNoteId : null;
      return {
        label: name ? `${name} trending` : 'Measure trending',
        subtitle: values ? values.join(' → ') : undefined,
        href: noteId ? `/visits/${noteId}#plan` : undefined,
      };
    }
    case 'GOAL_STALLED': {
      const days =
        typeof snap.daysSinceLastProgress === 'number'
          ? snap.daysSinceLastProgress
          : null;
      const goalId = typeof snap.goalId === 'string' ? snap.goalId : null;
      return {
        label: typeof snap.goalText === 'string' ? snap.goalText : 'Goal stalled',
        subtitle: days !== null ? `No progress in ${days} days` : undefined,
        href: goalId ? `/goals/${goalId}` : undefined,
      };
    }
    case 'TOPIC_MENTIONED_UNADDRESSED': {
      const topic = typeof snap.topic === 'string' ? snap.topic : 'Topic';
      const count =
        typeof snap.occurrenceCount === 'number' ? snap.occurrenceCount : null;
      return {
        label: `${topic} mentioned across visits`,
        subtitle: count !== null ? `Mentioned ${count} times, not yet in plan` : undefined,
      };
    }
    default:
      return { label: 'Cleo noticed something' };
  }
}
