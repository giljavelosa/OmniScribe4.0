import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { assertOrgScoped } from '@/lib/phi-access';
import { fetchPatientConditions } from '@/services/copilot/case-router-fhir';
import { isFhirRouterEnabled } from '@/lib/case-management/fhir-router-config';

export const runtime = 'nodejs';

const bodySchema = z.object({
  patientId: z.string().min(1),
});

/**
 * POST /api/case-management/check-dups — existing cases for de-dup UI.
 *
 * Sprint 0.11 shipped this as the manual `NewCaseDialog` fallback when
 * agentic routing isn't in the loop (e.g. opening a case from the chart
 * Cases tab). Sprint 0.15 (decision 8) adds the FHIR Condition lookup
 * to the response so future dialog UI can present "we found these
 * coded diagnoses in the EHR" side-by-side with existing OmniScribe
 * cases — same source of truth as the case-router agent.
 *
 * The FHIR lookup is gated on `isFhirRouterEnabled` + a verified
 * `PatientFhirIdentity` link, exactly like the worker. Graceful
 * degradation (decision 7): a fetch failure returns
 * `fhirConditions: []` — the existing-cases payload is the primary
 * value and must always ship.
 */
export async function POST(req: Request) {
  const guard = await requireFeatureAccess('VISITS_CREATE', req);
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }

  const patient = await prisma.patient.findFirst({
    where: {
      id: parsed.data.patientId,
      orgId: authorizationUser.orgId,
      isDeleted: false,
    },
    select: { id: true, orgId: true },
  });
  if (!patient) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  assertOrgScoped(patient.orgId, authorizationUser.orgId);

  const cases = await prisma.caseManagement.findMany({
    where: {
      patientId: patient.id,
      orgId: authorizationUser.orgId,
      status: { in: ['ACTIVE', 'CLOSED'] },
    },
    orderBy: { openedAt: 'desc' },
    select: {
      id: true,
      primaryIcd: true,
      primaryIcdLabel: true,
      secondaryIcd: true,
      status: true,
      openedAt: true,
      // Sprint 0.15 — expose so the dialog can mark cases that already
      // mirror a Condition (avoids "create a duplicate from the FHIR
      // panel" confusion).
      mirrorsFhirConditionId: true,
      encounters: {
        orderBy: { startedAt: 'desc' },
        take: 1,
        select: { startedAt: true },
      },
    },
  });

  // Sprint 0.15 — FHIR Conditions, gated identically to the worker.
  // Non-FHIR patients + non-FHIR orgs return an empty array (the
  // existing Sprint-0.11 shape, decision 10 / backward compatibility).
  let fhirConditions: Array<{
    fhirId: string;
    icd: string;
    icdLabel: string;
    recordedDate: string;
    recorderName: string | null;
    mirroredByCaseId: string | null;
  }> = [];
  if (await isFhirRouterEnabled(authorizationUser.orgId)) {
    const fhirResult = await fetchPatientConditions({
      orgId: authorizationUser.orgId,
      patientId: patient.id,
    });
    if (fhirResult.ok) {
      const mirroredByFhirId = new Map<string, string>();
      for (const c of cases) {
        if (c.mirrorsFhirConditionId) {
          mirroredByFhirId.set(c.mirrorsFhirConditionId, c.id);
        }
      }
      fhirConditions = fhirResult.conditions.map((c) => ({
        fhirId: c.fhirId,
        icd: c.icd,
        icdLabel: c.icdLabel,
        recordedDate: c.recordedDate,
        recorderName: c.recorderName,
        mirroredByCaseId: mirroredByFhirId.get(c.fhirId) ?? null,
      }));
    }
  }

  return NextResponse.json({
    data: {
      existingCases: cases.map((c) => ({
        id: c.id,
        primaryIcd: c.primaryIcd,
        primaryIcdLabel: c.primaryIcdLabel,
        secondaryIcd: c.secondaryIcd,
        status: c.status,
        lastActivityAt:
          c.encounters[0]?.startedAt?.toISOString() ?? c.openedAt.toISOString(),
        mirrorsFhirConditionId: c.mirrorsFhirConditionId,
      })),
      fhirConditions,
    },
  });
}
