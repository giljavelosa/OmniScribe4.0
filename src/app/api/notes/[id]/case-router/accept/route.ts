import { NextResponse } from 'next/server';
import { z } from 'zod';
import { CaseManagementStatus, Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { enqueueCleoStateRefresh } from '@/lib/queue';
import { PERSONA_VERSION } from '@/services/copilot/persona';
import type { CaseRouterProposal } from '@/services/copilot/case-router';

export const runtime = 'nodejs';

/**
 * POST /api/notes/[id]/case-router/accept — Sprint 0.13.
 *
 * The clinician hits Confirm (or override) on Miss Cleo's case-routing
 * panel. In a single transaction we:
 *   - Resolve the chosen action (accept proposal, attach explicit, open new,
 *     attach with secondary).
 *   - Apply the rebind: encounter.caseManagementId flips when we're
 *     attaching to a different case + the source PENDING_ROUTER case is
 *     deleted; or the source PENDING_ROUTER case is promoted to ACTIVE
 *     when the choice is open-new.
 *   - Update the CaseRouterRun row's accepted{Action,At,ByUserId}.
 *   - Audit `CASE_ROUTER_ACCEPTED` (chosen == proposal) or
 *     `CASE_ROUTER_OVERRIDDEN` (chosen != proposal). Metadata documented
 *     in src/lib/audit/actions.ts.
 *
 * Authorization: NOTE_EDIT feature + clinician must be the note's author
 * OR an ORG_ADMIN. Same rule as section edits.
 *
 * Anti-regression rule 8: audit writes never wrapped in swallowing
 * try-catch. The transaction boundary commits writes + audits together;
 * a writeAuditLog throw rolls everything back.
 */

const decisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('accept') }),
  z.object({
    kind: z.literal('attach'),
    caseManagementId: z.string().min(1).max(64),
  }),
  z.object({
    kind: z.literal('open-new'),
    primaryIcd: z.string().min(1).max(16).nullable(),
    primaryIcdLabel: z.string().min(1).max(280),
    secondaryIcd: z.string().min(1).max(16).optional(),
    secondaryIcdLabel: z.string().min(1).max(280).optional(),
  }),
  z.object({
    kind: z.literal('attach-with-secondary'),
    caseManagementId: z.string().min(1).max(64),
    icd: z.string().min(1).max(16),
    icdLabel: z.string().min(1).max(280),
  }),
  // Sprint 0.15 — FHIR-backed "open new from condition" override path.
  // The clinician can also reach this branch implicitly via { kind:
  // "accept" } when the proposal's action is "open-new-from-condition";
  // an explicit kind is for the manual-override case (clinician picks
  // the FHIR-backed option in the radio list).
  z.object({
    kind: z.literal('open-new-from-condition'),
    fhirConditionId: z.string().min(1).max(128),
    primaryIcd: z.string().min(1).max(16),
    primaryIcdLabel: z.string().min(1).max(280),
    recordedDate: z.string().min(1).max(40),
    recorderName: z.string().max(160).nullable(),
  }),
]);

const bodySchema = z.object({
  caseRouterRunId: z.string().min(1).max(64),
  decision: decisionSchema,
});

type Decision = z.infer<typeof decisionSchema>;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_EDIT', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id: noteId } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }
  const body = parsed.data;

  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId: authorizationUser.orgId },
    select: {
      id: true,
      orgId: true,
      patientId: true,
      status: true,
      clinicianOrgUserId: true,
      encounterId: true,
      encounter: { select: { id: true, caseManagementId: true } },
    },
  });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  assertOrgScoped(note.orgId, authorizationUser.orgId);
  if (
    note.clinicianOrgUserId !== authorizationUser.orgUserId &&
    authorizationUser.role !== 'ORG_ADMIN'
  ) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }
  if (note.status === 'SIGNED' || note.status === 'TRANSFERRED') {
    return NextResponse.json(
      { error: { code: 'invalid_state', message: 'Routing is locked after sign.' } },
      { status: 409 },
    );
  }
  if (!note.encounter) {
    return NextResponse.json(
      { error: { code: 'invalid_state', message: 'Note has no encounter.' } },
      { status: 409 },
    );
  }

  const run = await prisma.caseRouterRun.findFirst({
    where: { id: body.caseRouterRunId, noteId, orgId: authorizationUser.orgId },
  });
  if (!run) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  if (run.acceptedAction) {
    return NextResponse.json(
      { error: { code: 'already_resolved', message: 'Routing already accepted.' } },
      { status: 409 },
    );
  }

  const proposal = run.proposalJson as unknown as CaseRouterProposal;

  // Resolve the effective decision. `accept` reads from the proposal;
  // anything else is the override path. The label below is the audit
  // discriminator.
  const resolved = resolveDecision(body.decision, proposal);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: resolved.error } },
      { status: 400 },
    );
  }
  const eff = resolved.value;
  const isOverride = body.decision.kind !== 'accept' || actionDiffersFromProposal(eff, proposal);

  const currentCaseId = note.encounter.caseManagementId;

  let appliedCaseId: string;
  try {
    const txResult = await prisma.$transaction(async (tx) => {
      // Look up current case so we can detect "promote-pending" vs "rebind".
      const currentCase = await tx.caseManagement.findUnique({
        where: { id: currentCaseId },
        select: { id: true, status: true },
      });
      if (!currentCase) {
        throw new Error('current_case_missing');
      }

      let appliedId: string;

      if (eff.kind === 'attach' || eff.kind === 'attach-with-secondary') {
        const targetCase = await tx.caseManagement.findFirst({
          where: {
            id: eff.caseManagementId,
            orgId: authorizationUser.orgId,
            patientId: note.patientId,
          },
          select: { id: true, status: true, secondaryIcd: true, secondaryIcdLabel: true },
        });
        if (!targetCase) {
          throw new TargetCaseError('case_not_found');
        }
        if (targetCase.status === CaseManagementStatus.CANCELLED) {
          throw new TargetCaseError('case_cancelled');
        }

        // Rebind the encounter only if the target differs from the
        // current case (otherwise no-op). Then delete the source case
        // when it's the PENDING_ROUTER row (no other encounters depend
        // on it — pending cases are 1:1 with their bind-time encounter).
        if (currentCase.id !== targetCase.id) {
          await tx.encounter.update({
            where: { id: note.encounter!.id },
            data: { caseManagementId: targetCase.id },
          });
          if (currentCase.status === CaseManagementStatus.PENDING_ROUTER) {
            await tx.caseManagement.delete({ where: { id: currentCase.id } });
          }
        }

        if (
          eff.kind === 'attach-with-secondary' &&
          !targetCase.secondaryIcd &&
          !targetCase.secondaryIcdLabel
        ) {
          await tx.caseManagement.update({
            where: { id: targetCase.id },
            data: {
              secondaryIcd: eff.icd,
              secondaryIcdLabel: eff.icdLabel,
            },
          });
        }
        appliedId = targetCase.id;
      } else if (eff.kind === 'open-new-from-condition') {
        // Sprint 0.15 — promote the pending case with a verified
        // FHIR-coded ICD + link via `mirrorsFhirConditionId`. Mirrors
        // the open-new branch's promote/create split: if the encounter
        // is on a PENDING_ROUTER row, promote in place; otherwise
        // create a fresh ACTIVE case and rebind. In both shapes the
        // case ends up with `primaryIcd` populated (never null — the
        // EHR coded it) and `mirrorsFhirConditionId` set.
        if (currentCase.status === CaseManagementStatus.PENDING_ROUTER) {
          await tx.caseManagement.update({
            where: { id: currentCase.id },
            data: {
              status: CaseManagementStatus.ACTIVE,
              primaryIcd: eff.primaryIcd,
              primaryIcdLabel: eff.primaryIcdLabel,
              mirrorsFhirConditionId: eff.fhirConditionId,
            },
          });
          appliedId = currentCase.id;
        } else {
          const created = await tx.caseManagement.create({
            data: {
              orgId: authorizationUser.orgId,
              patientId: note.patientId,
              primaryIcd: eff.primaryIcd,
              primaryIcdLabel: eff.primaryIcdLabel,
              status: CaseManagementStatus.ACTIVE,
              openedByOrgUserId: authorizationUser.orgUserId,
              mirrorsFhirConditionId: eff.fhirConditionId,
            },
            select: { id: true },
          });
          await tx.encounter.update({
            where: { id: note.encounter!.id },
            data: { caseManagementId: created.id },
          });
          appliedId = created.id;
        }
      } else {
        // open-new — promote the pending case if that's what's bound; else
        // create a new ACTIVE case + rebind. Promoting in-place preserves
        // the case id on the encounter so re-running this endpoint with
        // the same payload converges (idempotent at the data level).
        if (currentCase.status === CaseManagementStatus.PENDING_ROUTER) {
          await tx.caseManagement.update({
            where: { id: currentCase.id },
            data: {
              status: CaseManagementStatus.ACTIVE,
              primaryIcd: eff.primaryIcd ?? null,
              primaryIcdLabel: eff.primaryIcdLabel,
              secondaryIcd: eff.secondaryIcd ?? null,
              secondaryIcdLabel: eff.secondaryIcdLabel ?? null,
            },
          });
          appliedId = currentCase.id;
        } else {
          // Current case is already ACTIVE/CLOSED (e.g. clinician opened
          // review on a case-bound visit + then chose open-new). Create
          // a fresh case and rebind the encounter to it.
          const created = await tx.caseManagement.create({
            data: {
              orgId: authorizationUser.orgId,
              patientId: note.patientId,
              primaryIcd: eff.primaryIcd ?? null,
              primaryIcdLabel: eff.primaryIcdLabel,
              secondaryIcd: eff.secondaryIcd ?? null,
              secondaryIcdLabel: eff.secondaryIcdLabel ?? null,
              status: CaseManagementStatus.ACTIVE,
              openedByOrgUserId: authorizationUser.orgUserId,
            },
            select: { id: true },
          });
          await tx.encounter.update({
            where: { id: note.encounter!.id },
            data: { caseManagementId: created.id },
          });
          appliedId = created.id;
        }
      }

      // Stamp the run and audit inside the same tx so a failure rolls
      // back the data + the trail together.
      await tx.caseRouterRun.update({
        where: { id: run.id },
        data: {
          acceptedAction: auditDecisionLabel(body.decision, isOverride),
          acceptedAt: new Date(),
          acceptedByUserId: user.id,
        },
      });

      await writeAuditLog({
        userId: user.id,
        orgId: authorizationUser.orgId,
        action: isOverride ? 'CASE_ROUTER_OVERRIDDEN' : 'CASE_ROUTER_ACCEPTED',
        resourceType: 'CaseRouterRun',
        resourceId: run.id,
        metadata: isOverride
          ? {
              caseRouterRunId: run.id,
              proposedAction: proposal.action,
              chosenAction: eff.kind,
              caseManagementId: appliedId,
              personaVersion: PERSONA_VERSION,
            }
          : {
              caseRouterRunId: run.id,
              caseManagementId: appliedId,
              action: proposal.action,
              personaVersion: PERSONA_VERSION,
            },
        tx,
      });

      // Sprint 0.15 — when a case is created/promoted via a verified
      // Condition, emit a dedicated CASE_FHIR_LINKED audit so an
      // auditor can answer "which OmniScribe cases trace back to an
      // EHR Condition?" in one query. Inside the same transaction so
      // the case row + the link audit roll back together on failure.
      if (eff.kind === 'open-new-from-condition') {
        await writeAuditLog({
          userId: user.id,
          orgId: authorizationUser.orgId,
          action: 'CASE_FHIR_LINKED',
          resourceType: 'CaseManagement',
          resourceId: appliedId,
          metadata: {
            caseManagementId: appliedId,
            caseRouterRunId: run.id,
            fhirConditionId: eff.fhirConditionId,
            personaVersion: PERSONA_VERSION,
          },
          tx,
        });
      }

      return { appliedId };
    });
    appliedCaseId = txResult.appliedId;
  } catch (err) {
    if (err instanceof TargetCaseError) {
      return NextResponse.json(
        { error: { code: err.code } },
        { status: err.code === 'case_not_found' ? 404 : 409 },
      );
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    }
    throw err;
  }

  // Sprint 0.14 — chain-enqueue cleo-state refresh for the accepting
  // clinician. The new routing decision is a primary signal Miss Cleo's
  // state should reflect (routingConfidenceHistory on the affected case).
  // Throttled per-tuple (5-min bucket); wrapped so a Redis hiccup doesn't
  // 500 the accept — the routing has already committed.
  try {
    await enqueueCleoStateRefresh({
      orgId: authorizationUser.orgId,
      patientId: note.patientId,
      clinicianOrgUserId: authorizationUser.orgUserId,
    });
  } catch (e) {
    console.warn(
      '[case-router/accept] cleo-state refresh enqueue failed:',
      e instanceof Error ? e.message : e,
    );
  }

  return NextResponse.json({
    data: {
      caseRouterRunId: run.id,
      caseManagementId: appliedCaseId,
      override: isOverride,
    },
  });
}

// =============================================================================
// Helpers.
// =============================================================================

class TargetCaseError extends Error {
  constructor(readonly code: 'case_not_found' | 'case_cancelled') {
    super(code);
    this.name = 'TargetCaseError';
  }
}

type ResolvedDecision =
  | { kind: 'attach'; caseManagementId: string }
  | { kind: 'attach-with-secondary'; caseManagementId: string; icd: string; icdLabel: string }
  | {
      kind: 'open-new';
      primaryIcd: string | null;
      primaryIcdLabel: string;
      secondaryIcd?: string;
      secondaryIcdLabel?: string;
    }
  // Sprint 0.15 — promotes the pending case with a verified FHIR-coded
  // ICD + populates `mirrorsFhirConditionId`. The recorder + date fields
  // are carried through for audit metadata; the case row only stores
  // `mirrorsFhirConditionId` (provenance is reconstructable via the
  // FhirCachedResource cache + the CASE_FHIR_LINKED audit row).
  | {
      kind: 'open-new-from-condition';
      fhirConditionId: string;
      primaryIcd: string;
      primaryIcdLabel: string;
      recordedDate: string;
      recorderName: string | null;
    };

function resolveDecision(
  decision: Decision,
  proposal: CaseRouterProposal,
): { ok: true; value: ResolvedDecision } | { ok: false; error: string } {
  if (decision.kind === 'accept') {
    if (proposal.action === 'attach') {
      if (!proposal.caseManagementId) {
        return { ok: false, error: 'proposal_missing_case_id' };
      }
      return {
        ok: true,
        value: { kind: 'attach', caseManagementId: proposal.caseManagementId },
      };
    }
    if (proposal.action === 'attach-with-secondary') {
      if (!proposal.caseManagementId || !proposal.secondaryIcdAddition) {
        return { ok: false, error: 'proposal_missing_secondary' };
      }
      return {
        ok: true,
        value: {
          kind: 'attach-with-secondary',
          caseManagementId: proposal.caseManagementId,
          icd: proposal.secondaryIcdAddition.icd,
          icdLabel: proposal.secondaryIcdAddition.icdLabel,
        },
      };
    }
    if (proposal.action === 'open-new') {
      if (!proposal.newCase) return { ok: false, error: 'proposal_missing_newCase' };
      return {
        ok: true,
        value: {
          kind: 'open-new',
          primaryIcd: proposal.newCase.primaryIcd,
          primaryIcdLabel: proposal.newCase.primaryIcdLabel,
          secondaryIcd: proposal.newCase.secondaryIcd,
          secondaryIcdLabel: proposal.newCase.secondaryIcdLabel,
        },
      };
    }
    if (proposal.action === 'open-new-from-condition') {
      if (!proposal.newCaseFromCondition) {
        return { ok: false, error: 'proposal_missing_newCaseFromCondition' };
      }
      return {
        ok: true,
        value: {
          kind: 'open-new-from-condition',
          fhirConditionId: proposal.newCaseFromCondition.fhirConditionId,
          primaryIcd: proposal.newCaseFromCondition.primaryIcd,
          primaryIcdLabel: proposal.newCaseFromCondition.primaryIcdLabel,
          recordedDate: proposal.newCaseFromCondition.recordedDate,
          recorderName: proposal.newCaseFromCondition.recorderName,
        },
      };
    }
    return { ok: false, error: 'proposal_unknown_action' };
  }
  if (decision.kind === 'attach') {
    return { ok: true, value: { kind: 'attach', caseManagementId: decision.caseManagementId } };
  }
  if (decision.kind === 'attach-with-secondary') {
    return {
      ok: true,
      value: {
        kind: 'attach-with-secondary',
        caseManagementId: decision.caseManagementId,
        icd: decision.icd,
        icdLabel: decision.icdLabel,
      },
    };
  }
  if (decision.kind === 'open-new-from-condition') {
    return {
      ok: true,
      value: {
        kind: 'open-new-from-condition',
        fhirConditionId: decision.fhirConditionId,
        primaryIcd: decision.primaryIcd,
        primaryIcdLabel: decision.primaryIcdLabel,
        recordedDate: decision.recordedDate,
        recorderName: decision.recorderName,
      },
    };
  }
  return {
    ok: true,
    value: {
      kind: 'open-new',
      primaryIcd: decision.primaryIcd,
      primaryIcdLabel: decision.primaryIcdLabel,
      secondaryIcd: decision.secondaryIcd,
      secondaryIcdLabel: decision.secondaryIcdLabel,
    },
  };
}

function actionDiffersFromProposal(
  effective: ResolvedDecision,
  proposal: CaseRouterProposal,
): boolean {
  if (effective.kind === 'attach') return proposal.action !== 'attach';
  if (effective.kind === 'attach-with-secondary') {
    return proposal.action !== 'attach-with-secondary';
  }
  if (effective.kind === 'open-new-from-condition') {
    return proposal.action !== 'open-new-from-condition';
  }
  return proposal.action !== 'open-new';
}

function auditDecisionLabel(decision: Decision, isOverride: boolean): string {
  if (!isOverride) return 'accepted';
  if (decision.kind === 'attach') return 'overridden-attach';
  if (decision.kind === 'open-new') return 'overridden-open-new';
  if (decision.kind === 'open-new-from-condition') return 'overridden-open-new-from-condition';
  if (decision.kind === 'attach-with-secondary') return 'overridden-attach-with-secondary';
  // accept that resolved to a different action — rare; treat as manual override.
  return 'overridden-manual';
}
