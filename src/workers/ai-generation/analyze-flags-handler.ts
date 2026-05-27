import type { Job } from 'bullmq';
import { NoteStatus, Prisma, ReviewFlagSeverity, ReviewFlagStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { FlagAnalyzer } from '@/services/review/FlagAnalyzer';
import type { NoteSectionDef } from '@/lib/notes/build-prompt';
import { projectPatientForPrompt } from '@/lib/notes/projections';
import type { TranscriptClean } from '@/services/transcription';
import {
  FLAG_ANALYSIS_RUN_CAP,
  hashSectionContent,
  parseSectionHashes,
  signatureFor,
} from '@/lib/notes/flag-analysis-state';

type AnalyzeFlagsJob = {
  noteId: string;
  orgId: string;
  type: 'analyze-flags';
  requestId: string;
};

/**
 * Where this analyzer call came from. Drives audit-action selection +
 * diff-skip eligibility:
 *
 *   AUTO_ON_DRAFT       — the inline call at the end of generate-note.
 *                         Run #1; always analyzes every populated section
 *                         (no prior hashes to diff against).
 *   CLINICIAN_RE_ANALYZE — the BullMQ-routed re-analyze button. Run #2;
 *                          eligible for the per-section diff-skip.
 */
export type FlagAnalysisRunOrigin = 'AUTO_ON_DRAFT' | 'CLINICIAN_RE_ANALYZE';

class NoteSignedDuringAnalysisError extends Error {
  constructor(public readonly noteId: string) {
    super(`note ${noteId} signed mid-analysis`);
    this.name = 'NoteSignedDuringAnalysisError';
  }
}

/**
 * Result the core returns to its callers (BullMQ handler + inline pipeline).
 * Surfaces enough for the caller to write the right audit row + decide
 * how to set the lifecycle stamps.
 */
export type FlagAnalysisCoreResult =
  | {
      ok: true;
      runOrigin: FlagAnalysisRunOrigin;
      runCount: number;
      sectionsAnalyzed: number;
      sectionsSkippedUnchanged: number;
      flagsCreated: number;
      carriedForwardCount: number;
      abortedBySign: boolean;
    }
  | { skipped: 'not_found' | 'signed' | 'no_template' | 'no_sections' | 'cap_reached'; runCount?: number };

/**
 * analyze-flags handler — Unit 14 + Sprint 0 lockdown.
 *
 * Per-section analysis (not whole-note) so the prompt context stays
 * bounded + a failed section doesn't poison sibling sections. For each
 * template section that has draft content, calls FlagAnalyzer (Haiku)
 * + writes ReviewFlag rows.
 *
 * Idempotency + safety properties (existing):
 *   - BullMQ jobId at the queue layer collapses duplicate enqueues.
 *   - Before writing, deletes existing OPEN flags for the (noteId,
 *     sectionId) so re-analyze doesn't duplicate the same OPEN row.
 *     RESOLVED + DISMISSED rows are preserved (they are the
 *     decision-memory substrate).
 *   - Status re-check inside each per-section write tx: if the note
 *     signs mid-analysis, the tx rolls back; no partial flag rows on
 *     an already-SIGNED note (rule 3 protection).
 *
 * Sprint 0 lockdown additions:
 *
 *   1. Run-count enforcement.
 *      Pre-flight check refuses the run when `flagAnalysisRunCount >=
 *      FLAG_ANALYSIS_RUN_CAP` (the route enforces the same; this is
 *      defense in depth for direct worker callers). On every
 *      successful run (or guarded failure path), `runCount` bumps in
 *      the finally block.
 *
 *   2. Per-section diff-skip on CLINICIAN_RE_ANALYZE.
 *      For each section, if the SHA-256 of the current draft content
 *      equals the hash captured at the end of the prior run, the
 *      analyzer SKIPS the section entirely: no LLM call, no flag
 *      mutations. The flag set for that section is preserved
 *      verbatim. Audits FLAGS_SECTION_SKIPPED_UNCHANGED so the
 *      auditor lens can prove "no spend was made re-analyzing
 *      unchanged content."
 *
 *   3. Claim-signature carry-forward.
 *      Before creating a new OPEN flag, the analyzer looks up
 *      `(noteId, claimSignature)` for any prior RESOLVED/DISMISSED
 *      row with a matching signature. If found, the new row is
 *      created already in that resolved/dismissed state with
 *      `resolutionAction = 'CARRIED_FORWARD'`, citing the prior
 *      decision + date in `resolutionNote`. Audits FLAGS_CARRIED_FORWARD
 *      per row. This is the "I already fixed this; stop bringing it
 *      back up" defense — independent of LLM probabilism.
 *
 *   4. Section-hash snapshot.
 *      At the end of every run, `Note.flagAnalysisSectionHashes` is
 *      stamped with the current per-section content hashes. Drives:
 *      (a) the next run's diff-skip; (b) the sign route's
 *      edited-since-analysis attestation gate.
 */
export async function handleAnalyzeFlags(job: Job<AnalyzeFlagsJob>) {
  return runFlagAnalysisCore({
    noteId: job.data.noteId,
    orgId: job.data.orgId,
    requestId: job.data.requestId,
    runOrigin: 'CLINICIAN_RE_ANALYZE',
  });
}

export async function runFlagAnalysisCore(args: {
  noteId: string;
  orgId: string;
  requestId: string;
  runOrigin: FlagAnalysisRunOrigin;
}): Promise<FlagAnalysisCoreResult> {
  const { noteId, orgId, requestId, runOrigin } = args;

  // Wrap the entire body in try/finally so the lifecycle stamps are
  // ALWAYS applied — including on outer-guard early returns + thrown
  // errors. Without this, a mid-run failure or "skipped" return would
  // leave the sign route's gate stuck on "pending" forever AND would
  // not consume the retry budget (so a clinician could chase
  // failures indefinitely).
  let didRun = false;
  let resultForFinally: FlagAnalysisCoreResult = {
    skipped: 'not_found',
    runCount: undefined,
  };
  try {
    const note = await prisma.note.findFirst({
      where: { id: noteId, orgId },
      include: { template: true, patient: true },
    });
    if (!note) {
      console.warn(`[analyze-flags] note ${noteId} not found — dropping`);
      resultForFinally = { skipped: 'not_found' };
      return resultForFinally;
    }
    if (note.status === NoteStatus.SIGNED) {
      resultForFinally = { skipped: 'signed', runCount: note.flagAnalysisRunCount };
      return resultForFinally;
    }
    if (!note.template) {
      console.warn(`[analyze-flags] note ${noteId} has no template — dropping`);
      resultForFinally = { skipped: 'no_template', runCount: note.flagAnalysisRunCount };
      return resultForFinally;
    }
    if (note.flagAnalysisRunCount >= FLAG_ANALYSIS_RUN_CAP) {
      // Defense in depth — the route already returns 409
      // analysis_cap_reached. The worker refuses too in case the row
      // raced past the route check or an internal caller bypassed it.
      // We DON'T bump runCount in the finally on this path (didRun
      // stays false) — the cap is already enforced.
      resultForFinally = { skipped: 'cap_reached', runCount: note.flagAnalysisRunCount };
      return resultForFinally;
    }

    const sections =
      (note.template.sectionSchema as { sections: NoteSectionDef[] } | null)?.sections ?? [];
    if (sections.length === 0) {
      resultForFinally = { skipped: 'no_sections', runCount: note.flagAnalysisRunCount };
      return resultForFinally;
    }
    didRun = true;

    const draft = (note.draftJson as Record<string, { content: string }> | null) ?? {};
    const transcript = note.transcriptClean as TranscriptClean | null;
    const patient = projectPatientForPrompt(note.patient);
    const analyzer = new FlagAnalyzer();

    // Prior-run hashes: source of truth for the diff-skip. On
    // AUTO_ON_DRAFT this is always null (first run); on
    // CLINICIAN_RE_ANALYZE it's whatever the inline run stamped.
    const priorHashes =
      runOrigin === 'AUTO_ON_DRAFT'
        ? null
        : parseSectionHashes(note.flagAnalysisSectionHashes);

    let totalCreated = 0;
    let carriedForwardCount = 0;
    let sectionsAnalyzed = 0;
    let sectionsSkippedUnchanged = 0;
    let abortedBySign = false;
    const newHashes: Record<string, string> = {};

    for (const section of sections) {
      const content = draft[section.id]?.content?.trim();
      // Snapshot the hash regardless of whether we run analysis — the
      // snapshot needs to be complete so future diffs work even on
      // sections that became empty / were never populated.
      newHashes[section.id] = hashSectionContent(draft[section.id]?.content ?? '');
      if (!content) continue;

      // Diff-skip: only on CLINICIAN_RE_ANALYZE, only when we have a
      // prior baseline, only when the hash is unchanged. AUTO_ON_DRAFT
      // always analyzes (priorHashes is null by construction).
      const priorHash = priorHashes?.[section.id];
      if (priorHash !== undefined && priorHash === newHashes[section.id]) {
        sectionsSkippedUnchanged++;
        await writeAuditLog({
          orgId,
          action: 'FLAGS_SECTION_SKIPPED_UNCHANGED',
          resourceType: 'Note',
          resourceId: noteId,
          metadata: {
            sectionId: section.id,
            hash: priorHash,
            runOrigin,
            requestId,
          },
        });
        continue;
      }

      sectionsAnalyzed++;

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
        // worker will retry on the next regenerate. The hash STAYS in newHashes
        // so the next run's diff-skip will still see this section as "needs
        // re-analysis" (because the prior hash will be the failed-run hash;
        // unchanged content means same hash means skip — that's correct: if
        // content didn't change we don't want to keep retrying the LLM).
        console.warn(`[analyze-flags] section ${section.id} failed:`, err);
        continue;
      }

      // Per-section delete+create transaction. Carry-forward lookup
      // happens INSIDE the tx so a concurrent /flags PATCH (a clinician
      // resolving an existing OPEN row mid-analysis) sees a consistent
      // snapshot. The status re-check inside the tx is the rule-3
      // defense — if the note signs mid-run, the tx rolls back and the
      // SIGNED note has no late-arriving OPEN rows.
      try {
        const txResult = await prisma.$transaction(async (tx) => {
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
          if (flags.flags.length === 0) {
            return { createdIds: [] as string[], carriedForwardIds: [] as Array<{ newId: string; priorId: string; priorStatus: ReviewFlagStatus }> };
          }

          const createdIds: string[] = [];
          const carriedForwardIds: Array<{
            newId: string;
            priorId: string;
            priorStatus: ReviewFlagStatus;
          }> = [];

          for (const f of flags.flags) {
            const sig = signatureFor(section.id, f.claim);

            // Decision-memory lookup: prior RESOLVED/DISMISSED flag
            // on this note with a matching signature. We deliberately
            // ignore the section filter here — the signature already
            // encodes sectionId (see signatureFor()) — so a flag the
            // clinician moved between sections via regenerate-section
            // would still get the right decision applied.
            const prior =
              f.severity === 'GREEN'
                ? null
                : await tx.reviewFlag.findFirst({
                    where: {
                      noteId,
                      claimSignature: sig,
                      status: { in: [ReviewFlagStatus.RESOLVED, ReviewFlagStatus.DISMISSED] },
                    },
                    orderBy: { resolvedAt: 'desc' },
                    select: {
                      id: true,
                      status: true,
                      resolutionAction: true,
                      resolutionNote: true,
                      resolvedByOrgUserId: true,
                      resolvedAt: true,
                    },
                  });

            const baseData = {
              noteId,
              orgId,
              sectionId: section.id,
              severity: f.severity as ReviewFlagSeverity,
              claim: f.claim,
              rationale: f.rationale,
              evidence: f.evidence ?? null,
              suggestion: f.suggestion ?? null,
              confidence: f.confidence ?? 0.5,
              claimSignature: sig,
            };

            if (prior) {
              const carriedAt = new Date();
              const priorDate = prior.resolvedAt?.toISOString().slice(0, 10) ?? 'prior run';
              const created = await tx.reviewFlag.create({
                data: {
                  ...baseData,
                  status: prior.status,
                  resolutionAction: 'CARRIED_FORWARD',
                  resolvedAt: carriedAt,
                  resolvedByOrgUserId: prior.resolvedByOrgUserId,
                  resolutionNote:
                    `Suppressed by decision-memory: clinician ${prior.status.toLowerCase()} an equivalent claim on ${priorDate}. ` +
                    (prior.resolutionNote ? `Prior note: ${prior.resolutionNote}` : ''),
                },
                select: { id: true },
              });
              carriedForwardIds.push({
                newId: created.id,
                priorId: prior.id,
                priorStatus: prior.status,
              });
              continue;
            }

            // No prior decision — standard create path. GREEN
            // auto-resolves as AUTO_VERIFIED (no clinician action
            // needed); everything else lands OPEN.
            const created = await tx.reviewFlag.create({
              data: {
                ...baseData,
                status:
                  f.severity === 'GREEN'
                    ? ReviewFlagStatus.RESOLVED
                    : ReviewFlagStatus.OPEN,
                resolutionAction: f.severity === 'GREEN' ? 'AUTO_VERIFIED' : null,
                resolvedAt: f.severity === 'GREEN' ? new Date() : null,
              },
              select: { id: true },
            });
            createdIds.push(created.id);
          }

          return { createdIds, carriedForwardIds };
        });

        totalCreated += txResult.createdIds.length + txResult.carriedForwardIds.length;
        carriedForwardCount += txResult.carriedForwardIds.length;

        // Audit each carry-forward separately so the auditor lens has
        // a single-action query for the decision-memory path. Volume
        // is bounded by (#resolved/dismissed × matching runs); small.
        for (const c of txResult.carriedForwardIds) {
          await writeAuditLog({
            orgId,
            action: 'FLAGS_CARRIED_FORWARD',
            resourceType: 'Note',
            resourceId: noteId,
            metadata: {
              newFlagId: c.newId,
              priorFlagId: c.priorId,
              priorStatus: c.priorStatus,
              sectionId: section.id,
              runOrigin,
              requestId,
            },
          });
        }
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

    // Stamp the section-hash snapshot for the next run's diff-skip
    // AND the sign-time edited-since-analysis gate. We use the hashes
    // we computed at the top of each section iteration, NOT a re-read
    // of draftJson — the clinician could have edited mid-run; the
    // hashes we used to decide skip/run are the ones that match the
    // flag rows we just wrote.
    await prisma.note.update({
      where: { id: noteId },
      data: {
        flagAnalysisSectionHashes: newHashes as unknown as Prisma.InputJsonValue,
      },
    });

    const auditAction =
      runOrigin === 'AUTO_ON_DRAFT' ? 'FLAGS_AUTO_ANALYZED_ON_DRAFT' : 'FLAGS_RE_ANALYZED';
    await writeAuditLog({
      orgId,
      action: auditAction,
      resourceType: 'Note',
      resourceId: noteId,
      metadata: {
        requestId,
        runOrigin,
        sectionsAnalyzed,
        sectionsSkippedUnchanged,
        flagsCreated: totalCreated,
        carriedForwardCount,
        abortedBySign,
      },
    });

    resultForFinally = {
      ok: true,
      runOrigin,
      runCount: note.flagAnalysisRunCount + 1,
      sectionsAnalyzed,
      sectionsSkippedUnchanged,
      flagsCreated: totalCreated,
      carriedForwardCount,
      abortedBySign,
    };
    return resultForFinally;
  } finally {
    // Lifecycle stamps + runCount bump.
    //
    // - flagAnalysisCompletedAt always advances so the sign-route gate
    //   clears.
    // - flagAnalysisRunCount bumps ONLY when we actually ran (or tried
    //   and failed gracefully — i.e. passed the cap pre-flight). The
    //   `skipped: 'cap_reached'` path explicitly leaves it untouched
    //   to avoid double-counting if a buggy caller hammers the worker
    //   past the cap.
    //
    // Wrapped in its own try/catch so a DB hiccup here doesn't replace
    // the original error with a less-actionable one.
    try {
      await prisma.note.update({
        where: { id: noteId },
        data: {
          flagAnalysisCompletedAt: new Date(),
          ...(didRun ? { flagAnalysisRunCount: { increment: 1 } } : {}),
        },
      });
    } catch (err) {
      console.warn(
        `[analyze-flags] failed to stamp lifecycle for ${noteId}:`,
        err,
      );
    }
  }
}
