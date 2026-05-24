/**
 * Unit 48 PR3 — intent-aware brief flow for the note-brief worker.
 *
 * Decision 11 (sibling pattern): this file owns the entire intent-aware
 * brief generation path. The `note-brief/handler.ts` worker's existing
 * brief generation block is byte-for-byte unchanged; the handler only
 * gains a top-of-function dispatcher that calls `runIntentAwareBrief()`
 * for supported (division, intent) pairs and falls through otherwise.
 *
 * The flow here parallels the existing handler's flow (load priors →
 * load EHR enrichment → generate → extract follow-ups → snapshot open
 * follow-ups → hydrate → upsert NoteBrief → audit) — duplication is
 * deliberate per Decision 11 so the existing path has zero behavioral
 * exposure to PR3 changes. A future cleanup unit (~48.5) can fold the
 * shared steps into helpers once the intent-aware path validates in
 * prod for 2–3 weeks.
 *
 * What's intentionally different from the existing handler:
 *   - Calls `IntentAwareBriefGenerator` instead of `BriefGenerator`.
 *   - Stamps `intent` on the resulting `NoteBrief.content` (renderer
 *     branches on this field via `<IntentAwareBriefCard>`).
 *   - Validates against spine-specific Zod schema (extends base).
 *   - Audit metadata records `intentSource` + the intent-aware
 *     `generatorVersion` so auditors can quantify how often the
 *     intent-aware path fired.
 */

import { type Note, NoteStatus, Prisma, type FollowUp, type EncounterIntent } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import {
  IntentAwareBriefGenerator,
  INTENT_AWARE_BRIEF_GENERATOR_FALLBACK_VERSION,
} from '@/services/brief/IntentAwareBriefGenerator';
import { FollowupExtractor } from '@/services/brief/FollowupExtractor';
import { PERSONA_VERSION } from '@/services/copilot/persona';
import {
  projectPatientForBrief,
  projectEpisodeForBrief,
  projectGoalForBrief,
  projectSignedNoteForBrief,
  type BriefExternalContextProjection,
} from '@/lib/notes/build-brief-prompt';
import { loadExternalEhrContext } from '@/lib/fhir/project-ehr-context';
import { hydrateEhrEnrichment } from '@/lib/notes/hydrate-ehr-enrichment';
import { loadExternalContextsForBrief } from '@/lib/brief/load-external-contexts';
import type {
  PriorContextBriefContent,
  FollowUpPreview,
} from '@/types/brief';
import type { FinalJsonShape } from '@/lib/notes/build-artifact-prompt';

const MAX_PRIOR_NOTES = 2;

/**
 * Loaded note shape — the worker handler's existing `findFirst` already
 * includes patient + encounter + episode + template; we expose the same
 * shape here so the handler can pass the already-fetched row straight in
 * (no double-load).
 */
type LoadedNote = Note & {
  patient: Parameters<typeof projectPatientForBrief>[0];
  encounter:
    | (NonNullable<Note['encounterId']> extends string
        ? {
            episodeOfCareId: string | null;
            episode: Parameters<typeof projectEpisodeForBrief>[0] & {
              goals: Parameters<typeof projectGoalForBrief>[0][];
            } | null;
          }
        : never)
    | null;
};

export type RunIntentAwareBriefArgs = {
  /** The already-loaded note (worker handler did the findFirst). */
  // Loosened to `any`-via-runtime to keep this helper's type surface
  // independent of the worker handler's include shape — the runtime
  // guarantees the shape is what we expect (the handler is the only
  // caller, and PR3 adds an integration test for it).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  note: any;
  /** The encounter's clinical intent — already verified to be in
   *  SUPPORTED_INTENT_PAIRS by the dispatcher. */
  intent: EncounterIntent;
  /** Provenance of intent — recorded in audit metadata. */
  intentSource: string;
  orgId: string;
};

export type RunIntentAwareBriefResult = {
  ok: true;
  noteId: string;
  generatorVersion: string;
  followUpsCreated: number;
  intent: EncounterIntent;
};

/**
 * Runs the intent-aware brief generation flow end-to-end. Mirrors the
 * existing handler's flow but uses `IntentAwareBriefGenerator` and the
 * spine-specific output schema. Returns the same `{ ok, noteId, ... }`
 * shape the dispatcher can pass straight back to BullMQ.
 */
export async function runIntentAwareBrief(
  args: RunIntentAwareBriefArgs,
): Promise<RunIntentAwareBriefResult> {
  const { note, intent, intentSource, orgId } = args;
  const noteId = note.id as string;

  if (note.status !== NoteStatus.SIGNED) {
    throw new Error(
      `runIntentAwareBrief: note ${noteId} status=${note.status} (expected SIGNED) — dispatcher should not have routed here`,
    );
  }
  if (!note.finalJson) {
    throw new Error(`runIntentAwareBrief: note ${noteId} has no finalJson`);
  }

  const todayIso = new Date().toISOString();
  const episodeId = note.encounter?.episodeOfCareId ?? null;

  // Load up to 2 prior signed notes — same shape as the existing
  // handler. Same query, same anti-regression rule 20 enforcement
  // (only SIGNED + TRANSFERRED).
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

  const orderedPriorNotes = [...priorNotes].reverse();
  const allSignedNotes = [...orderedPriorNotes, note];
  const briefPriorNotes = allSignedNotes.map((n) =>
    projectSignedNoteForBrief(n, 'Attending Clinician'),
  );

  const topGoals =
    note.encounter?.episode?.goals
      ?.filter((g: { status: string }) =>
        g.status === 'ACTIVE' || g.status === 'PARTIALLY_MET',
      )
      .slice(0, 3) ?? [];

  // EHR enrichment — same defensive try/catch posture as the existing
  // handler. Intent-aware spines may rely on EHR data (PR4's AWV spine
  // pulls care gaps from this), so we still load it; failure is non-fatal.
  let externalEhrContext: Awaited<ReturnType<typeof loadExternalEhrContext>> | null = null;
  try {
    externalEhrContext = await loadExternalEhrContext({
      patientId: note.patientId,
      ehrSystem: 'nextgen',
    });
  } catch (err) {
    console.warn(
      '[note-brief intent-aware] loadExternalEhrContext failed; continuing without enrichment:',
      err,
    );
  }

  let externalContexts: BriefExternalContextProjection[] = [];
  try {
    externalContexts = await loadExternalContextsForBrief({
      patientId: note.patientId,
      orgId,
      currentVisitStart: note.signedAt ?? new Date(todayIso),
    });
  } catch (err) {
    console.warn(
      '[note-brief intent-aware] loadExternalContextsForBrief failed; continuing:',
      err,
    );
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
    externalContexts,
  };

  let briefResult;
  try {
    const generator = new IntentAwareBriefGenerator();
    briefResult = await generator.generate(briefInput, intent, { orgId, noteId });
  } catch (err) {
    const errorClass = err instanceof Error ? err.name : 'Unknown';
    const errorMessage =
      err instanceof Error ? err.message.slice(0, 600) : String(err).slice(0, 600);
    await writeAuditLog({
      orgId,
      action: 'BRIEF_GENERATION_FAILED',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: { errorClass, errorMessage, intent, intentSource, path: 'intent-aware' },
    });
    throw err;
  }

  // Follow-up extraction — idempotent (skip if any FollowUp row already
  // exists with originNoteId === this note). Same logic as the existing
  // handler.
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
            path: 'intent-aware',
          },
        });
      }
    }
  }

  // Snapshot ALL currently-open follow-ups (not just from this note) so
  // the renderer can show every commitment in the next visit's brief.
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

  // Spread the spine output INTO the canonical PriorContextBriefContent
  // envelope. Spine-specific extra fields (goalLedger, medicalNecessity)
  // ride through as additional properties on the Json column — the
  // renderer reads them via the discriminated `intent` tag.
  //
  // EHR enrichment intentionally NOT hydrated in the intent-aware path
  // for PR3 (the REHAB Progress Note spine doesn't render it). PR4's AWV
  // spine adds the hydration step. Strip the un-hydrated `ehrEnrichment`
  // field that comes through on the spine output (inherits from
  // BriefLLMOutputSchema) so the resulting briefContent matches
  // PriorContextBriefContentSchema's hydrated shape requirement.
  const { ehrEnrichment: _llmEhr, ...briefRest } = briefResult.brief;
  void _llmEhr;
  const briefContent: PriorContextBriefContent & Record<string, unknown> = {
    ...briefRest,
    generatedAt: todayIso,
    generatorVersion: briefResult.generatorVersion,
    openFollowUps: openFollowUpsPreview,
    intent: briefResult.brief.intent,
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

  if (briefResult.generatorVersion === INTENT_AWARE_BRIEF_GENERATOR_FALLBACK_VERSION) {
    await writeAuditLog({
      orgId,
      action: 'BRIEF_FALLBACK_HAIKU',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: { attempts: briefResult.attempts, path: 'intent-aware' },
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
      personaVersion: PERSONA_VERSION,
      hasEhrContext: !!externalEhrContext,
      externalContextCount: externalContexts.length,
      // Unit 48 PR3 — intent-aware path auditing. Auditors can query
      // `BRIEF_GENERATED` where `metadata.path === 'intent-aware'` to
      // quantify how often the spine-specific generator fired.
      path: 'intent-aware',
      intent,
      intentSource,
    },
  });

  return {
    ok: true,
    noteId,
    generatorVersion: briefResult.generatorVersion,
    followUpsCreated: createdFollowUps.length,
    intent,
  };
}
