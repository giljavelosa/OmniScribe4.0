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
 * Sentinel error thrown from the per-section write tx when the note is
 * found to be SIGNED at write time. Caught by the per-section loop so a
 * mid-run sign aborts the remaining sections cleanly without bubbling
 * an exception out of the BullMQ handler (which would trigger retries).
 */
class NoteSignedDuringAnalysisError extends Error {
  constructor(public readonly noteId: string) {
    super(`note ${noteId} signed mid-analysis`);
    this.name = 'NoteSignedDuringAnalysisError';
  }
}

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
 * Sign-race protection (regression fix 2026-05-25):
 *   - The outer status check at the top is necessary but NOT sufficient:
 *     each section's LLM call can take 10–30 s, so a 4-section note can
 *     run ~2 minutes during which the clinician may navigate to /sign
 *     and complete the sign flow. Without a re-check inside the per-
 *     section write tx, late-arriving flags would land on an already-
 *     SIGNED note (rule 3 violation: signed notes' compliance posture
 *     must be whatever was decided at sign time).
 *   - Defense in depth: the sign route now refuses 409
 *     `flag_analysis_pending` while `flagAnalysisCompletedAt` is unset
 *     or stale-against-startedAt; AND this worker re-reads `note.status`
 *     inside each section's write tx and aborts if SIGNED.
 *
 * Lifecycle:
 *   - The route stamped `flagAnalysisStartedAt` at enqueue time.
 *   - This handler stamps `flagAnalysisCompletedAt = now()` in a finally
 *     block (success, sign-mid-run, error, even outer guards) so the
 *     sign-time gate clears deterministically. The BullMQ retry on
 *     thrown errors will re-stamp completedAt on the retry's terminal
 *     state.
 */
export async function handleAnalyzeFlags(job: Job<AnalyzeFlagsJob>) {
  const { noteId, orgId, requestId } = job.data;

  // Wrap the entire body in try/finally so `flagAnalysisCompletedAt` is
  // ALWAYS stamped — including on outer-guard early returns + thrown
  // errors. Without this, a mid-run failure or "skipped" return would
  // leave the sign route's gate stuck on "pending" forever.
  try {
    const note = await prisma.note.findFirst({
      where: { id: noteId, orgId },
      include: { template: true, patient: true },
    });
    if (!note) {
      console.warn(`[analyze-flags] note ${noteId} not found — dropping`);
      return { skipped: 'not_found' as const };
    }
    if (note.status === NoteStatus.SIGNED) {
      return { skipped: 'signed' as const };
    }
    if (!note.template) {
      console.warn(`[analyze-flags] note ${noteId} has no template — dropping`);
      return { skipped: 'no_template' as const };
    }

    const sections =
      (note.template.sectionSchema as { sections: NoteSectionDef[] } | null)?.sections ?? [];
    if (sections.length === 0) {
      return { ok: true as const, sectionsAnalyzed: 0, flagsCreated: 0 };
    }

    const draft =
      (note.draftJson as Record<string, { content: string }> | null) ?? {};
    const transcript = note.transcriptClean as TranscriptClean | null;
    const patient = projectPatientForPrompt(note.patient);
    const analyzer = new FlagAnalyzer();

    let totalCreated = 0;
    let sectionsAnalyzed = 0;
    let abortedBySign = false;
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
          division: note.division,
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
      // rolls back the delete, preserving prior flags. The status re-read
      // lives INSIDE the tx so a sign that lands between the analyze call
      // and the write reliably aborts the write (the tx rolls back; no
      // partial flag insertion on a SIGNED note).
      try {
        const created = await prisma.$transaction(async (tx) => {
          const fresh = await tx.note.findUnique({
            where: { id: noteId },
            select: { status: true },
          });
          if (fresh?.status === NoteStatus.SIGNED) {
            throw new NoteSignedDuringAnalysisError(noteId);
          }
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
                  // GREEN auto-resolves as AUTO_VERIFIED — no clinician action needed.
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
      } catch (err) {
        if (err instanceof NoteSignedDuringAnalysisError) {
          console.warn(
            `[analyze-flags] note ${noteId} signed during analysis — ` +
              `aborting remaining sections (analyzed ${sectionsAnalyzed}/${sections.length})`,
          );
          abortedBySign = true;
          break;
        }
        // Any other DB error — log + continue with the next section so a
        // single transient failure doesn't poison sibling work.
        console.warn(`[analyze-flags] section ${section.id} write failed:`, err);
        continue;
      }
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
        abortedBySign,
      },
    });

    return {
      ok: true as const,
      sectionsAnalyzed,
      flagsCreated: totalCreated,
      abortedBySign,
    };
  } finally {
    // Always clear the "pending" gate, even on early returns / throws.
    // Wrapped in its own try/catch so a DB hiccup here doesn't replace
    // the original error with a less-actionable one.
    try {
      await prisma.note.update({
        where: { id: noteId },
        data: { flagAnalysisCompletedAt: new Date() },
      });
    } catch (err) {
      console.warn(
        `[analyze-flags] failed to stamp flagAnalysisCompletedAt for ${noteId}:`,
        err,
      );
    }
  }
}
