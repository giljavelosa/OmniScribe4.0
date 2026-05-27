import { NextResponse } from 'next/server';
import { z } from 'zod';
import { CaseManagementStatus, Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { assertOrgScoped } from '@/lib/phi-access';
import { enqueueCleoStateRefresh } from '@/lib/queue';
import { PERSONA_VERSION } from '@/services/copilot/persona';
import {
  ROUTING_PLACEHOLDER_LABEL,
  type CaseRouterProposal,
} from '@/services/copilot/case-router';
import {
  proposeWriteBack,
  type BuildPayloadInput,
  type CaseWriteBackTrigger,
  type ExistingConditionSnapshot,
} from '@/services/fhir/case-writeback';

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
  // Sprint 0.16 — FHIR Phase D₂ reconcile. Always carries an explicit
  // `driftLogId` + a `resolution` discriminated by the resolution-kind
  // enum (see the case-router's `reconcileProposal.resolutionOptions`).
  // The UI sends this on Confirm whether the clinician accepted the
  // agent's `recommendedOptionIndex` or picked a different option from
  // the radio list — the API treats both paths as explicit decisions.
  z.object({
    kind: z.literal('reconcile'),
    driftLogId: z.string().min(1).max(64),
    resolution: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('reopen-case') }),
      z.object({ kind: z.literal('attach-as-is') }),
      z.object({
        kind: z.literal('close-case'),
        reason: z.string().max(200).optional(),
      }),
      z.object({
        kind: z.literal('open-new-case'),
        primaryIcd: z.string().min(1).max(16),
        primaryIcdLabel: z.string().min(1).max(280),
      }),
      z.object({
        kind: z.literal('update-case-icd'),
        newIcd: z.string().min(1).max(16),
        newIcdLabel: z.string().min(1).max(280),
      }),
    ]),
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
      encounter: {
        select: {
          id: true,
          caseManagementId: true,
          // Sprint 0.13 Decision 3 rescue path — see SIGNED guard below.
          caseManagement: { select: { status: true } },
        },
      },
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
    // Narrow rescue path: a signed note whose case is STILL PENDING_ROUTER
    // means routing was never resolved pre-sign (the Cleo fallback bug, now
    // fixed, was the historical source). Allow the clinician to resolve it
    // post-sign — this is the same routing decision they would have made
    // pre-sign, not a re-route of an already-decided chart. Any other
    // signed-note accept attempt is still locked.
    const isPendingRouterRescue =
      note.encounter?.caseManagement?.status === 'PENDING_ROUTER';
    if (!isPendingRouterRescue) {
      return NextResponse.json(
        { error: { code: 'invalid_state', message: 'Routing is locked after sign.' } },
        { status: 409 },
      );
    }
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

  // Refuse to persist the synthetic fallback proposal as-is. When Miss
  // Cleo's LLM is unavailable, the router service returns an `open-new`
  // proposal with `primaryIcd: null` and the literal placeholder label.
  // Without this guard, hitting Accept promotes the PENDING_ROUTER case
  // to ACTIVE with a junk label and no ICD — appearing as a perpetually
  // "Routing in progress" case in the chart. The clinician must instead
  // send `kind: 'open-new'` with a typed ICD + label (or pick `attach`).
  if (
    eff.kind === 'open-new' &&
    eff.primaryIcd === null &&
    eff.primaryIcdLabel === ROUTING_PLACEHOLDER_LABEL
  ) {
    return NextResponse.json(
      {
        error: {
          code: 'manual_coding_required',
          message:
            'Miss Cleo could not auto-code this visit. Enter a primary ICD code and diagnosis before opening the case.',
        },
      },
      { status: 400 },
    );
  }

  const isOverride = body.decision.kind !== 'accept' || actionDiffersFromProposal(eff, proposal);

  const currentCaseId = note.encounter.caseManagementId;

  let appliedCaseId: string;
  // Sprint 0.17 — captured inside the tx (when eligible), returned in
  // the response so the UI knows whether to render the inline
  // "Write to EHR?" section. Null when write-back is disabled or the
  // action isn't write-back eligible — the UI hides the section.
  let writeBackProposalForResponse: WriteBackProposalResponseSummary | null = null;
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
      } else if (eff.kind === 'reconcile') {
        // Sprint 0.16 — FHIR Phase D₂ reconciliation. The clinician
        // picked one of the five resolution options against a specific
        // open drift log. We:
        //   1. Load the drift log row, verify it's open + matches
        //      the patient + org.
        //   2. Execute the resolution-specific case mutation +
        //      encounter rebind (per-kind contract below).
        //   3. Resolve the drift log row atomically with the mutation.
        //   4. Emit `CASE_FHIR_DRIFT_RESOLVED` inside the same tx
        //      (rule 8 — never swallowed; a throw rolls the whole
        //      reconciliation back).
        const driftLog = await tx.caseFhirDriftLog.findFirst({
          where: {
            id: eff.driftLogId,
            orgId: authorizationUser.orgId,
            patientId: note.patientId,
          },
          select: {
            id: true,
            caseManagementId: true,
            resolvedAt: true,
          },
        });
        if (!driftLog) throw new TargetCaseError('case_not_found');
        if (driftLog.resolvedAt) {
          throw new ReconcileAlreadyResolvedError();
        }

        const driftedCaseId = driftLog.caseManagementId;
        const driftedCase = await tx.caseManagement.findFirst({
          where: {
            id: driftedCaseId,
            orgId: authorizationUser.orgId,
            patientId: note.patientId,
          },
          select: { id: true, status: true },
        });
        if (!driftedCase) throw new TargetCaseError('case_not_found');

        const resolution = eff.resolution;
        switch (resolution.kind) {
          case 'reopen-case': {
            // Flip the drifted case back to ACTIVE. Bind the encounter
            // to it. If the encounter was on a PENDING_ROUTER row,
            // delete that row to avoid orphaned pending cases.
            await tx.caseManagement.update({
              where: { id: driftedCase.id },
              data: { status: CaseManagementStatus.ACTIVE },
            });
            if (currentCase.id !== driftedCase.id) {
              await tx.encounter.update({
                where: { id: note.encounter!.id },
                data: { caseManagementId: driftedCase.id },
              });
              if (currentCase.status === CaseManagementStatus.PENDING_ROUTER) {
                await tx.caseManagement.delete({ where: { id: currentCase.id } });
              }
            }
            appliedId = driftedCase.id;
            break;
          }
          case 'attach-as-is': {
            // No status change on the drifted case (the clinician
            // chose to defer reconciliation). Just bind the encounter.
            if (currentCase.id !== driftedCase.id) {
              await tx.encounter.update({
                where: { id: note.encounter!.id },
                data: { caseManagementId: driftedCase.id },
              });
              if (currentCase.status === CaseManagementStatus.PENDING_ROUTER) {
                await tx.caseManagement.delete({ where: { id: currentCase.id } });
              }
            }
            appliedId = driftedCase.id;
            break;
          }
          case 'close-case': {
            // Close the drifted case (sync OmniScribe to the EHR's
            // resolved state). The encounter still needs to land
            // somewhere; per spec we promote the pending case
            // in-place to ACTIVE with no coded ICD so the visit isn't
            // orphaned. The clinician adds coding later from /review.
            await tx.caseManagement.update({
              where: { id: driftedCase.id },
              data: {
                status: CaseManagementStatus.CLOSED,
                closedAt: new Date(),
                closedByOrgUserId: authorizationUser.orgUserId,
                closeReason: resolution.reason ?? 'EHR-resolved (drift reconcile)',
              },
            });
            if (
              currentCase.id !== driftedCase.id &&
              currentCase.status === CaseManagementStatus.PENDING_ROUTER
            ) {
              await tx.caseManagement.update({
                where: { id: currentCase.id },
                data: {
                  status: CaseManagementStatus.ACTIVE,
                  primaryIcdLabel: 'Needs coding (post-reconcile)',
                },
              });
              appliedId = currentCase.id;
            } else {
              appliedId = driftedCase.id;
            }
            break;
          }
          case 'open-new-case': {
            // Same shape as the existing `open-new` branch — promote
            // pending in-place when bound, else create fresh + rebind.
            // The drifted case is left untouched; the drift remains and
            // will surface again on the next routing run.
            if (currentCase.status === CaseManagementStatus.PENDING_ROUTER) {
              await tx.caseManagement.update({
                where: { id: currentCase.id },
                data: {
                  status: CaseManagementStatus.ACTIVE,
                  primaryIcd: resolution.primaryIcd,
                  primaryIcdLabel: resolution.primaryIcdLabel,
                },
              });
              appliedId = currentCase.id;
            } else {
              const created = await tx.caseManagement.create({
                data: {
                  orgId: authorizationUser.orgId,
                  patientId: note.patientId,
                  primaryIcd: resolution.primaryIcd,
                  primaryIcdLabel: resolution.primaryIcdLabel,
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
            break;
          }
          case 'update-case-icd': {
            // ICD-drift resolution: update the drifted case's
            // primaryIcd to match the EHR-coded value. Bind encounter
            // to it.
            await tx.caseManagement.update({
              where: { id: driftedCase.id },
              data: {
                primaryIcd: resolution.newIcd,
                primaryIcdLabel: resolution.newIcdLabel,
              },
            });
            if (currentCase.id !== driftedCase.id) {
              await tx.encounter.update({
                where: { id: note.encounter!.id },
                data: { caseManagementId: driftedCase.id },
              });
              if (currentCase.status === CaseManagementStatus.PENDING_ROUTER) {
                await tx.caseManagement.delete({ where: { id: currentCase.id } });
              }
            }
            appliedId = driftedCase.id;
            break;
          }
        }

        // Resolve the drift log row in the same transaction.
        await tx.caseFhirDriftLog.update({
          where: { id: driftLog.id },
          data: {
            resolvedAt: new Date(),
            resolvedAction: resolution.kind,
            resolvedByUserId: user.id,
          },
        });
        // Rule 8 — audit inside the same tx so a throw rolls the
        // drift-log row + the case mutation + this audit back together.
        await writeAuditLog({
          userId: user.id,
          orgId: authorizationUser.orgId,
          action: 'CASE_FHIR_DRIFT_RESOLVED',
          resourceType: 'CaseFhirDriftLog',
          resourceId: driftLog.id,
          metadata: {
            driftLogId: driftLog.id,
            caseManagementId: driftedCase.id,
            resolutionKind: resolution.kind,
            personaVersion: PERSONA_VERSION,
          },
          tx,
        });
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

      // Sprint 0.17 — FHIR Phase D₃ write-back proposal. Three gates
      // before a row is inserted (decision 1, the non-negotiables):
      //   (1) Org has `writebackEnabled = true` on its
      //       OrgEhrConnection. Default FALSE — non-FHIR / opt-out
      //       orgs see byte-identical Sprint 0.16 behavior.
      //   (2) The action is mutating: open-new, open-new-from-condition,
      //       or reconcile with one of the four mutating resolutions.
      //       attach / attach-with-secondary / attach-as-is never write.
      //   (3) The case has a coded ICD post-mutation (CREATE path) OR
      //       is mirrored + the patch actually diffs (PATCH path).
      //
      // The proposal row + the FHIR_WRITEBACK_PROPOSED audit are
      // INSIDE the case-mutation tx (decision 3 — atomic rollback).
      // The OS-side mutation has already committed at this point in
      // the tx; the proposal is just a *follow-on intent* recorded
      // alongside. The worker executes it later, after the clinician
      // approves; if the EHR write fails, the OS state is unchanged.
      const writeBackProposalSummary = await maybeInsertWriteBackProposal(tx, {
        orgId: authorizationUser.orgId,
        userId: user.id,
        patientId: note.patientId,
        clinicianRecorderDisplay: user.name ?? user.email ?? 'Clinician',
        appliedCaseId: appliedId,
        caseRouterRunId: run.id,
        decision: eff,
      });

      return { appliedId, writeBackProposalSummary };
    });
    appliedCaseId = txResult.appliedId;
    writeBackProposalForResponse = txResult.writeBackProposalSummary;
  } catch (err) {
    if (err instanceof TargetCaseError) {
      return NextResponse.json(
        { error: { code: err.code } },
        { status: err.code === 'case_not_found' ? 404 : 409 },
      );
    }
    if (err instanceof ReconcileAlreadyResolvedError) {
      return NextResponse.json({ error: { code: err.code } }, { status: 409 });
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
      // Sprint 0.17 — non-null only when a write-back proposal was
      // inserted in the tx (decision 10 — gated on writebackEnabled).
      // The UI renders the inline "Write to EHR?" section only when
      // this field is present, so non-eligible / writeback-off paths
      // see identical Sprint-0.16 behavior.
      writeBackProposal: writeBackProposalForResponse,
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

/** Sprint 0.16 — thrown when a clinician tries to reconcile a drift log
 *  that another clinician already resolved (e.g. two concurrent reviews
 *  of separate notes on the same patient). The tx rolls back; the
 *  client sees a 409 with `code: 'drift_already_resolved'` and can
 *  refetch the run to render the now-resolved state. */
class ReconcileAlreadyResolvedError extends Error {
  readonly code = 'drift_already_resolved' as const;
  constructor() {
    super('drift_already_resolved');
    this.name = 'ReconcileAlreadyResolvedError';
  }
}

type ReconcileResolution =
  | { kind: 'reopen-case' }
  | { kind: 'attach-as-is' }
  | { kind: 'close-case'; reason?: string }
  | { kind: 'open-new-case'; primaryIcd: string; primaryIcdLabel: string }
  | { kind: 'update-case-icd'; newIcd: string; newIcdLabel: string };

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
    }
  // Sprint 0.16 — reconcile a detected drift. Carries the driftLogId
  // (so the same tx resolves the log row + audits resolution) and the
  // specific resolution kind the clinician picked. The case
  // mutation depends on `resolution.kind`; see the reconcile tx branch
  // for the per-kind contract.
  | {
      kind: 'reconcile';
      driftLogId: string;
      resolution: ReconcileResolution;
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
          secondaryIcd: proposal.newCase.secondaryIcd ?? undefined,
          secondaryIcdLabel: proposal.newCase.secondaryIcdLabel ?? undefined,
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
  if (decision.kind === 'reconcile') {
    return {
      ok: true,
      value: {
        kind: 'reconcile',
        driftLogId: decision.driftLogId,
        resolution: decision.resolution,
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
  if (effective.kind === 'reconcile') {
    // For reconcile, "override" means the clinician picked a different
    // resolution kind than the agent's recommendedOptionIndex. We treat
    // the resolution-kind change as the override discriminator (not
    // the top-level action), so an explicit reconcile decision matches
    // the proposal's action and isn't itself a route override.
    return proposal.action !== 'reconcile';
  }
  return proposal.action !== 'open-new';
}

function auditDecisionLabel(decision: Decision, isOverride: boolean): string {
  if (!isOverride) return 'accepted';
  if (decision.kind === 'attach') return 'overridden-attach';
  if (decision.kind === 'open-new') return 'overridden-open-new';
  if (decision.kind === 'open-new-from-condition') return 'overridden-open-new-from-condition';
  if (decision.kind === 'attach-with-secondary') return 'overridden-attach-with-secondary';
  if (decision.kind === 'reconcile') {
    // Sprint 0.16 — for reconcile-as-override paths (clinician hit
    // reconcile when the proposal was something else, OR vice versa),
    // tag with the chosen resolution kind so the audit row is queryable.
    return `overridden-reconcile-${decision.resolution.kind}`;
  }
  // accept that resolved to a different action — rare; treat as manual override.
  return 'overridden-manual';
}

// =============================================================================
// Sprint 0.17 — FHIR write-back proposal helper.
// =============================================================================

/**
 * Response-shape summary of an inserted FhirWriteBackProposal. Returned
 * from the accept endpoint when (and only when) a proposal row was
 * inserted. The UI uses the presence of this field (not the value of
 * `writebackEnabled`) to decide whether to render the inline
 * "Write to EHR?" section — that way a non-mutating action on a
 * writeback-enabled org also hides the section.
 */
export type WriteBackProposalResponseSummary = {
  id: string;
  operation: 'CREATE' | 'PATCH';
  /** Short human-readable line for the inline review-panel section.
   *  PHI-free — caller-controlled string built from the case's ICD +
   *  status, not from any FHIR-side response body. */
  summary: string;
};

type WriteBackTxContext = {
  orgId: string;
  userId: string;
  patientId: string;
  clinicianRecorderDisplay: string;
  appliedCaseId: string;
  caseRouterRunId: string;
  decision: ResolvedDecision;
};

/** The narrow Prisma transaction shape we touch — pinned so the type
 *  surface stays tractable + tests can mock the slice. */
type WriteBackTx = Pick<
  Prisma.TransactionClient,
  | 'orgEhrConnection'
  | 'patientFhirIdentity'
  | 'caseManagement'
  | 'fhirCachedResource'
  | 'fhirWriteBackProposal'
>;

/**
 * Sprint 0.17 — three-gate eligibility check + proposal insert inside
 * the accept-endpoint tx.
 *
 * Returns the response summary when a proposal was inserted; null
 * when any gate failed (the UI hides the inline section). Failures
 * are silent — the OS-side mutation already committed; a non-eligible
 * write-back state is the baseline, not a degradation.
 *
 * Hot-loop reads (org connection + patient identity + post-mutation
 * case + cached condition) all run inside the tx so a rollback at any
 * step before commit unwinds everything together.
 */
async function maybeInsertWriteBackProposal(
  tx: WriteBackTx,
  ctx: WriteBackTxContext,
): Promise<WriteBackProposalResponseSummary | null> {
  const trigger = resolveWriteBackTrigger(ctx.decision, ctx.caseRouterRunId);
  if (!trigger) return null;

  // Gate 1: org-level writeback toggle. Defaults FALSE — most rows
  // bail here (decision 10, backward compat).
  const conn = await tx.orgEhrConnection.findFirst({
    where: { orgId: ctx.orgId, enabled: true },
    select: { writebackEnabled: true },
  });
  if (!conn?.writebackEnabled) return null;

  // Gate 2: verified patient FHIR identity. Without one, write-back
  // can't target a real FHIR endpoint (rule 20 — verified only). The
  // accept endpoint's broader Sprint-0.15 path may have used the same
  // link; we re-check inside the tx so a concurrent unverify is safe.
  const verifiedLink = await tx.patientFhirIdentity.findFirst({
    where: { patientId: ctx.patientId, matchConfidence: 'verified' },
    select: { fhirPatientId: true },
  });
  if (!verifiedLink) return null;

  // Gate 3: load the post-mutation case state. We re-read inside the
  // tx so the proposal payload reflects exactly what the case row
  // committed to (e.g. CLOSED + new ICD after a reconcile resolution).
  const caseRow = await tx.caseManagement.findUnique({
    where: { id: ctx.appliedCaseId },
    select: {
      id: true,
      primaryIcd: true,
      primaryIcdLabel: true,
      status: true,
      mirrorsFhirConditionId: true,
    },
  });
  if (!caseRow) return null;
  if (!caseRow.primaryIcd) {
    // "Needs coding" case — write-back requires a coded ICD. The
    // clinician can come back later via the chart admin to add the
    // code; that's not a write-back trigger in this sprint.
    return null;
  }

  // PATCH path: gather existing condition snapshot for the patch
  // builder. CREATE path: no existingCondition needed.
  let existingCondition: ExistingConditionSnapshot | null = null;
  if (caseRow.mirrorsFhirConditionId) {
    existingCondition = await loadExistingConditionSnapshot(
      tx,
      ctx.patientId,
      caseRow.mirrorsFhirConditionId,
    );
    if (!existingCondition) {
      // Mirrored case but no cached snapshot — we can't construct a
      // PATCH without the version (decision 6: If-Match is required).
      // The OS-side mutation already happened; we skip the write-back
      // intent rather than block the routing flow.
      return null;
    }
  }

  // Build the proposal row data. proposeWriteBack returns null when
  // a PATCH would have zero diffs (idempotent re-run) — same skip.
  const buildInput: BuildPayloadInput = {
    case: {
      id: caseRow.id,
      primaryIcd: caseRow.primaryIcd,
      primaryIcdLabel: caseRow.primaryIcdLabel,
      status: caseRow.status,
      mirrorsFhirConditionId: caseRow.mirrorsFhirConditionId,
    },
    patient: { id: ctx.patientId, fhirPatientId: verifiedLink.fhirPatientId },
    clinician: {
      orgUserId: ctx.userId,
      recorderRefDisplay: ctx.clinicianRecorderDisplay,
    },
    existingCondition,
    trigger,
  };
  const row = proposeWriteBack(buildInput);
  if (!row) return null;

  // Insert the proposal row + the audit log INSIDE the tx so a throw
  // anywhere upstream rolls all three writes (case mutation + proposal
  // + audit) back together. Rule 8 satisfied — the audit is NOT in a
  // swallowing try-catch; it'll bubble on a unique-key collision or
  // any other DB error.
  const inserted = await tx.fhirWriteBackProposal.create({
    data: {
      orgId: ctx.orgId,
      caseManagementId: ctx.appliedCaseId,
      patientId: ctx.patientId,
      proposedByUserId: ctx.userId,
      triggerKind: row.triggerKind,
      caseRouterRunId: row.caseRouterRunId,
      driftLogId: row.driftLogId,
      operation: row.operation,
      fhirConditionId: row.fhirConditionId,
      payloadJson: row.payloadJson as unknown as Prisma.InputJsonValue,
      ifMatchVersion: row.ifMatchVersion,
      idempotencyKey: row.idempotencyKey,
      status: 'PROPOSED',
    },
    select: { id: true, operation: true },
  });

  await writeAuditLog({
    userId: ctx.userId,
    orgId: ctx.orgId,
    action: 'FHIR_WRITEBACK_PROPOSED',
    resourceType: 'FhirWriteBackProposal',
    resourceId: inserted.id,
    metadata: {
      proposalId: inserted.id,
      caseManagementId: ctx.appliedCaseId,
      operation: inserted.operation,
      triggerKind: row.triggerKind,
      personaVersion: PERSONA_VERSION,
    },
    tx: tx as unknown as Prisma.TransactionClient,
  });

  return {
    id: inserted.id,
    operation: inserted.operation,
    summary: buildSummaryText(buildInput, inserted.operation),
  };
}

/** Map the resolved accept-endpoint decision into a write-back
 *  trigger. Returns null when the decision is non-mutating
 *  (`attach`, `attach-with-secondary`) or non-eligible
 *  (`reconcile` + `attach-as-is`). */
function resolveWriteBackTrigger(
  decision: ResolvedDecision,
  caseRouterRunId: string,
): CaseWriteBackTrigger | null {
  if (decision.kind === 'open-new') {
    return { kind: 'open-new', caseRouterRunId };
  }
  if (decision.kind === 'open-new-from-condition') {
    return { kind: 'open-new-from-condition', caseRouterRunId };
  }
  if (decision.kind === 'reconcile') {
    const r = decision.resolution.kind;
    if (
      r === 'reopen-case' ||
      r === 'close-case' ||
      r === 'open-new-case' ||
      r === 'update-case-icd'
    ) {
      return {
        kind: 'reconcile-with-mutation',
        caseRouterRunId,
        driftLogId: decision.driftLogId,
        resolution: r,
      };
    }
    // attach-as-is — no write-back per decision 9.
    return null;
  }
  // attach / attach-with-secondary — no write-back per decision 8.
  return null;
}

/** Read the FhirCachedResource row for the mirror Condition + project
 *  the existing-condition snapshot the patch builder needs. Returns
 *  null when the cached resource is missing or malformed. */
async function loadExistingConditionSnapshot(
  tx: WriteBackTx,
  patientId: string,
  fhirConditionId: string,
): Promise<ExistingConditionSnapshot | null> {
  const row = await tx.fhirCachedResource.findFirst({
    where: {
      patientId,
      resourceType: 'Condition',
      fhirResourceId: fhirConditionId,
    },
    select: { fhirResourceId: true, resource: true },
  });
  if (!row) return null;
  const bundle = row.resource as
    | {
        raw?: { meta?: { versionId?: string } };
        simplified?: {
          code?: string | null;
          display?: string | null;
          clinicalStatus?: string | null;
        };
      }
    | null;
  const versionId = bundle?.raw?.meta?.versionId ?? null;
  const simplified = bundle?.simplified;
  if (!simplified?.code || !simplified.display) return null;
  const status = simplified.clinicalStatus;
  if (
    status !== 'active' &&
    status !== 'recurrence' &&
    status !== 'relapse' &&
    status !== 'resolved' &&
    status !== 'remission'
  ) {
    return null;
  }
  return {
    fhirConditionId: row.fhirResourceId,
    versionId,
    clinicalStatus: status,
    icd: simplified.code,
    icdLabel: simplified.display,
  };
}

/** Build the human-readable summary for the review-panel inline
 *  section. PHI-free — composed from the case's ICD + label + the
 *  computed FHIR clinicalStatus. */
function buildSummaryText(
  input: BuildPayloadInput,
  operation: 'CREATE' | 'PATCH',
): string {
  const ic = `${input.case.primaryIcd} — ${input.case.primaryIcdLabel}`;
  if (operation === 'CREATE') {
    return `Will create a new Condition in your EHR with ${ic} (status: ${input.case.status === 'CLOSED' ? 'resolved' : 'active'}).`;
  }
  return `Will update the existing EHR Condition for ${ic} (status: ${input.case.status === 'CLOSED' ? 'resolved' : 'active'}).`;
}
