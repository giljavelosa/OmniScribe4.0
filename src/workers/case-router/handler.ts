import type { Job } from 'bullmq';
import { CaseManagementStatus, NoteStatus, Prisma, RouterConfidence } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import {
  buildPriorCrossVisitContextBlock,
  CaseRouterService,
  type CaseRouterCaseInput,
  type CaseRouterInput,
  type CaseRouterProposal,
  type FhirConditionInput,
  type PriorCrossVisitContextInput,
  PERSONA_VERSION,
} from '@/services/copilot/case-router';
import {
  fetchPatientConditions,
  toFhirCitations,
  type FhirFetchErrorKind,
} from '@/services/copilot/case-router-fhir';
import { isFhirRouterEnabled } from '@/lib/case-management/fhir-router-config';
import { divisionForProfession } from '@/lib/professions';

type CaseRouterJob = {
  noteId: string;
  orgId: string;
};

/**
 * Sprint 0.13 — case-router BullMQ worker.
 *
 * Triggered by the ai-generation worker on completion (chain-enqueue, same
 * pattern as `enqueueNoteBriefJob`). Loads the just-drafted note, projects
 * the patient's open cases (excluding the encounter's PENDING_ROUTER case
 * itself), and asks Miss Cleo's case-router service for a structured
 * proposal. Writes the result to a `CaseRouterRun` row + audits
 * `CASE_ROUTER_PROPOSED`.
 *
 * Anti-regression rule 10: 3 retries with exponential backoff (queue
 * defaults). On terminal failure the catch wraps the error path and
 * still writes a synthetic LOW-confidence run so the review-screen
 * panel always renders.
 *
 * Anti-regression rule 8: audit writes are NOT wrapped in swallowing
 * try-catch. The catch below is for the *agent call* (so we can ship a
 * fallback proposal); audits use writeAuditLog which throws on PHI
 * violations and is intentionally not caught.
 *
 * Idempotency: stable jobId on noteId (queue.ts) collapses retries to
 * one Redis entry. The `CaseRouterRun.noteId` unique constraint
 * collapses concurrent writes to one DB row — we use upsert.
 */
export async function handle(job: Job<CaseRouterJob>) {
  const { noteId, orgId } = job.data;

  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId },
    include: {
      patient: { select: { id: true } },
      encounter: {
        select: {
          id: true,
          caseManagementId: true,
          clinicianOrgUserId: true,
        },
      },
    },
  });
  if (!note) {
    console.warn(`[case-router] note ${noteId} not found — dropping`);
    return { skipped: 'not_found' };
  }
  if (note.status === NoteStatus.SIGNED || note.status === NoteStatus.TRANSFERRED) {
    // Routing is locked at sign — the clinician confirmed before sign.
    return { skipped: 'note_signed' };
  }
  if (!note.encounter) {
    console.warn(`[case-router] note ${noteId} has no encounter — dropping`);
    return { skipped: 'no_encounter' };
  }

  const clinician = await prisma.orgUser.findUnique({
    where: { id: note.encounter.clinicianOrgUserId },
    select: { professionType: true, division: true },
  });
  const clinicianDivision = clinician
    ? divisionForProfession(clinician.professionType) ?? clinician.division
    : null;

  // Project the patient's open cases — excluding the PENDING_ROUTER case
  // the encounter is currently bound to. The agent has no business
  // proposing "attach to the just-created pending case" — that's the
  // promote-pending-to-active path, and it's covered by `open-new`.
  const cases = await loadCasesForRouter(prisma, {
    orgId,
    patientId: note.patientId,
    excludeCaseId: note.encounter.caseManagementId,
    clinicianOrgUserId: note.encounter.clinicianOrgUserId,
    viewerDivision: clinicianDivision,
  });

  const { assessmentSnippet, planSnippet } = extractAssessmentPlan(
    note.draftJson as Record<string, { content?: string }> | null,
    note.finalJson as { sections?: Array<{ id: string; label?: string; content: string }> } | null,
  );

  // Sprint 0.14 — load this clinician's CopilotPatientState if present
  // and format it as a cross-visit context block. State-absent path
  // behaves exactly as Sprint 0.13 (backward-compatible).
  const stateRow = await prisma.copilotPatientState.findUnique({
    where: {
      orgId_patientId_clinicianOrgUserId: {
        orgId,
        patientId: note.patientId,
        clinicianOrgUserId: note.encounter.clinicianOrgUserId,
      },
    },
    select: {
      caseAwarenessJson: true,
      observedPatternsJson: true,
      lastRebuiltAt: true,
    },
  });
  const priorCrossVisitContext = stateRow
    ? buildPriorCrossVisitContextBlock({
        caseAwareness: stateRow.caseAwarenessJson as PriorCrossVisitContextInput['caseAwareness'],
        observedPatterns: stateRow.observedPatternsJson as PriorCrossVisitContextInput['observedPatterns'],
        lastRebuiltAt: stateRow.lastRebuiltAt.toISOString(),
      })
    : null;

  // Sprint 0.15 — FHIR Phase D₁. Gated on org-level connection state
  // (decision 9): a non-FHIR org sees byte-identical Sprint-0.14
  // behavior. Patient-level link verification happens inside the
  // fetcher; we only emit CASE_ROUTER_FHIR_UNAVAILABLE for orgs that
  // HAVE FHIR wired but failed to read it for this patient. Patients
  // who were never linked are silent (decision 10 — backward
  // compatibility).
  //
  // Rule 10 compliance: the fetcher never throws — every failure path
  // returns { ok: false } so we never burn a BullMQ retry on a
  // transient FHIR issue. The agent runs with empty fhirConditions
  // and the routing decision still ships.
  let fhirConditions: FhirConditionInput[] = [];
  let fhirEhrSystem: string | null = null;
  let fhirErrorKind: FhirFetchErrorKind | null = null;
  if (await isFhirRouterEnabled(orgId)) {
    const fhirResult = await fetchPatientConditions({
      orgId,
      patientId: note.patientId,
    });
    if (fhirResult.ok) {
      fhirConditions = fhirResult.conditions;
      fhirEhrSystem = fhirResult.ehrSystem;
    } else {
      fhirErrorKind = fhirResult.errorKind;
    }
  }

  const input: CaseRouterInput = {
    noteId,
    orgId,
    patientId: note.patientId,
    assessmentSnippet,
    planSnippet,
    cases,
    clinicianDivision: clinicianDivision as CaseRouterInput['clinicianDivision'],
    noteDivision: note.division as CaseRouterInput['noteDivision'],
    priorCrossVisitContext,
    fhirConditions: fhirConditions.length > 0 ? fhirConditions : undefined,
  };

  const service = new CaseRouterService();
  let result;
  try {
    result = await service.propose(input);
  } catch (err) {
    // Bedrock-side failure or persistent infra issue. Throw so BullMQ
    // retries with exponential backoff (3 attempts per queue defaults,
    // anti-regression rule 10). On terminal exhaustion BullMQ will mark
    // the job failed; the panel falls back to the "Miss Cleo is
    // reviewing… (60s timeout → manual)" UI path.
    const errorClass = err instanceof Error ? err.name : 'Unknown';
    await writeAuditLog({
      orgId,
      action: 'CASE_ROUTER_PROPOSED',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: {
        outcome: 'agent_threw',
        errorClass,
        attempt: job.attemptsMade,
        personaVersion: PERSONA_VERSION,
      },
    });
    throw err;
  }

  const { proposal: rawProposal, modelVersion, modelId, stub, fallbackCause } = result;

  // Sprint 0.15 — stamp `fhirCitations` onto the proposal JSON so the
  // CaseRouterRun row carries a complete provenance record. We use the
  // worker-side projection (`toFhirCitations`) rather than trusting the
  // agent to echo back its own inputs — the agent already returned only
  // a single citation in `newCaseFromCondition` (the one it chose).
  const proposal: CaseRouterProposal = {
    ...rawProposal,
    ...(fhirConditions.length > 0
      ? { fhirCitations: toFhirCitations(fhirConditions) }
      : {}),
  };

  const created = await prisma.caseRouterRun.upsert({
    where: { noteId },
    create: {
      orgId,
      noteId,
      proposalJson: proposal as unknown as Prisma.InputJsonValue,
      confidence: zodConfidenceToEnum(proposal.confidence),
      reasoning: proposal.reasoning,
      modelVersion,
    },
    update: {
      proposalJson: proposal as unknown as Prisma.InputJsonValue,
      confidence: zodConfidenceToEnum(proposal.confidence),
      reasoning: proposal.reasoning,
      modelVersion,
    },
  });

  await writeAuditLog({
    orgId,
    action: 'CASE_ROUTER_PROPOSED',
    resourceType: 'CaseRouterRun',
    resourceId: created.id,
    metadata: {
      noteId,
      caseRouterRunId: created.id,
      confidence: proposal.confidence,
      modelVersion,
      // Sprint 0.14 — auditor lens: was this proposal informed by
      // Cleo's per-clinician memory? PHI-free (boolean only).
      hadPriorCrossVisitContext: !!priorCrossVisitContext,
      modelId,
      action: proposal.action,
      alternativesCount: proposal.alternatives.length,
      stub,
      ...(fallbackCause ? { fallbackCause } : {}),
      // Sprint 0.15 — auditor lens: how many verified Conditions did
      // Cleo have available? Distinguishes "no FHIR data offered" from
      // "FHIR data offered but agent chose a native case."
      fhirConditionInputCount: fhirConditions.length,
      // Sprint 0.12 — every AI-authored audit row carries the persona
      // version so a regulator can filter by persona.
      personaVersion: PERSONA_VERSION,
    },
  });

  // Sprint 0.15 — citation audit. Fires only when the run carried at
  // least one Condition through to the persisted proposalJson. PHI-free:
  // fhirIds are EHR-side identifiers, count is a structural number.
  if (proposal.fhirCitations && proposal.fhirCitations.length > 0) {
    await writeAuditLog({
      orgId,
      action: 'CASE_ROUTER_FHIR_CITED',
      resourceType: 'CaseRouterRun',
      resourceId: created.id,
      metadata: {
        caseRouterRunId: created.id,
        citationCount: proposal.fhirCitations.length,
        fhirIds: proposal.fhirCitations.map((c) => c.fhirId),
        ehrSystem: fhirEhrSystem,
        personaVersion: PERSONA_VERSION,
      },
    });
  }

  // Sprint 0.15 — degradation audit. Fires only when the org HAS FHIR
  // wired (so `isFhirRouterEnabled` returned true) AND the fetcher
  // returned a non-`not_linked` failure. The `not_linked` kind is
  // explicitly NOT audited — a patient who was never linked is the
  // baseline state, not a degraded one (decision 10).
  if (fhirErrorKind && fhirErrorKind !== 'not_linked') {
    await writeAuditLog({
      orgId,
      action: 'CASE_ROUTER_FHIR_UNAVAILABLE',
      resourceType: 'CaseRouterRun',
      resourceId: created.id,
      metadata: {
        caseRouterRunId: created.id,
        patientId: note.patientId,
        errorKind: fhirErrorKind,
        personaVersion: PERSONA_VERSION,
      },
    });
  }

  return { ok: true, caseRouterRunId: created.id, confidence: proposal.confidence };
}

// =============================================================================
// Helpers.
// =============================================================================

function zodConfidenceToEnum(c: CaseRouterProposal['confidence']): RouterConfidence {
  switch (c) {
    case 'high':
      return RouterConfidence.HIGH;
    case 'medium':
      return RouterConfidence.MEDIUM;
    case 'low':
    default:
      return RouterConfidence.LOW;
  }
}

/**
 * Best-effort extraction of Assessment + Plan section content from the
 * draft / finalJson. Matches FollowupExtractor's section-find heuristic
 * (label regex) so the routing reasoning operates on the same content
 * the clinician sees.
 */
function extractAssessmentPlan(
  draftJson: Record<string, { content?: string }> | null,
  finalJson: { sections?: Array<{ id: string; label?: string; content: string }> } | null,
): { assessmentSnippet: string; planSnippet: string } {
  // finalJson wins when present — it's the canonical attested form.
  if (finalJson?.sections?.length) {
    const find = (re: RegExp): string => {
      const sec = finalJson.sections!.find(
        (s) => (s.label && re.test(s.label)) || re.test(s.id),
      );
      return sec?.content ?? '';
    };
    return {
      assessmentSnippet: find(/assessment/i),
      planSnippet: find(/plan/i),
    };
  }
  // draftJson is keyed by section id; we don't carry labels here, so fall
  // back to id-based regex matching.
  if (draftJson) {
    const find = (re: RegExp): string => {
      const key = Object.keys(draftJson).find((k) => re.test(k));
      return (key && draftJson[key]?.content) || '';
    };
    return {
      assessmentSnippet: find(/assessment/i),
      planSnippet: find(/plan/i),
    };
  }
  return { assessmentSnippet: '', planSnippet: '' };
}

type LoadCasesArgs = {
  orgId: string;
  patientId: string;
  excludeCaseId: string;
  clinicianOrgUserId: string;
  viewerDivision: string | null;
};

async function loadCasesForRouter(
  client: typeof prisma,
  args: LoadCasesArgs,
): Promise<CaseRouterCaseInput[]> {
  const cases = await client.caseManagement.findMany({
    where: {
      orgId: args.orgId,
      patientId: args.patientId,
      id: { not: args.excludeCaseId },
      // Active routing is the common case; we include CLOSED so the agent
      // can recognize "this looks like a closed-out arc" but never proposes
      // routing into a non-bindable case (the API gate refuses).
      status: { in: [CaseManagementStatus.ACTIVE, CaseManagementStatus.CLOSED] },
    },
    select: {
      id: true,
      primaryIcd: true,
      primaryIcdLabel: true,
      secondaryIcd: true,
      secondaryIcdLabel: true,
      status: true,
      encounters: {
        select: {
          startedAt: true,
          clinicianOrgUserId: true,
          notes: {
            where: {
              status: { in: [NoteStatus.SIGNED, NoteStatus.TRANSFERRED] },
            },
            select: { signedAt: true, division: true, clinicianOrgUserId: true },
          },
        },
      },
    },
    orderBy: { openedAt: 'desc' },
  });

  return cases.map((c) => {
    const allActivities: Array<{
      iso: string;
      clinicianOrgUserId: string;
      division: string | null;
    }> = [];
    for (const enc of c.encounters) {
      // Encounter-level activity (works even for unsigned drafts but the
      // recency signal still fires for the auditor lens).
      if (enc.startedAt) {
        allActivities.push({
          iso: enc.startedAt.toISOString(),
          clinicianOrgUserId: enc.clinicianOrgUserId,
          division: null,
        });
      }
      for (const n of enc.notes) {
        if (n.signedAt) {
          allActivities.push({
            iso: n.signedAt.toISOString(),
            clinicianOrgUserId: n.clinicianOrgUserId,
            division: n.division,
          });
        }
      }
    }

    const viewerActivities = allActivities.filter(
      (a) => a.clinicianOrgUserId === args.clinicianOrgUserId,
    );
    const viewerDivisionActivities = args.viewerDivision
      ? allActivities.filter((a) => a.division === args.viewerDivision)
      : [];

    const latest = (rows: typeof allActivities): string | null =>
      rows.length === 0
        ? null
        : rows
            .map((r) => r.iso)
            .sort()
            .reverse()[0]!;

    return {
      id: c.id,
      primaryIcd: c.primaryIcd,
      primaryIcdLabel: c.primaryIcdLabel,
      secondaryIcd: c.secondaryIcd,
      secondaryIcdLabel: c.secondaryIcdLabel,
      status: c.status as CaseRouterCaseInput['status'],
      viewerLastActivityAt: latest(viewerActivities),
      viewerDivisionLastActivityAt: latest(viewerDivisionActivities),
      lastActivityAt: latest(allActivities),
      viewerDivisionVisitCount: viewerDivisionActivities.length,
    };
  });
}
