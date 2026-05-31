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
import {
  runDraftPatientMessage,
  runProposeFollowUpCadence,
  runSuggestReferralLetterContent,
} from './draft-tools';
import { ExtractionJsonSchema } from '@/types/external-context-extraction';
import {
  buildDocumentPageUpserts,
  splitTextIntoDocumentPages,
  type DocumentPageText,
} from '@/lib/external-context/document-pages';
import { lookupMedicationReference } from './medication-reference';

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
  // Phase 1A — patient-scoped fan-out across all of a patient's
  // episodes. Use this when a visit has no episodeOfCare (ad-hoc /
  // one-off visits) or when the clinician asks about goals across
  // multiple concurrent episodes.
  | 'lookupPatientGoals'
  | 'lookupPatientDemographics'
  | 'lookupVerifiedExternalContext'
  | 'lookupMedicationReference'
  // Unit 28 — FHIR-backed lookups against verified PatientFhirIdentity
  | 'lookupFhirCondition'
  | 'lookupFhirMedication'
  | 'lookupFhirObservation'
  | 'lookupFhirAllergy'
  | 'lookupFhirCarePlan'
  // Unit 30 — Action tools (drafts). Chart-mode only; each runs a
  // sub-LLM call to produce a draft the clinician reviews + accepts /
  // edits / discards. NO autonomous effects.
  | 'draftPatientMessage'
  | 'proposeFollowUpCadence'
  | 'suggestReferralLetterContent';

export type AskSource = {
  /** 'fhir' added in Unit 28; 'literature' added in Unit 29; 'llm-intrinsic'
   *  added in Phase 1B for the research-mode LLM-knowledge fallback —
   *  rendered as a yellow chip + accompanied by a yellow "LLM knowledge"
   *  badge above the bubble so the clinician sees the trust signal twice.
   *  Chart mode never produces an llm-intrinsic source (fail-closed via
   *  the agent's wrong_mode_fallback gate). */
  kind: 'note' | 'follow-up' | 'goal' | 'patient' | 'fhir' | 'document' | 'literature' | 'llm-intrinsic';
  id: string;
  label: string;
};

/**
 * Unit 30 — Draft type union. Produced by the 3 action tools; rides
 * alongside the assistant message in the chat surface as a DraftCard
 * with Accept / Edit / Discard. No autonomous side effects — confirm
 * + discard are explicit clinician actions auditied separately from
 * the agent's PROPOSED audit.
 */
export type DraftKind = 'patient-message' | 'followup-cadence' | 'referral-letter';

export type Draft = {
  /** Client-generated UUID-ish, stable across edits within a session. */
  draftId: string;
  kind: DraftKind;
  /** Editable text — the clinician's final-version-after-edits is what
   *  the confirm endpoint persists / copies. */
  content: string;
  /** Kind-specific structured fields the DraftCard renders alongside
   *  the editable text. PHI-fenced at the audit layer (metadata never
   *  includes meta contents). */
  meta: Record<string, unknown>;
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

const lookupPatientGoalsArgs = z.object({
  patientId: z.string().min(1).max(64),
});

const lookupPatientDemographicsArgs = z.object({
  patientId: z.string().min(1).max(64),
});

const lookupVerifiedExternalContextArgs = z.object({
  patientId: z.string().min(1).max(64),
  documentType: z.string().min(1).max(80).optional(),
  query: z.string().min(1).max(200).optional(),
  pageNumber: z.number().int().min(1).max(500).optional(),
});

const lookupMedicationReferenceArgs = z.object({
  medicationName: z.string().min(1).max(120),
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

// Unit 30 — draft tool arg schemas. All chart-mode; topic/specialty/
// reason/basis are model-supplied free-text that gets piped into the
// sub-LLM prompt.

const draftPatientMessageArgs = z.object({
  patientId: z.string().min(1).max(64),
  topic: z.string().min(1).max(200),
});

const proposeFollowUpCadenceArgs = z.object({
  patientId: z.string().min(1).max(64),
  basis: z.string().min(1).max(200),
});

const suggestReferralLetterContentArgs = z.object({
  patientId: z.string().min(1).max(64),
  specialty: z.string().min(1).max(80),
  reason: z.string().min(1).max(200),
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

function ageYearsAt(dob: Date, at: Date): number {
  let age = at.getUTCFullYear() - dob.getUTCFullYear();
  const monthDelta = at.getUTCMonth() - dob.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && at.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age;
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

      // Phase 1A — patient-scoped goal fan-out. Solves the ad-hoc-visit
      // case where note.encounter.episodeOfCareId === null, so the
      // model has no episodeId to pass to lookupEpisodeGoals and
      // otherwise exhausts its iteration budget retrying.
      case 'lookupPatientGoals': {
        const args = lookupPatientGoalsArgs.parse(argsRaw);
        const patient = await prisma.patient.findUnique({
          where: { id: args.patientId },
          select: { id: true, orgId: true },
        });
        if (!patient) return { ok: false, error: 'patient_not_found' };
        assertOrgScoped(patient.orgId, ctx.orgId);
        const episodes = await prisma.episodeOfCare.findMany({
          where: { patientId: args.patientId, orgId: ctx.orgId },
          select: { id: true, diagnosis: true },
        });
        if (episodes.length === 0) {
          return { ok: true, rowCount: 0, data: { goals: [] } };
        }
        const episodeById = new Map(episodes.map((e) => [e.id, e]));
        const goals = await prisma.episodeGoal.findMany({
          where: {
            episodeId: { in: episodes.map((e) => e.id) },
            status: { in: ['ACTIVE', 'PARTIALLY_MET'] },
          },
          orderBy: { createdAt: 'asc' },
          take: 20,
        });
        return {
          ok: true,
          rowCount: goals.length,
          data: {
            goals: goals.map((g) => ({
              id: g.id,
              text: g.goalText,
              status: g.status,
              type: g.goalType,
              currentMeasure: g.currentMeasure,
              targetMeasure: g.targetMeasure,
              episodeId: g.episodeId,
              episodeDiagnosis: episodeById.get(g.episodeId)?.diagnosis ?? null,
            })),
          },
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
            ageYears: ageYearsAt(patient.dob, new Date()),
            sex: patient.sex,
            mrn: patient.mrn,
            preferredLanguage: patient.preferredLanguage,
          },
        };
      }

      case 'lookupMedicationReference': {
        const args = lookupMedicationReferenceArgs.parse(argsRaw);
        const reference = lookupMedicationReference(args.medicationName);
        return {
          ok: true,
          rowCount: reference ? 1 : 0,
          data: {
            medicationName: args.medicationName,
            reference,
            safetyNote:
              'Use patient chart facts separately from this general medication-reference guidance; clinician judgment remains required.',
          },
        };
      }

      case 'lookupVerifiedExternalContext': {
        const args = lookupVerifiedExternalContextArgs.parse(argsRaw);
        const patient = await prisma.patient.findUnique({
          where: { id: args.patientId },
          select: { id: true, orgId: true },
        });
        if (!patient) return { ok: false, error: 'patient_not_found' };
        assertOrgScoped(patient.orgId, ctx.orgId);

        const rows = await prisma.externalContext.findMany({
          where: {
            orgId: ctx.orgId,
            patientId: args.patientId,
            mediaKind: 'DOCUMENT',
            status: 'READY',
            verifiedAt: { not: null },
            deletedAt: null,
          },
          orderBy: { dateOfRecord: 'desc' },
          take: 10,
        });
        if (args.query || args.pageNumber) {
          await ensureDocumentPages(rows, ctx.orgId);
        }
        const pagesByExternalContextId = args.query || args.pageNumber
          ? await loadDocumentPages(rows.map((row) => row.id), ctx.orgId, args.pageNumber)
          : new Map<string, DocumentPageText[]>();
        const documents = rows
          .map((row) => {
            const parsed = ExtractionJsonSchema.safeParse(row.vettedExtractionJson ?? row.extractionJson);
            if (!parsed.success) return null;
            if (args.documentType && parsed.data.documentType !== args.documentType) return null;
            const pages = pagesByExternalContextId.get(row.id) ?? [];
            return {
              id: row.id,
              dateOfRecord: row.dateOfRecord.toISOString().slice(0, 10),
              source: row.source,
              sourceLabel: row.sourceLabel,
              verifiedAt: row.verifiedAt?.toISOString() ?? null,
              documentType: parsed.data.documentType,
              summary: parsed.data.summary,
              diagnoses: parsed.data.diagnoses,
              medications: parsed.data.medications,
              allergies: parsed.data.allergies,
              labs: parsed.data.labs,
              vitals: parsed.data.vitals,
              procedures: parsed.data.procedures,
              documentDateGuess: parsed.data.documentDateGuess,
              extractionNotes: parsed.data.extractionNotes,
              pages: args.pageNumber
                ? pages.map((page) => ({
                    fileIndex: page.fileIndex,
                    pageNumber: page.pageNumber,
                    text: page.text,
                    characterCount: page.text.length,
                  }))
                : [],
              textMatches: args.query ? buildDocumentTextMatchesFromPages(pages, args.query) : [],
            };
          })
          .filter((doc): doc is NonNullable<typeof doc> => doc !== null);

        return { ok: true, rowCount: documents.length, data: { documents } };
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

      // ===== Unit 30 — Draft tools (chart-mode only) =================

      case 'draftPatientMessage': {
        const args = draftPatientMessageArgs.parse(argsRaw);
        return runDraftPatientMessage(args, { orgId: ctx.orgId });
      }

      case 'proposeFollowUpCadence': {
        const args = proposeFollowUpCadenceArgs.parse(argsRaw);
        return runProposeFollowUpCadence(args, { orgId: ctx.orgId });
      }

      case 'suggestReferralLetterContent': {
        const args = suggestReferralLetterContentArgs.parse(argsRaw);
        return runSuggestReferralLetterContent(args, { orgId: ctx.orgId });
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

async function ensureDocumentPages(
  rows: Array<{
    id: string;
    orgId: string;
    pageCount: number | null;
    ocrText: string | null;
    transcriptClean: string;
    extractedAt: Date | null;
    verifiedAt: Date | null;
  }>,
  orgId: string,
): Promise<void> {
  for (const row of rows) {
    const existingCount = await prisma.externalContextDocumentPage.count({
      where: { externalContextId: row.id, orgId },
    });
    if (existingCount > 0) continue;
    const pages = splitTextIntoDocumentPages(row.ocrText ?? row.transcriptClean, {
      pageCount: row.pageCount,
    });
    if (pages.length === 0) continue;
    await prisma.$transaction(buildDocumentPageUpserts({
      client: prisma,
      orgId,
      externalContextId: row.id,
      pages,
      extractedAt: row.extractedAt,
      verifiedAt: row.verifiedAt,
    }));
  }
}

async function loadDocumentPages(
  externalContextIds: string[],
  orgId: string,
  pageNumber?: number,
): Promise<Map<string, DocumentPageText[]>> {
  if (externalContextIds.length === 0) return new Map();
  const rows = await prisma.externalContextDocumentPage.findMany({
    where: {
      externalContextId: { in: externalContextIds },
      orgId,
      ...(pageNumber ? { pageNumber } : {}),
    },
    orderBy: [{ externalContextId: 'asc' }, { fileIndex: 'asc' }, { pageNumber: 'asc' }],
    select: {
      externalContextId: true,
      fileIndex: true,
      pageNumber: true,
      text: true,
    },
  });
  const byExternalContextId = new Map<string, DocumentPageText[]>();
  for (const row of rows) {
    const pages = byExternalContextId.get(row.externalContextId) ?? [];
    pages.push({
      fileIndex: row.fileIndex,
      pageNumber: row.pageNumber,
      text: row.text,
    });
    byExternalContextId.set(row.externalContextId, pages);
  }
  return byExternalContextId;
}

function buildDocumentTextMatchesFromPages(pages: DocumentPageText[], query: string) {
  const terms = clinicalQueryTerms(query);
  if (pages.length === 0 || terms.length === 0) return [];
  const snippets: Array<{ term: string; sourcePage: number | null; text: string }> = [];
  const seen = new Set<string>();

  for (const term of terms) {
    for (const page of pages) {
      let fromIndex = 0;
      const lower = page.text.toLowerCase();
      while (snippets.length < 25) {
        const index = lower.indexOf(term, fromIndex);
        if (index < 0) break;
        const snippet = boundedSnippet(page.text, index);
        const key = `${term}:${snippet}`;
        if (!seen.has(key)) {
          seen.add(key);
          snippets.push({
            term,
            sourcePage: page.pageNumber,
            text: `Page ${page.pageNumber}\n${snippet}`,
          });
        }
        fromIndex = index + term.length;
      }
      if (snippets.length >= 25) break;
    }
    if (snippets.length >= 25) break;
  }

  return snippets
    .sort((a, b) => scoreSnippet(b.text, b.sourcePage) - scoreSnippet(a.text, a.sourcePage))
    .slice(0, 5);
}

function clinicalQueryTerms(query: string): string[] {
  const stopwords = new Set([
    'about',
    'last',
    'latest',
    'value',
    'values',
    'result',
    'results',
    'patient',
    'what',
    'when',
    'where',
    'was',
    'were',
    'the',
    'this',
    'that',
    'show',
    'tell',
    'from',
    'with',
  ]);
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .filter((term) => term.length >= 3 && !stopwords.has(term)),
    ),
  ).slice(0, 6);
}

function boundedSnippet(text: string, index: number): string {
  const start = Math.max(0, index - 280);
  const end = Math.min(text.length, index + 950);
  return text
    .slice(start, end)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1_200);
}

function scoreSnippet(snippet: string, sourcePage: number | null): number {
  let score = sourcePage ? sourcePage / 100 : 0;
  if (/recent laboratory results/i.test(snippet)) score += 100;
  if (/\b(Test|Result|Flag|Reference range|Units|Date)\b/i.test(snippet)) score += 40;
  if (/\b(mg\/dL|g\/dL|ng\/mL|mmol\/L|K\/uL|mL\/min|%|pg\/mL|mIU\/L|IU\/mL|copies\/mL)\b/i.test(snippet)) score += 25;
  const dates = [...snippet.matchAll(/\b(?:20\d{2}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/20\d{2})\b/g)]
    .map((match) => Date.parse(match[0]))
    .filter((ms) => !Number.isNaN(ms));
  if (dates.length > 0) {
    score += Math.max(...dates) / 10_000_000_000_000;
  }
  return score;
}
