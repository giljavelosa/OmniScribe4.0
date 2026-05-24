import { createHash } from 'node:crypto';

import { NoteStatus, Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import {
  FollowupExtractor,
  FOLLOWUP_EXTRACTOR_VERSION,
} from './FollowupExtractor';

/**
 * PresignFollowupSuggester — Sprint pre-sign-followup-suggest.
 *
 * Runs Cleo's `FollowupExtractor` against a DRAFT note's Plan section and
 * writes the resulting items as `FollowUp` rows with status=PROPOSED so the
 * /review card can render + the clinician can triage before sign.
 *
 * Anti-regression Rule 20 (narrow carve-out): this service may read DRAFT
 * Plan content because its outputs are PROPOSED — non-binding suggestions
 * that REQUIRE explicit clinician confirmation before they take effect.
 * Pre-sign FollowUp rows never reach `OPEN` automatically; the sign-time
 * hook auto-DROPs any still-PROPOSED row.
 *
 * Idempotency:
 *   - planHash = sha256(planContent). When the latest non-superseded
 *     PROPOSED set for this note has matching `proposedFromHash`, we skip
 *     work (the Plan hasn't meaningfully changed since last extraction).
 *   - On re-extraction (Plan changed), the prior PROPOSED set is dropped
 *     with reason 'plan_changed_superseded' BEFORE the new set is written —
 *     guaranteeing the UI always sees ≤ one set of "Suggested by Cleo"
 *     rows aligned with the current Plan. Accepted rows (already OPEN) are
 *     never touched.
 *
 * Audit trail:
 *   - FOLLOWUP_PROPOSAL_PROPOSED — one per row, with provenance metadata
 *     (sourceText, extractorVersion, planHash, model).
 *   - FOLLOWUP_PROPOSALS_SUPERSEDED — one per supersede event, with count.
 *
 * Errors bubble (rule 8) so the API caller can return 5xx and the user
 * can see what failed.
 */

export type PresignSuggestResult =
  | { ok: true; status: 'cached'; proposalCount: number; planHash: string }
  | {
      ok: true;
      status: 'created';
      proposalCount: number;
      supersededCount: number;
      planHash: string;
      extractorVersion: string;
    }
  | { ok: false; reason: 'note_not_found' | 'not_draft' | 'no_plan_content' | 'plan_too_short' };

export type SuggestOptions = {
  /** Manual button-press skips the planHash cache check. */
  force?: boolean;
};

const MIN_PLAN_CHARS = 50;
const SOURCE_TEXT_LIMIT = 200;

export class PresignFollowupSuggester {
  constructor(private readonly extractor: FollowupExtractor = new FollowupExtractor()) {}

  async suggestForDraft(
    noteId: string,
    orgId: string,
    opts: SuggestOptions = {},
  ): Promise<PresignSuggestResult> {
    const note = await prisma.note.findFirst({
      where: { id: noteId, orgId },
      select: {
        id: true,
        status: true,
        patientId: true,
        encounter: { select: { episodeOfCareId: true } },
        draftJson: true,
        template: { select: { sectionSchema: true } },
      },
    });
    if (!note) return { ok: false, reason: 'note_not_found' };
    if (note.status !== NoteStatus.DRAFT) return { ok: false, reason: 'not_draft' };

    const planContent = extractPlanContentFromDraft(
      note.draftJson,
      note.template?.sectionSchema,
    );
    if (planContent === null) return { ok: false, reason: 'no_plan_content' };
    if (planContent.trim().length < MIN_PLAN_CHARS) {
      return { ok: false, reason: 'plan_too_short' };
    }

    const planHash = sha256(planContent);

    // Cache check (skipped when force=true). Latest PROPOSED set with the
    // same hash means the Plan hasn't meaningfully changed since last run.
    if (!opts.force) {
      const cachedCount = await prisma.followUp.count({
        where: {
          originNoteId: noteId,
          orgId,
          status: 'PROPOSED',
          proposedFromHash: planHash,
        },
      });
      if (cachedCount > 0) {
        return {
          ok: true,
          status: 'cached',
          proposalCount: cachedCount,
          planHash,
        };
      }
    }

    const extraction = await this.extractor.extractFromPlanContent(
      noteId,
      new Date().toISOString(),
      planContent,
      { orgId, noteId, surface: 'copilot.draft.presignFollowup' },
    );

    const episodeId = note.encounter?.episodeOfCareId ?? null;

    // Re-extraction supersedes any existing PROPOSED rows for this note —
    // we always show ≤ one set of suggestions aligned with the current
    // Plan. Accepted (OPEN) rows are never touched (per Rule 24 — the
    // clinician's confirmation is final).
    const supersedeResult = await prisma.followUp.updateMany({
      where: { originNoteId: noteId, orgId, status: 'PROPOSED' },
      data: {
        status: 'DROPPED',
        dropReason: 'plan_changed_superseded',
        closedAt: new Date(),
      },
    });

    if (supersedeResult.count > 0) {
      await writeAuditLog({
        orgId,
        action: 'FOLLOWUP_PROPOSALS_SUPERSEDED',
        resourceType: 'Note',
        resourceId: noteId,
        metadata: {
          count: supersedeResult.count,
          reason: 'plan_changed_superseded',
          newPlanHash: planHash,
        },
      });
    }

    // Write the new PROPOSED rows + per-row audit.
    const created = await prisma.$transaction(
      extraction.items.map((item) =>
        prisma.followUp.create({
          data: {
            orgId,
            patientId: note.patientId,
            episodeId,
            originNoteId: noteId,
            text: item.text,
            status: 'PROPOSED',
            proposedSourceText: planContent.slice(0, SOURCE_TEXT_LIMIT),
            proposedExtractorVersion: FOLLOWUP_EXTRACTOR_VERSION,
            proposedFromHash: planHash,
          },
        }),
      ),
    );

    for (const row of created) {
      await writeAuditLog({
        orgId,
        action: 'FOLLOWUP_PROPOSAL_PROPOSED',
        resourceType: 'FollowUp',
        resourceId: row.id,
        metadata: {
          noteId,
          extractorVersion: FOLLOWUP_EXTRACTOR_VERSION,
          planHash,
          textLength: row.text.length,
        },
      });
    }

    return {
      ok: true,
      status: 'created',
      proposalCount: created.length,
      supersededCount: supersedeResult.count,
      planHash,
      extractorVersion: FOLLOWUP_EXTRACTOR_VERSION,
    };
  }
}

/**
 * Pull the Plan section's content from a draft note's `draftJson`. Returns
 * null when no section is labeled / matches /plan/i in the template's
 * sectionSchema, or when draftJson is empty.
 *
 * draftJson shape per src/lib/notes/section-status.ts:
 *   { [sectionId]: { content: string, updatedAt: ISO } }
 *
 * Template sectionSchema shape per src/lib/notes/build-prompt.ts:
 *   { sections: Array<{ id: string, label: string, required: boolean, ... }> }
 *
 * Exported for unit testing.
 */
export function extractPlanContentFromDraft(
  draftJson: Prisma.JsonValue | null,
  sectionSchemaJson: Prisma.JsonValue | null | undefined,
): string | null {
  if (!draftJson || typeof draftJson !== 'object' || Array.isArray(draftJson)) {
    return null;
  }
  if (!sectionSchemaJson || typeof sectionSchemaJson !== 'object' || Array.isArray(sectionSchemaJson)) {
    return null;
  }
  const sections = (sectionSchemaJson as { sections?: unknown }).sections;
  if (!Array.isArray(sections)) return null;
  const planDef = sections.find(
    (s): s is { id: string; label: string } =>
      !!s &&
      typeof (s as { id?: unknown }).id === 'string' &&
      typeof (s as { label?: unknown }).label === 'string' &&
      /plan/i.test((s as { label: string }).label),
  );
  if (!planDef) return null;
  const draftMap = draftJson as Record<string, unknown>;
  const planEntry = draftMap[planDef.id];
  if (!planEntry || typeof planEntry !== 'object' || Array.isArray(planEntry)) return null;
  const content = (planEntry as { content?: unknown }).content;
  if (typeof content !== 'string') return null;
  return content;
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
