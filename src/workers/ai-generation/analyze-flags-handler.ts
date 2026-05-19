import type { Job } from 'bullmq';
import { NoteStatus, ReviewFlagSeverity, ReviewFlagStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { FlagAnalyzer } from '@/services/review/FlagAnalyzer';
import type { NoteSectionDef } from '@/lib/notes/build-prompt';
import { projectPatientForPrompt } from '@/lib/notes/projections';
import type { TranscriptClean } from '@/services/transcription';

type AnalyzeFlagsJob = {
  noteId: string;
  orgId: string;
  type: 'analyze-flags';
  requestId: string;
};

/**
 * analyze-flags handler (Unit 14).
 *
 * Per-section analysis (not whole-note) so the prompt context stays
 * bounded + a failed section doesn't poison sibling sections. For each
 * template section that has draft content, calls FlagAnalyzer + writes
 * ReviewFlag rows.
 *
 * Idempotency:
 *   - BullMQ jobId at the queue layer (includes requestId) collapses
 *     duplicate enqueues.
 *   - Before analysis, deletes any existing OPEN flags for this
 *     (noteId, sectionId) so a re-analyze doesn't duplicate the same
 *     finding. RESOLVED + DISMISSED rows are preserved.
 *
 * Refuses if note.status === SIGNED (rule 3 — no analysis of immutable
 * artifacts; signed notes' compliance posture is whatever was decided
 * at sign time).
 */
export async function handleAnalyzeFlags(job: Job<AnalyzeFlagsJob>) {
  const { noteId, orgId, requestId } = job.data;

  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId },
    include: { template: true, patient: true },
  });
  if (!note) {
    console.warn(`[analyze-flags] note ${noteId} not found — dropping`);
    return { skipped: 'not_found' };
  }
  if (note.status === NoteStatus.SIGNED) {
    return { skipped: 'signed' };
  }
  if (!note.template) {
    console.warn(`[analyze-flags] note ${noteId} has no template — dropping`);
    return { skipped: 'no_template' };
  }

  const sections =
    (note.template.sectionSchema as { sections: NoteSectionDef[] } | null)?.sections ?? [];
  if (sections.length === 0) {
    return { ok: true, sectionsAnalyzed: 0, flagsCreated: 0 };
  }

  const draft =
    (note.draftJson as Record<string, { content: string }> | null) ?? {};
  const transcript = note.transcriptClean as TranscriptClean | null;
  const patient = projectPatientForPrompt(note.patient);
  const analyzer = new FlagAnalyzer();

  let totalCreated = 0;
  let sectionsAnalyzed = 0;
  for (const section of sections) {
    const content = draft[section.id]?.content?.trim();
    if (!content) continue;
    sectionsAnalyzed += 1;

    let flags: Awaited<ReturnType<typeof analyzer.analyzeSection>>;
    try {
      flags = await analyzer.analyzeSection({
        sectionLabel: section.label,
        sectionContent: content,
        transcript,
        patient,
        requestId: `${requestId}:${section.id}`,
      });
    } catch (err) {
      // LLM call failed — do NOT delete the existing OPEN flags. The clinician
      // keeps visibility into the previously-flagged compliance issues; the
      // worker will retry on the next regenerate.
      console.warn(`[analyze-flags] section ${section.id} failed:`, err);
      continue;
    }

    // Delete + create atomically AFTER a successful analyze. Failure here
    // rolls back the delete, preserving prior flags.
    const created = await prisma.$transaction(async (tx) => {
      await tx.reviewFlag.deleteMany({
        where: { noteId, sectionId: section.id, status: ReviewFlagStatus.OPEN },
      });
      if (flags.flags.length === 0) return [] as Array<{ id: string }>;
      return Promise.all(
        flags.flags.map((f) =>
          tx.reviewFlag.create({
            data: {
              noteId,
              orgId,
              sectionId: section.id,
              severity: f.severity as ReviewFlagSeverity,
              // GREEN auto-resolves as AUTO_VERIFIED — no need for clinician action.
              status:
                f.severity === 'GREEN'
                  ? ReviewFlagStatus.RESOLVED
                  : ReviewFlagStatus.OPEN,
              resolutionAction: f.severity === 'GREEN' ? 'AUTO_VERIFIED' : null,
              resolvedAt: f.severity === 'GREEN' ? new Date() : null,
              claim: f.claim,
              rationale: f.rationale,
              evidence: f.evidence ?? null,
              suggestion: f.suggestion ?? null,
              confidence: f.confidence ?? 0.5,
            },
            select: { id: true },
          }),
        ),
      );
    });
    totalCreated += created.length;
  }

  await writeAuditLog({
    orgId,
    action: 'FLAGS_ANALYZED',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: {
      requestId,
      sectionsAnalyzed,
      totalFlagsCreated: totalCreated,
    },
  });

  return { ok: true, sectionsAnalyzed, flagsCreated: totalCreated };
}
