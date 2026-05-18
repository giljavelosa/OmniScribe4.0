import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertOrgScoped } from '@/lib/phi-access';
import { isStale } from '@/lib/fhir/staleness';
import type { FinalJsonShape } from '@/lib/notes/build-artifact-prompt';
import type {
  SimplifiedAllergyIntolerance,
  SimplifiedCondition,
  SimplifiedMedicationRequest,
  SimplifiedMedicationStatement,
  SimplifiedObservation,
} from '@/services/fhir/adapters';

/**
 * Ask-mode tools — Unit 27.
 *
 * Four read-only lookup tools the agent loop can call. Each is a pure
 * function over `(orgId, args) → result`; Prisma queries org-scoped at
 * the boundary via `assertOrgScoped` so a hallucinated id from a
 * different org gets a 403 (translated to a tool error the agent
 * surfaces to the model on the next turn).
 *
 * Rule 20 enforced inline: `lookupSignedNote` filters status IN
 * (SIGNED, TRANSFERRED) so a draft note's contents NEVER leak into a
 * model answer. The other three tools read tables (FollowUp,
 * EpisodeGoal, Patient) whose write paths already gate on attested
 * data — see the worker + sign-route audits.
 */

export type AskToolName =
  | 'lookupSignedNote'
  | 'lookupFollowUp'
  | 'lookupEpisodeGoals'
  | 'lookupPatientDemographics'
  // Unit 28 — FHIR-backed lookups against verified PatientFhirIdentity
  | 'lookupFhirCondition'
  | 'lookupFhirMedication'
  | 'lookupFhirObservation'
  | 'lookupFhirAllergy'
  | 'lookupFhirCarePlan';

export type AskSource = {
  /** 'fhir' added in Unit 28; 'literature' added in Unit 29 — kind
   *  dispatches the chat surface's render per pill (note → /review link;
   *  literature → external PMC link or text chip; fhir + others → text chip). */
  kind: 'note' | 'follow-up' | 'goal' | 'patient' | 'fhir' | 'literature';
  id: string;
  label: string;
};

// =====================================================================
// Per-tool arg schemas — Zod parses unknown JSON from the model.
// =====================================================================

const lookupSignedNoteArgs = z.object({
  noteId: z.string().min(1).max(64),
});

const lookupFollowUpArgs = z.object({
  patientId: z.string().min(1).max(64),
  status: z.enum(['OPEN', 'MET', 'CARRIED', 'DROPPED', 'CLOSED_BY_DISCHARGE']).optional(),
});

const lookupEpisodeGoalsArgs = z.object({
  episodeId: z.string().min(1).max(64),
});

const lookupPatientDemographicsArgs = z.object({
  patientId: z.string().min(1).max(64),
});

// Unit 28 — FHIR tool arg schemas. patientId comes from agent context;
// the agent should always pass it. Optional filters surface common
// model-facing refinements (active conditions, active meds, specific
// LOINC code).

const lookupFhirConditionArgs = z.object({
  patientId: z.string().min(1).max(64),
  clinicalStatus: z.string().min(1).max(40).optional(),
});

const lookupFhirMedicationArgs = z.object({
  patientId: z.string().min(1).max(64),
  status: z.string().min(1).max(40).optional(),
});

const lookupFhirObservationArgs = z.object({
  patientId: z.string().min(1).max(64),
  code: z.string().min(1).max(40).optional(),
});

const lookupFhirAllergyArgs = z.object({
  patientId: z.string().min(1).max(64),
});

const lookupFhirCarePlanArgs = z.object({
  patientId: z.string().min(1).max(64),
});

// =====================================================================
// Tool runner — dispatches by name, parses + executes
// =====================================================================

const EHR_SYSTEM = 'nextgen';
const FHIR_PER_TOOL_CAP = 20;
export const MAX_FHIR_ROWS_PER_SESSION = 100;

export type ToolContext = {
  orgId: string;
  /** Unit 28 — per-session FHIR row budget. Mutated by ref so each
   *  FHIR tool can increment after a successful fetch. Initialized
   *  to { count: 0 } by `runAgent`. */
  fhirRowsConsumed?: { count: number };
};

/** Pre-flight for every FHIR tool: org-scope the patient + require a
 *  'verified' PatientFhirIdentity + check the rate-limit budget.
 *  Returns the link row on success so the tool can use its noteId or
 *  patient id without an extra round-trip. */
async function assertFhirReadable(
  patientId: string,
  ctx: ToolContext,
): Promise<{ ok: true } | ToolResult> {
  if ((ctx.fhirRowsConsumed?.count ?? 0) >= MAX_FHIR_ROWS_PER_SESSION) {
    return { ok: false, error: 'fhir_rate_limit_exceeded' };
  }
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { id: true, orgId: true },
  });
  if (!patient) return { ok: false, error: 'patient_not_found' };
  assertOrgScoped(patient.orgId, ctx.orgId);
  const link = await prisma.patientFhirIdentity.findFirst({
    where: { patientId, ehrSystem: EHR_SYSTEM, matchConfidence: 'verified' },
  });
  if (!link) return { ok: false, error: 'verified_link_required' };
  return { ok: true };
}

function chargeFhirBudget(ctx: ToolContext, rowCount: number): void {
  if (ctx.fhirRowsConsumed) ctx.fhirRowsConsumed.count += rowCount;
}

/** Load fresh (non-stale) FhirCachedResource rows for a (patient,
 *  resourceType) tuple. Stale rows (>7d, Unit 21 isStale) are
 *  excluded — same staleness rule the brief enrichment honors. */
async function loadFreshFhirRows(patientId: string, resourceType: string) {
  const rows = await prisma.fhirCachedResource.findMany({
    where: { patientId, ehrSystem: EHR_SYSTEM, resourceType },
    orderBy: { fetchedAt: 'desc' },
  });
  const now = new Date();
  return rows.filter((r) => !isStale(r.fetchedAt, now));
}

export type ToolResult =
  | { ok: true; data: unknown; rowCount: number }
  | { ok: false; error: string };

export async function runTool(
  name: string,
  argsRaw: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'lookupSignedNote': {
        const args = lookupSignedNoteArgs.parse(argsRaw);
        const note = await prisma.note.findUnique({
          where: { id: args.noteId },
          select: {
            id: true,
            orgId: true,
            status: true,
            signedAt: true,
            finalJson: true,
            clinicianOrgUserId: true,
          },
        });
        if (!note) return { ok: false, error: 'note_not_found' };
        assertOrgScoped(note.orgId, ctx.orgId);
        if (note.status !== 'SIGNED' && note.status !== 'TRANSFERRED') {
          return { ok: false, error: 'note_not_attested' };
        }
        const finalJson = note.finalJson as unknown as FinalJsonShape | null;
        return {
          ok: true,
          rowCount: finalJson?.sections.length ?? 0,
          data: {
            noteId: note.id,
            signedAt: note.signedAt?.toISOString() ?? null,
            sections: finalJson?.sections.map((s) => ({
              label: s.label,
              content: s.content,
            })) ?? [],
          },
        };
      }

      case 'lookupFollowUp': {
        const args = lookupFollowUpArgs.parse(argsRaw);
        const rows = await prisma.followUp.findMany({
          where: {
            orgId: ctx.orgId,
            patientId: args.patientId,
            ...(args.status ? { status: args.status } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            originNote: { select: { id: true, signedAt: true } },
          },
        });
        return {
          ok: true,
          rowCount: rows.length,
          data: rows.map((fu) => ({
            id: fu.id,
            text: fu.text,
            status: fu.status,
            originNoteId: fu.originNoteId,
            createdAt: fu.createdAt.toISOString(),
          })),
        };
      }

      case 'lookupEpisodeGoals': {
        const args = lookupEpisodeGoalsArgs.parse(argsRaw);
        const episode = await prisma.episodeOfCare.findUnique({
          where: { id: args.episodeId },
          select: { id: true, orgId: true },
        });
        if (!episode) return { ok: false, error: 'episode_not_found' };
        assertOrgScoped(episode.orgId, ctx.orgId);
        const goals = await prisma.episodeGoal.findMany({
          where: {
            episodeId: args.episodeId,
            status: { in: ['ACTIVE', 'PARTIALLY_MET'] },
          },
          orderBy: { createdAt: 'asc' },
        });
        return {
          ok: true,
          rowCount: goals.length,
          data: goals.map((g) => ({
            id: g.id,
            text: g.goalText,
            status: g.status,
            type: g.goalType,
            currentMeasure: g.currentMeasure,
            targetMeasure: g.targetMeasure,
          })),
        };
      }

      case 'lookupPatientDemographics': {
        const args = lookupPatientDemographicsArgs.parse(argsRaw);
        const patient = await prisma.patient.findUnique({
          where: { id: args.patientId },
          select: {
            id: true,
            orgId: true,
            firstName: true,
            lastName: true,
            dob: true,
            sex: true,
            division: true,
            mrn: true,
            preferredLanguage: true,
          },
        });
        if (!patient) return { ok: false, error: 'patient_not_found' };
        assertOrgScoped(patient.orgId, ctx.orgId);
        return {
          ok: true,
          rowCount: 1,
          data: {
            id: patient.id,
            firstName: patient.firstName,
            lastName: patient.lastName,
            dob: patient.dob.toISOString().slice(0, 10),
            sex: patient.sex,
            division: patient.division,
            mrn: patient.mrn,
            preferredLanguage: patient.preferredLanguage,
          },
        };
      }

      // ===== Unit 28 — FHIR tools =====================================

      case 'lookupFhirCondition': {
        const args = lookupFhirConditionArgs.parse(argsRaw);
        const guard = await assertFhirReadable(args.patientId, ctx);
        if ('error' in guard) return guard;
        const rows = await loadFreshFhirRows(args.patientId, 'Condition');
        const conditions = rows
          .map((r) => {
            const simp = (r.resource as { simplified?: SimplifiedCondition }).simplified ?? null;
            return { row: r, simp };
          })
          .filter(({ simp }) => {
            if (!simp || !simp.display) return false;
            const wantStatus = args.clinicalStatus ?? 'active';
            return simp.clinicalStatus === wantStatus;
          })
          .slice(0, FHIR_PER_TOOL_CAP)
          .map(({ row, simp }) => ({
            fhirResourceId: row.fhirResourceId,
            display: simp!.display!,
            code: simp!.code,
            clinicalStatus: simp!.clinicalStatus,
            onsetDate: simp!.onsetDate,
            fetchedAt: row.fetchedAt.toISOString(),
          }));
        chargeFhirBudget(ctx, conditions.length);
        return { ok: true, rowCount: conditions.length, data: { conditions } };
      }

      case 'lookupFhirMedication': {
        const args = lookupFhirMedicationArgs.parse(argsRaw);
        const guard = await assertFhirReadable(args.patientId, ctx);
        if ('error' in guard) return guard;
        const statementRows = await loadFreshFhirRows(args.patientId, 'MedicationStatement');
        const requestRows = await loadFreshFhirRows(args.patientId, 'MedicationRequest');
        const wantStatus = args.status ?? 'active';
        const pool: Array<{
          fhirResourceId: string;
          display: string;
          status: string;
          sourceType: 'MedicationStatement' | 'MedicationRequest';
          fetchedAt: string;
        }> = [];
        for (const r of statementRows) {
          const s = (r.resource as { simplified?: SimplifiedMedicationStatement }).simplified ?? null;
          if (s?.display && (wantStatus === 'any' || s.status === wantStatus)) {
            pool.push({
              fhirResourceId: r.fhirResourceId,
              display: s.display,
              status: s.status ?? 'unknown',
              sourceType: 'MedicationStatement',
              fetchedAt: r.fetchedAt.toISOString(),
            });
          }
        }
        for (const r of requestRows) {
          const s = (r.resource as { simplified?: SimplifiedMedicationRequest }).simplified ?? null;
          if (s?.display && (wantStatus === 'any' || s.status === wantStatus)) {
            pool.push({
              fhirResourceId: r.fhirResourceId,
              display: s.display,
              status: s.status ?? 'unknown',
              sourceType: 'MedicationRequest',
              fetchedAt: r.fetchedAt.toISOString(),
            });
          }
        }
        const medications = pool.slice(0, FHIR_PER_TOOL_CAP);
        chargeFhirBudget(ctx, medications.length);
        return { ok: true, rowCount: medications.length, data: { medications } };
      }

      case 'lookupFhirObservation': {
        const args = lookupFhirObservationArgs.parse(argsRaw);
        const guard = await assertFhirReadable(args.patientId, ctx);
        if ('error' in guard) return guard;
        const rows = await loadFreshFhirRows(args.patientId, 'Observation');
        const observations = rows
          .map((r) => ({
            row: r,
            simp: (r.resource as { simplified?: SimplifiedObservation }).simplified ?? null,
          }))
          .filter(({ simp }) => simp?.value != null && (simp.display || simp.code))
          .filter(({ simp }) => (args.code ? simp!.code === args.code : true))
          .slice(0, FHIR_PER_TOOL_CAP)
          .map(({ row, simp }) => ({
            fhirResourceId: row.fhirResourceId,
            display: simp!.display ?? simp!.code ?? 'observation',
            code: simp!.code,
            value: simp!.value!,
            unit: simp!.unit,
            effectiveDate: simp!.effectiveDate,
            fetchedAt: row.fetchedAt.toISOString(),
          }));
        chargeFhirBudget(ctx, observations.length);
        return { ok: true, rowCount: observations.length, data: { observations } };
      }

      case 'lookupFhirAllergy': {
        const args = lookupFhirAllergyArgs.parse(argsRaw);
        const guard = await assertFhirReadable(args.patientId, ctx);
        if ('error' in guard) return guard;
        const rows = await loadFreshFhirRows(args.patientId, 'AllergyIntolerance');
        const allergies = rows
          .map((r) => ({
            row: r,
            simp: (r.resource as { simplified?: SimplifiedAllergyIntolerance }).simplified ?? null,
          }))
          .filter(({ simp }) => simp?.display)
          .slice(0, FHIR_PER_TOOL_CAP)
          .map(({ row, simp }) => ({
            fhirResourceId: row.fhirResourceId,
            display: simp!.display!,
            category: simp!.category,
            criticality: simp!.criticality,
            fetchedAt: row.fetchedAt.toISOString(),
          }));
        chargeFhirBudget(ctx, allergies.length);
        return { ok: true, rowCount: allergies.length, data: { allergies } };
      }

      case 'lookupFhirCarePlan': {
        // CarePlan adapter ships in Wave 4.5; v1 returns the raw FHIR
        // resource directly so the model can read whatever the EHR
        // returned (cache will be empty until the adapter+sync land).
        const args = lookupFhirCarePlanArgs.parse(argsRaw);
        const guard = await assertFhirReadable(args.patientId, ctx);
        if ('error' in guard) return guard;
        const rows = await loadFreshFhirRows(args.patientId, 'CarePlan');
        const carePlans = rows.slice(0, FHIR_PER_TOOL_CAP).map((r) => ({
          fhirResourceId: r.fhirResourceId,
          raw: (r.resource as { raw?: unknown }).raw ?? r.resource,
          fetchedAt: r.fetchedAt.toISOString(),
        }));
        chargeFhirBudget(ctx, carePlans.length);
        return { ok: true, rowCount: carePlans.length, data: { carePlans } };
      }

      default:
        return { ok: false, error: `unknown_tool:${name}` };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof z.ZodError
        ? `args_invalid:${err.issues[0]?.message ?? 'unknown'}`
        : err instanceof Error
          ? err.message.slice(0, 120)
          : 'tool_threw',
    };
  }
}
