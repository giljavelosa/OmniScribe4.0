/**
 * One-off diagnostic: replay the brief-generation pipeline for one signed note
 * and surface the actual error (instead of the audit-log's swallowed
 * `errorClass: "Error"`).
 *
 * Mirrors src/workers/note-brief/handler.ts so the input shape passed to
 * BriefGenerator.generate() matches exactly. Pass a noteId via argv;
 * defaults to Robert Hays' most recent signed note.
 *
 *   npx tsx scripts/diagnose-brief-error.ts [noteId]
 */

import { NoteStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { BriefGenerator } from '@/services/brief/BriefGenerator';
import {
  projectPatientForBrief,
  projectEpisodeForBrief,
  projectGoalForBrief,
  projectSignedNoteForBrief,
} from '@/lib/notes/build-brief-prompt';
import { bedrockConfig } from '@/services/llm';

const DEFAULT_NOTE_ID = 'cmpjb5rwd0056m1uui1e7aqns'; // Robert Hays, most recent signed
const MAX_PRIOR_NOTES = 2;

async function main() {
  const noteId = process.argv[2] ?? DEFAULT_NOTE_ID;

  console.log('---');
  console.log('Bedrock config:', {
    region: bedrockConfig.region,
    sonnetModelId: bedrockConfig.sonnetModelId,
    haikuModelId: bedrockConfig.haikuModelId,
    isStubMode: bedrockConfig.isStubMode,
  });
  console.log('---');
  console.log(`Replaying brief generation for note ${noteId}...`);

  const note = await prisma.note.findFirst({
    where: { id: noteId },
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
    console.error('Note not found.');
    process.exit(1);
  }
  if (note.status !== NoteStatus.SIGNED) {
    console.error(`Note status is ${note.status}, expected SIGNED.`);
    process.exit(1);
  }
  if (!note.finalJson) {
    console.error('Note has no finalJson.');
    process.exit(1);
  }

  console.log('Note loaded:', {
    id: note.id,
    patientId: note.patientId,
    orgId: note.orgId,
    status: note.status,
    division: note.division,
    signedAt: note.signedAt,
  });

  const todayIso = new Date().toISOString();
  const episodeId = note.encounter?.episodeOfCareId ?? null;

  const priorNotes = await prisma.note.findMany({
    where: {
      patientId: note.patientId,
      orgId: note.orgId,
      id: { not: noteId },
      status: { in: [NoteStatus.SIGNED, NoteStatus.TRANSFERRED] },
      ...(episodeId ? { encounter: { episodeOfCareId: episodeId } } : {}),
    },
    include: { template: true },
    orderBy: { signedAt: 'desc' },
    take: MAX_PRIOR_NOTES,
  });
  console.log(`Loaded ${priorNotes.length} prior signed note(s).`);

  const orderedPriorNotes = [...priorNotes].reverse();
  const allSignedNotes = [...orderedPriorNotes, note];
  const briefPriorNotes = allSignedNotes.map((n) =>
    projectSignedNoteForBrief(n, 'Attending Clinician'),
  );

  const topGoals =
    note.encounter?.episode?.goals
      ?.filter((g) => g.status === 'ACTIVE' || g.status === 'PARTIALLY_MET')
      .slice(0, 3) ?? [];

  const briefInput = {
    division: note.division,
    todayIso,
    patient: projectPatientForBrief(note.patient),
    episode: note.encounter?.episode
      ? projectEpisodeForBrief(note.encounter.episode)
      : null,
    priorNotes: briefPriorNotes,
    topActiveGoals: topGoals.map(projectGoalForBrief),
    externalEhrContext: null,
    externalContexts: [],
  };

  console.log('---');
  console.log('Calling BriefGenerator.generate()...');

  try {
    const generator = new BriefGenerator();
    const result = await generator.generate(briefInput, { orgId: note.orgId, noteId });
    console.log('---');
    console.log('SUCCESS:', {
      model: result.model,
      generatorVersion: result.generatorVersion,
      attempts: result.attempts,
      stub: result.stub,
      objectiveMeasureCount: result.brief.objectiveMeasures.length,
    });
    console.log('objectiveMeasures:', JSON.stringify(result.brief.objectiveMeasures, null, 2));
  } catch (err) {
    console.log('---');
    console.error('FAILED. Full error:');
    if (err instanceof Error) {
      console.error('  name:', err.name);
      console.error('  message:', err.message);
      console.error('  stack:', err.stack);
      // AWS SDK errors carry extra metadata on $metadata / Code.
      const anyErr = err as unknown as {
        $metadata?: unknown;
        $fault?: unknown;
        Code?: unknown;
        $response?: unknown;
      };
      if (anyErr.$metadata) console.error('  $metadata:', anyErr.$metadata);
      if (anyErr.$fault) console.error('  $fault:', anyErr.$fault);
      if (anyErr.Code) console.error('  Code:', anyErr.Code);
    } else {
      console.error(err);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Top-level error:', err);
  process.exit(1);
});
