import type { Job } from 'bullmq';
import { NoteStatus, Prisma, type FollowUp } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import {
  BriefGenerator,
  BRIEF_GENERATOR_FALLBACK_VERSION,
} from '@/services/brief/BriefGenerator';
import { FollowupExtractor } from '@/services/brief/FollowupExtractor';
import {
  projectPatientForBrief,
  projectEpisodeForBrief,
  projectGoalForBrief,
  projectSignedNoteForBrief,
} from '@/lib/notes/build-brief-prompt';
import { loadExternalEhrContext } from '@/lib/fhir/project-ehr-context';
import { hydrateEhrEnrichment } from '@/lib/notes/hydrate-ehr-enrichment';
import type {
  PriorContextBriefContent,
  FollowUpPreview,
} from '@/types/brief';
import type { FinalJsonShape } from '@/lib/notes/build-artifact-prompt';

type NoteBriefJob = {
  noteId: string;
  orgId: string;
};

const MAX_PRIOR_NOTES = 2; // spec §D: "Load up to 2 prior signed notes"

/**
 * note-brief worker (spec §D).
 *
 * Runs ONLY after a Note transitions to SIGNED (sign route enqueues post-
 * commit, outside the sign tx). Two responsibilities:
 *
 *   1. Generate the prior-context brief for THIS just-signed note. Loads up
 *      to 2 prior signed notes for the same patient (preferring same-episode
 *      when one exists), runs the BriefGenerator (Sonnet → Haiku fallback),
 *      upserts the result into NoteBrief.
 *
 *   2. Extract follow-up commitments from THIS note's Plan section via the
 *      FollowupExtractor (Haiku), creates new FollowUp rows with status=OPEN.
 *      Idempotent on noteId: if any FollowUp with originNoteId = this note
 *      already exists we SKIP extraction (the retry already won).
 *
 * Anti-regression rule 20: brief reads only Note.status in { SIGNED,
 * TRANSFERRED }. Grep-enforced; no other status passes the where-filter.
 *
 * Idempotency: BullMQ jobId is `note-brief:{noteId}` (queue.ts). Re-runs
 * upsert the NoteBrief (same noteId — unique constraint) and skip follow-up
 * extraction if rows already exist.
 *
 * Errors bubble (rule 8 — never swallowed). BullMQ retries 3× with
 * exponential backoff per the queue defaults.
 */
export async function handle(job: Job<NoteBriefJob>) {
  const { noteId, orgId } = job.data;

  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId },
    include: {
      patient: true,
      encounter: {
        include: {
          episode: { include: { department: true, goals: true } },
        },
      },
      template: true,
    },
  });
  if (!note) {
    console.warn(`[note-brief] note ${noteId} not found — dropping`);
    return { skipped: 'not_found' };
  }
  if (note.status !== NoteStatus.SIGNED) {
    console.warn(
      `[note-brief] note ${noteId} status=${note.status} (expected SIGNED) — dropping`,
    );
    return { skipped: 'not_signed' };
  }
  if (!note.finalJson) {
    console.warn(`[note-brief] note ${noteId} has no finalJson — dropping`);
    return { skipped: 'no_final_json' };
  }

  const todayIso = new Date().toISOString();
  const episodeId = note.encounter?.episodeOfCareId ?? null;

  // Load prior signed notes — same patient + org; prefer same episode; never
  // include the just-signed note itself.
  const priorNotes = await prisma.note.findMany({
    where: {
      patientId: note.patientId,
      orgId,
      id: { not: noteId },
      status: { in: [NoteStatus.SIGNED, NoteStatus.TRANSFERRED] },
      ...(episodeId ? { encounter: { episodeOfCareId: episodeId } } : {}),
    },
    include: { template: true },
    orderBy: { signedAt: 'desc' },
    take: MAX_PRIOR_NOTES,
  });

  // Build the prompt input. Prior notes oldest → newest with the just-signed
  // note as the most-recent entry the brief is "about".
  const orderedPriorNotes = [...priorNotes].reverse();
  const allSignedNotes = [...orderedPriorNotes, note];

  const briefPriorNotes = allSignedNotes.map((n) =>
    projectSignedNoteForBrief(n, 'Attending Clinician'),
  );

  const topGoals = note.encounter?.episode?.goals
    ?.filter((g) => g.status === 'ACTIVE' || g.status === 'PARTIALLY_MET')
    .slice(0, 3) ?? [];

  // Unit 22 / F4 — pull EHR enrichment if the patient has a verified
  // PatientFhirIdentity. Silent skip on absent link or empty/stale cache;
  // BRIEF_GENERATED audit metadata records whether the brief was enriched.
  // Wrap in its own try/catch so an infra failure (Prisma timeout, missing
  // table during migration) in the OPTIONAL enrichment path doesn't block
  // core brief generation — projection is purely additive by contract.
  let externalEhrContext: Awaited<ReturnType<typeof loadExternalEhrContext>> | null = null;
  try {
    externalEhrContext = await loadExternalEhrContext({
      patientId: note.patientId,
      ehrSystem: 'nextgen',
    });
  } catch (err) {
    console.warn('[note-brief] loadExternalEhrContext failed; continuing without enrichment:', err);
  }

  const briefInput = {
    division: note.division,
    todayIso,
    patient: projectPatientForBrief(note.patient),
    episode: note.encounter?.episode
      ? projectEpisodeForBrief(note.encounter.episode)
      : null,
    priorNotes: briefPriorNotes,
    topActiveGoals: topGoals.map(projectGoalForBrief),
    externalEhrContext,
  };

  let briefResult;
  try {
    const generator = new BriefGenerator();
    // Unit 35 — cost rollup metering. orgId + noteId are both in scope.
    briefResult = await generator.generate(briefInput, { orgId, noteId });
  } catch (err) {
    const errorClass = err instanceof Error ? err.name : 'Unknown';
    await writeAuditLog({
      orgId,
      action: 'BRIEF_GENERATION_FAILED',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: { errorClass },
    });
    throw err;
  }

  // Follow-up extraction. Idempotent: skip if any rows already exist for
  // this origin note.
  const existingOriginated = await prisma.followUp.count({
    where: { originNoteId: noteId },
  });
  let createdFollowUps: FollowUp[] = [];
  if (existingOriginated === 0) {
    const extractor = new FollowupExtractor();
    const extraction = await extractor.extractFromFinalJson(
      noteId,
      note.signedAt?.toISOString() ?? todayIso,
      note.finalJson as unknown as FinalJsonShape,
    );
    if (extraction.items.length > 0) {
      createdFollowUps = await prisma.$transaction(
        extraction.items.map((item) =>
          prisma.followUp.create({
            data: {
              orgId,
              patientId: note.patientId,
              episodeId,
              originNoteId: noteId,
              text: item.text,
            },
          }),
        ),
      );
      for (const fu of createdFollowUps) {
        await writeAuditLog({
          orgId,
          action: 'FOLLOWUP_CREATED',
          resourceType: 'FollowUp',
          resourceId: fu.id,
          metadata: {
            originNoteId: noteId,
            textLength: fu.text.length,
            extractor: 'llm-haiku',
          },
        });
      }
    }
  }

  // Open follow-ups for the brief preview: ALL currently-open follow-ups for
  // this patient (the next visit's clinician should see every commitment,
  // not just the ones from this note).
  const openFollowUps = await prisma.followUp.findMany({
    where: { patientId: note.patientId, orgId, status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { originNote: { select: { signedAt: true } } },
  });
  const openFollowUpsPreview: FollowUpPreview[] = openFollowUps.map((fu) => ({
    followUpId: fu.id,
    text: fu.text,
    status: fu.status,
    source: {
      noteId: fu.originNoteId,
      date: (fu.originNote?.signedAt ?? fu.createdAt).toISOString().slice(0, 10),
    },
  }));

  // Unit 23 / F5 — drop the LLM-output ehrEnrichment shape; replace with
  // the hydrated shape (each entry augmented with fetchedAt from the
  // projected cache). hydrateEhrEnrichment returns undefined when the
  // LLM emitted no recognized ids OR when no externalEhrContext was loaded.
  const { ehrEnrichment: llmEhrEnrichment, ...briefRest } = briefResult.brief;
  const hydratedEhrEnrichment = hydrateEhrEnrichment(llmEhrEnrichment, externalEhrContext);

  const briefContent: PriorContextBriefContent = {
    ...briefRest,
    generatedAt: todayIso,
    generatorVersion: briefResult.generatorVersion,
    openFollowUps: openFollowUpsPreview,
    ...(hydratedEhrEnrichment ? { ehrEnrichment: hydratedEhrEnrichment } : {}),
  };

  await prisma.noteBrief.upsert({
    where: { noteId },
    create: {
      noteId,
      patientId: note.patientId,
      orgId,
      episodeId,
      sourceNoteIds: briefResult.brief.sourceNoteIds,
      generatorVersion: briefResult.generatorVersion,
      model: briefResult.model,
      content: briefContent as unknown as Prisma.InputJsonValue,
    },
    update: {
      sourceNoteIds: briefResult.brief.sourceNoteIds,
      generatedAt: new Date(todayIso),
      generatorVersion: briefResult.generatorVersion,
      model: briefResult.model,
      content: briefContent as unknown as Prisma.InputJsonValue,
    },
  });

  if (briefResult.generatorVersion === BRIEF_GENERATOR_FALLBACK_VERSION) {
    await writeAuditLog({
      orgId,
      action: 'BRIEF_FALLBACK_HAIKU',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: { attempts: briefResult.attempts },
    });
  }

  await writeAuditLog({
    orgId,
    action: 'BRIEF_GENERATED',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: {
      sourceNoteIdCount: briefResult.brief.sourceNoteIds.length,
      followUpsCreated: createdFollowUps.length,
      openFollowUpsAtGenerate: openFollowUpsPreview.length,
      model: briefResult.model,
      generatorVersion: briefResult.generatorVersion,
      attempts: briefResult.attempts,
      stub: briefResult.stub,
      // Unit 22 / F4 — auditor lens: was this brief EHR-enriched?
      hasEhrContext: !!externalEhrContext,
      ehrResourceCount: externalEhrContext
        ? externalEhrContext.activeConditions.length +
          externalEhrContext.currentMedications.length +
          externalEhrContext.allergies.length +
          externalEhrContext.recentObservations.length +
          externalEhrContext.recentProcedures.length +
          externalEhrContext.recentDiagnosticReports.length
        : 0,
    },
  });

  return {
    ok: true,
    noteId,
    generatorVersion: briefResult.generatorVersion,
    followUpsCreated: createdFollowUps.length,
  };
}
