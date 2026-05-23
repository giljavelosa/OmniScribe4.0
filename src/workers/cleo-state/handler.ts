import type { Job } from 'bullmq';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import {
  CLEO_STATE_GENERATOR_VERSION,
  buildStateProjections,
} from '@/services/copilot/state-builder';
import { PERSONA_VERSION } from '@/services/copilot/persona';

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

  return {
    ok: true,
    stateId: upserted.id,
    patternCount: projections.observedPatterns.patterns.length,
  };
}
