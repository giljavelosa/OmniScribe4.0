import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertOrgScoped } from '@/lib/phi-access';
import type { FinalJsonShape } from '@/lib/notes/build-artifact-prompt';

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
  /** 'fhir' added in Unit 28 — kind dispatches the chat surface's render
   *  per pill (note → /review link; fhir → text chip; others → text chip). */
  kind: 'note' | 'follow-up' | 'goal' | 'patient' | 'fhir';
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

// =====================================================================
// Tool runner — dispatches by name, parses + executes
// =====================================================================

export type ToolContext = {
  orgId: string;
};

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
