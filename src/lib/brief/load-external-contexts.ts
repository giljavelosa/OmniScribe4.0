import { ExternalContextMediaKind, ExternalContextStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import type { BriefExternalContextProjection } from '@/lib/notes/build-brief-prompt';
import { buildVerifiedDocumentTranscript } from '@/lib/external-context/document-transcript';
import { ExtractionJsonSchema } from '@/types/external-context-extraction';

export const MAX_BRIEF_EXTERNAL_CONTEXTS = 5;

/**
 * Load up to `MAX_BRIEF_EXTERNAL_CONTEXTS` READY ExternalContext records for
 * the given patient with `dateOfRecord <= currentVisitStart`, most recent
 * first. Returns the projection the brief prompt builder expects.
 *
 * Spec: context/specs/external-context-upload.md §Brief integration.
 *
 * PENDING_TRANSCRIPTION + FAILED rows are excluded — the brief is meant to
 * surface attested-or-attested-by-proxy content, and a row whose transcript
 * is empty or in-flight has no signal value.
 *
 * `currentVisitStart` is the boundary of "what was knowable before this
 * visit". Defaults to now() so ad-hoc test callers see all rows.
 */
export async function loadExternalContextsForBrief(args: {
  patientId: string;
  orgId: string;
  currentVisitStart?: Date;
}): Promise<BriefExternalContextProjection[]> {
  const cutoff = args.currentVisitStart ?? new Date();
  const rows = await prisma.externalContext.findMany({
    where: {
      patientId: args.patientId,
      orgId: args.orgId,
      status: ExternalContextStatus.READY,
      deletedAt: null,
      OR: [
        { mediaKind: { not: ExternalContextMediaKind.DOCUMENT } },
        { verifiedAt: { not: null } },
      ],
      dateOfRecord: { lte: cutoff },
    },
    orderBy: { dateOfRecord: 'desc' },
    take: MAX_BRIEF_EXTERNAL_CONTEXTS,
    include: {
      addedBy: {
        select: {
          user: { select: { name: true, email: true } },
        },
      },
    },
  });

  return rows.map((r) => {
    const transcriptClean =
      r.mediaKind === ExternalContextMediaKind.DOCUMENT && r.vettedExtractionJson
        ? buildVerifiedDocumentTranscript(ExtractionJsonSchema.parse(r.vettedExtractionJson))
        : r.transcriptClean;
    return {
      externalContextId: r.id,
      dateOfRecordIso: r.dateOfRecord.toISOString(),
      source: r.source,
      sourceLabel: r.sourceLabel,
      addedByName: r.addedBy.user.name ?? r.addedBy.user.email,
      transcriptClean,
    };
  });
}
