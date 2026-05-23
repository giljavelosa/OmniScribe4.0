import type { Job } from 'bullmq';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import {
  CLEO_STATE_GENERATOR_VERSION,
  buildStateProjections,
} from '@/services/copilot/state-builder';
import { PERSONA_VERSION } from '@/services/copilot/persona';
import {
  generateNudgeCandidates,
  type NudgeGeneratorPermanentFailure,
} from '@/services/copilot/nudge-generator';

type CleoStateRefreshJob = {
  orgId: string;
  patientId: string;
  clinicianOrgUserId: string;
};

/**
 * Sprint 0.14 — cleo-state BullMQ worker.
 *
 * Calls the pure `buildStateProjections` helper, upserts the row, and
 * audits `CLEO_STATE_REBUILT`. Rule 10: 3 retries / exponential backoff
 * (queue defaults). Rule 8: audit writes are not wrapped in swallowing
 * try-catch — a PHI-violation throw from writeAuditLog must surface so
 * a regression doesn't silently land bad metadata.
 *
 * Throttling lives at enqueue (queue.ts uses a 5-minute bucketed jobId);
 * the handler itself is idempotent on the unique (orgId, patientId,
 * clinicianOrgUserId) tuple via upsert.
 */
export async function handle(job: Job<CleoStateRefreshJob>) {
  const { orgId, patientId, clinicianOrgUserId } = job.data;
  const startedAt = Date.now();

  // Org-scope sanity — defense in depth. The producers (sign route +
  // ai-generation worker + accept route) already org-scope; this catches
  // a future caller that forgets.
  const orgUser = await prisma.orgUser.findUnique({
    where: { id: clinicianOrgUserId },
    select: { orgId: true },
  });
  if (!orgUser || orgUser.orgId !== orgId) {
    console.warn(
      `[cleo-state] clinician ${clinicianOrgUserId} not in org ${orgId} — dropping`,
    );
    return { skipped: 'clinician_org_mismatch' };
  }

  const projections = await buildStateProjections({
    orgId,
    patientId,
    clinicianOrgUserId,
  });

  const upserted = await prisma.copilotPatientState.upsert({
    where: {
      orgId_patientId_clinicianOrgUserId: {
        orgId,
        patientId,
        clinicianOrgUserId,
      },
    },
    create: {
      orgId,
      patientId,
      clinicianOrgUserId,
      caseAwarenessJson: projections.caseAwareness as unknown as Prisma.InputJsonValue,
      observedPatternsJson: projections.observedPatterns as unknown as Prisma.InputJsonValue,
      conversationFactsJson: projections.conversationFacts as unknown as Prisma.InputJsonValue,
      generatorVersion: CLEO_STATE_GENERATOR_VERSION,
    },
    update: {
      caseAwarenessJson: projections.caseAwareness as unknown as Prisma.InputJsonValue,
      observedPatternsJson: projections.observedPatterns as unknown as Prisma.InputJsonValue,
      conversationFactsJson: projections.conversationFacts as unknown as Prisma.InputJsonValue,
      generatorVersion: CLEO_STATE_GENERATOR_VERSION,
    },
  });

  // PHI-free audit metadata — structural counts + ids only. Specifically
  // NO topic / measure / goal text in here; that lives on the state row.
  await writeAuditLog({
    orgId,
    action: 'CLEO_STATE_REBUILT',
    resourceType: 'CopilotPatientState',
    resourceId: upserted.id,
    metadata: {
      stateId: upserted.id,
      patientId,
      clinicianOrgUserId,
      generatorVersion: CLEO_STATE_GENERATOR_VERSION,
      rebuildDurationMs: Date.now() - startedAt,
      patternCount: projections.observedPatterns.patterns.length,
      caseCount: projections.caseAwareness.cases.length,
      factCount: projections.conversationFacts.facts.length,
      personaVersion: PERSONA_VERSION,
    },
  });

  // Sprint 0.18 — proactive nudge generation. Rides the existing
  // cleo-state coalesce key (decision 12 + rule 18 — no new queue).
  // The generator is deterministic + rule-based (decision 11 — no
  // LLM in the nudge pathway). Each upserted row anchors a
  // CLEO_NUDGE_PROPOSED audit row OUTSIDE any swallowing try-catch
  // (rule 8); a unique-key collision on the compound key means the
  // generator has already produced this exact logical nudge and we
  // emit NO new audit (decision 1 — idempotency).
  const nudgeProposedCount = await generateAndPersistNudges({
    orgId,
    patientId,
    clinicianOrgUserId,
    observedPatterns: projections.observedPatterns,
  });

  return {
    ok: true,
    stateId: upserted.id,
    patternCount: projections.observedPatterns.patterns.length,
    nudgeProposedCount,
  };
}

/**
 * Sprint 0.18 — runs the pure generator, upserts each candidate via
 * the compound unique key `(clinicianOrgUserId, patientId, kind,
 * sourcePatternSnapshotHash)`, and emits one `CLEO_NUDGE_PROPOSED`
 * audit per CREATED row. Returns the count of NEW rows (the audit
 * count). Existing rows that the generator re-proposes (same hash)
 * are no-ops — their lifecycle state is preserved (decision 3a — a
 * new logical nudge requires a new hash).
 *
 * Anti-regression rule 8: audit calls are NOT in a swallowing
 * try-catch. A throw from `writeAuditLog` (e.g. PHI guard) surfaces
 * here and BullMQ retries the whole job — better than a silently
 * missing audit row.
 */
async function generateAndPersistNudges(args: {
  orgId: string;
  patientId: string;
  clinicianOrgUserId: string;
  observedPatterns: Parameters<typeof generateNudgeCandidates>[0]['observedPatterns'];
}): Promise<number> {
  // Sprint 0.17 outcome state — pull non-transient write-back
  // failures so the generator can surface them as proactive nudges
  // even on a state-rebuild that happens BEFORE the next
  // observedPatterns rebuild picks up the FAILED row. (The state
  // builder's detector ALSO emits this kind; the generator's dedup
  // by hash makes the dual path idempotent.)
  const failedRows = await prisma.fhirWriteBackProposal.findMany({
    where: {
      orgId: args.orgId,
      patientId: args.patientId,
      status: 'FAILED',
      failureKind: { in: ['PERMANENT', 'CONFLICT'] },
    },
    orderBy: { failedAt: 'desc' },
    select: {
      id: true,
      caseManagementId: true,
      failureKind: true,
      failureCount: true,
      failedAt: true,
    },
  });
  const failures: NudgeGeneratorPermanentFailure[] = failedRows.map((r) => ({
    proposalId: r.id,
    caseManagementId: r.caseManagementId,
    failedAt: (r.failedAt ?? new Date()).toISOString(),
    failureKind: r.failureKind === 'CONFLICT' ? 'CONFLICT' : 'PERMANENT',
    failureCount: r.failureCount,
  }));

  const candidates = generateNudgeCandidates({
    orgId: args.orgId,
    patientId: args.patientId,
    clinicianOrgUserId: args.clinicianOrgUserId,
    observedPatterns: args.observedPatterns,
    pendingPermanentWritebackFailures: failures,
  });

  if (candidates.length === 0) return 0;

  let createdCount = 0;
  for (const cand of candidates) {
    // findFirst + create is the safe pattern when the unique key
    // collides with a SHOWN/DISMISSED/ACTED row whose state we MUST
    // preserve (an upsert with an empty update is also acceptable;
    // we use create-or-skip semantics so the audit cleanly tracks
    // "new logical nudge" — repeated runs on the same patterns
    // never re-audit).
    const existing = await prisma.cleoNudge.findUnique({
      where: {
        clinicianOrgUserId_patientId_kind_sourcePatternSnapshotHash: {
          clinicianOrgUserId: args.clinicianOrgUserId,
          patientId: args.patientId,
          kind: cand.kind,
          sourcePatternSnapshotHash: cand.sourcePatternSnapshotHash,
        },
      },
      select: { id: true },
    });
    if (existing) continue;

    const created = await prisma.cleoNudge.create({
      data: {
        orgId: args.orgId,
        patientId: args.patientId,
        clinicianOrgUserId: args.clinicianOrgUserId,
        kind: cand.kind,
        priority: cand.priority,
        eligibleSurfaces: cand.eligibleSurfaces,
        sourcePatternSnapshotHash: cand.sourcePatternSnapshotHash,
        sourcePatternSnapshotJson:
          cand.sourcePatternSnapshotJson as unknown as Prisma.InputJsonValue,
        affordanceSlug: cand.affordanceSlug,
        status: 'PROPOSED',
      },
      select: { id: true, kind: true, priority: true, affordanceSlug: true },
    });
    await writeAuditLog({
      orgId: args.orgId,
      action: 'CLEO_NUDGE_PROPOSED',
      resourceType: 'CleoNudge',
      resourceId: created.id,
      metadata: {
        nudgeId: created.id,
        kind: created.kind,
        priority: created.priority,
        affordanceSlug: created.affordanceSlug,
        personaVersion: PERSONA_VERSION,
      },
    });
    createdCount += 1;
  }
  return createdCount;
}
