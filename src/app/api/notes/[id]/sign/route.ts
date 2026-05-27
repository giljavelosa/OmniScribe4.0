import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, NoteStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import bcrypt from 'bcryptjs';
import {
  enqueueCleoStateRefresh,
  enqueueNoteBriefJob,
  enqueuePostSignArtifactJob,
} from '@/lib/queue';
import { readSectionStatus } from '@/lib/notes/section-status';
import { deriveProgressStrip, isReadyForSign } from '@/lib/notes/derive-progress-strip';
import {
  computeSectionHashes,
  diffSectionHashes,
  isFlagAnalysisPending,
  parseSectionHashes,
} from '@/lib/notes/flag-analysis-state';
import type { NoteSectionDef } from '@/lib/notes/build-prompt';
import { randomBytes } from 'node:crypto';

export const runtime = 'nodejs';

const bodySchema = z.object({
  /** Required when the signing-PIN unlock window is not active. */
  signPin: z.string().regex(/^\d{4}$/, 'Invalid signing PIN').optional(),
  /** Set true by the client after the sign-time follow-up sweep modal has
   *  been resolved (Unit 06). Default false → sign refuses with 409
   *  open_followups_present + the open list if any are still OPEN. */
  sweepAcknowledged: z.boolean().optional(),
  /** Sprint 0 lockdown — set true by the client when the clinician has
   *  ticked the inline attestation ("I've reviewed my edits since the
   *  last AI analysis and accept them without re-analysis"). Required
   *  when section-content hashes differ from the post-analysis snapshot
   *  AND the clinician chose Sign rather than Re-analyze. The route
   *  refuses 409 edited_since_analysis_unattested otherwise. Audited
   *  via NOTE_SIGNED_WITH_EDITED_SINCE_ANALYSIS_ATTESTATION. */
  editedSinceAnalysisAttested: z.boolean().optional(),
});

/**
 * POST /api/notes/[id]/sign — THE SOLE write path for Note.finalJson
 * (anti-regression rule 3).
 *
 * Transaction body:
 *   1. Re-verify the signing clinician's PIN (or honor an active unlock window).
 *   2. Update Note.status = SIGNED + finalJson = canonical(draftJson) +
 *      signedAt + signedByUserId. finalJson is FROZEN here; no other
 *      code path writes it (grep enforces).
 *   3. Audit NOTE_SIGNED with PHI-free metadata (pinReverified flag,
 *      sectionCount).
 *
 * After commit (NOT in the tx — these enqueue Redis jobs):
 *   4. enqueueNoteBriefJob → Unit 06 BriefGenerator precomputes the next
 *      visit's prior-context brief (stub today).
 *   5. enqueuePostSignArtifactJob for PATIENT_INSTRUCTIONS (Unit 05 Commit 9
 *      implements). REFERRAL_LETTER is enqueued only when at least one
 *      section's content hints at a referral (heuristic: contains "refer").
 *
 * Refuses:
 *   - 409 already_signed if note.status === SIGNED
 *   - 409 not_ready if any required section is not populated/edited
 *   - 401 pin_required if no signing PIN is configured
 *   - 401 invalid_pin if the PIN doesn't verify
 *   - 403 forbidden if user isn't the assigned clinician (or ORG_ADMIN
 *     for incident response)
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_SIGN', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser, orgUser } = guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
  }

  const { id: noteId } = await params;
  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId: authorizationUser.orgId },
    include: {
      template: true,
      // Sprint 0.13 Decision 3 — routing must resolve before sign.
      // Pulled here so the PENDING_ROUTER preflight (below) doesn't
      // need a second round-trip.
      encounter: { select: { caseManagement: { select: { status: true } } } },
    },
  });
  if (!note) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  if (
    note.clinicianOrgUserId !== authorizationUser.orgUserId &&
    authorizationUser.role !== 'ORG_ADMIN'
  ) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }
  if (note.status === NoteStatus.SIGNED || note.status === NoteStatus.TRANSFERRED) {
    return NextResponse.json({ error: { code: 'already_signed' } }, { status: 409 });
  }
  // Sprint 0.13 Decision 3 — hard sign-block on PENDING_ROUTER cases.
  // Companion to the existing soft-nudge in review-client.tsx. The Cleo
  // fallback bug (fixed 2026-05-23) was the chief source of pre-block
  // PENDING_ROUTER signs; prior stuck rows are recoverable via the
  // narrow accept-endpoint path below + the admin backfill sweep at
  // /api/admin/case-management/backfill-stuck-router.
  if (note.encounter?.caseManagement?.status === 'PENDING_ROUTER') {
    return NextResponse.json(
      {
        error: {
          code: 'pending_router',
          message: 'Accept this visit\'s case routing before signing.',
        },
      },
      { status: 409 },
    );
  }

  // Flag-analysis race protection (regression fix 2026-05-25).
  // Block 1 — pending analysis: refuse if a flag-analysis run is in
  // flight. Without this, a clinician who clicks "Analyze for flags"
  // and immediately navigates to /sign can sign before the worker
  // finishes; flags then surface on an already-SIGNED note (rule 3
  // violation). The worker stamps `flagAnalysisCompletedAt` in a
  // finally block, and the helper applies a 10-minute stale-pending
  // window so a dead worker can't permanently block sign.
  if (
    isFlagAnalysisPending({
      flagAnalysisStartedAt: note.flagAnalysisStartedAt,
      flagAnalysisCompletedAt: note.flagAnalysisCompletedAt,
    })
  ) {
    return NextResponse.json(
      {
        error: {
          code: 'flag_analysis_pending',
          message:
            'AI is still analyzing this note for compliance flags. Wait a few seconds, then try again.',
        },
      },
      { status: 409 },
    );
  }

  // Block 2 — open RED flags: per spec ("RED contradicts the transcript
  // and must be resolved before sign"), refuse if any RED flag is still
  // OPEN. RESOLVED + DISMISSED flags don't block — the clinician has
  // already attested to the resolution. BLUE/YELLOW are clinician
  // judgment calls and are advisory only.
  const openRedCount = await prisma.reviewFlag.count({
    where: { noteId, severity: 'RED', status: 'OPEN' },
  });
  if (openRedCount > 0) {
    return NextResponse.json(
      {
        error: {
          code: 'open_red_flags',
          message: `Resolve ${openRedCount} RED flag${openRedCount === 1 ? '' : 's'} before signing.`,
        },
        data: { openRedCount },
      },
      { status: 409 },
    );
  }

  // Readiness check
  const sections =
    (note.template?.sectionSchema as { sections: NoteSectionDef[] } | null)?.sections ?? [];
  const sectionStatus = readSectionStatus(note.inferenceLog);
  const progress = deriveProgressStrip(sections, sectionStatus);
  if (!isReadyForSign(progress)) {
    return NextResponse.json(
      { error: { code: 'not_ready', message: 'Required sections still need attention.' } },
      { status: 409 },
    );
  }

  // Open-follow-ups preflight — sign-time sweep (Unit 06 spec §I). If any
  // FollowUp for this patient is still OPEN and the client hasn't sent
  // sweepAcknowledged=true, we refuse with 409 + the open list. The client
  // opens SignFollowUpSweep, resolves each one (Met / Drop / Carry), then
  // re-tries this POST with sweepAcknowledged=true.
  if (!parsed.data.sweepAcknowledged) {
    // Exclude rows whose originNoteId === THIS note. Those rows are commitments
    // the clinician pre-staged on /review for the NEXT visit; they should not
    // be force-closed at the sign of the visit that CREATES them. The sweep is
    // for inherited OPEN rows from prior visits.
    const openFollowUps = await prisma.followUp.findMany({
      where: {
        patientId: note.patientId,
        orgId: authorizationUser.orgId,
        status: 'OPEN',
        originNoteId: { not: noteId },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { originNote: { select: { signedAt: true } } },
    });
    if (openFollowUps.length > 0) {
      await writeAuditLog({
        userId: user.id,
        orgId: orgUser.orgId,
        action: 'FOLLOWUP_SWEEP_OPENED',
        resourceType: 'Note',
        resourceId: noteId,
        metadata: { openCount: openFollowUps.length },
      });
      return NextResponse.json(
        {
          error: {
            code: 'open_followups_present',
            message: `${openFollowUps.length} follow-up${openFollowUps.length === 1 ? '' : 's'} still open — resolve before signing.`,
          },
          data: {
            openFollowUps: openFollowUps.map((fu) => ({
              id: fu.id,
              text: fu.text,
              status: fu.status,
              createdAt: fu.createdAt.toISOString(),
              source: {
                noteId: fu.originNoteId,
                date: (fu.originNote?.signedAt ?? fu.createdAt).toISOString().slice(0, 10),
              },
            })),
          },
        },
        { status: 409 },
      );
    }
  }

  // Sprint 0 flag-analysis lockdown — edited-since-analysis attestation.
  // The analyzer stamped a hash snapshot of every section's content at
  // the end of its last successful run. If the current draft hashes
  // differ AND the clinician has not ticked the attestation checkbox,
  // refuse with 409 + the edited section ids so the sign client can
  // surface the attestation UI inline. The attestation is independent
  // of the open-RED gate (which fired earlier) — it's about "did you
  // change anything after the last AI pass?", not "is anything
  // unresolved?". When `flagAnalysisSectionHashes` is null (pre-deploy
  // notes that never carried a baseline), this gate is a no-op.
  const sectionsForHashCheck =
    (note.template?.sectionSchema as { sections: NoteSectionDef[] } | null)?.sections ?? [];
  const priorHashes = parseSectionHashes(note.flagAnalysisSectionHashes);
  if (priorHashes && sectionsForHashCheck.length > 0) {
    const currentHashes = computeSectionHashes(
      note.draftJson as Record<string, { content?: string | null }> | null,
      sectionsForHashCheck.map((s) => s.id),
    );
    const diff = diffSectionHashes(priorHashes, currentHashes);
    if (diff.edited && !parsed.data.editedSinceAnalysisAttested) {
      return NextResponse.json(
        {
          error: {
            code: 'edited_since_analysis_unattested',
            message:
              "You've edited the note since the last AI analysis. Re-analyze for flags or confirm you've reviewed your edits.",
          },
          data: {
            editedSectionIds: diff.editedSectionIds,
            lastAnalysisCompletedAt: note.flagAnalysisCompletedAt?.toISOString() ?? null,
          },
        },
        { status: 409 },
      );
    }
    if (diff.edited && parsed.data.editedSinceAnalysisAttested) {
      // Audited BEFORE the transaction so a sign that throws still
      // leaves the attestation event on the record (the clinician
      // DID attest, even if the sign itself didn't land).
      await writeAuditLog({
        userId: user.id,
        orgId: orgUser.orgId,
        action: 'NOTE_SIGNED_WITH_EDITED_SINCE_ANALYSIS_ATTESTATION',
        resourceType: 'Note',
        resourceId: noteId,
        metadata: {
          editedSectionIds: diff.editedSectionIds,
          lastAnalysisCompletedAt: note.flagAnalysisCompletedAt?.toISOString() ?? null,
          flagAnalysisRunCount: note.flagAnalysisRunCount,
        },
      });
    }
    // If the clinician sent `editedSinceAnalysisAttested: true` without
    // actual edits (no diff), we silently ignore the flag — no audit
    // row, no surface change. Avoids cluttering the audit lens with
    // attestations that didn't gate anything.
  }

  // Sign-time authorization. Prefer the signing-PIN unlock window if active.
  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      signingPinHash: true,
      signUnlockedUntil: true,
    },
  });
  if (!me?.signingPinHash) {
    return NextResponse.json({ error: { code: 'pin_not_set' } }, { status: 401 });
  }

  const unlockedNow =
    !!me.signUnlockedUntil && me.signUnlockedUntil.getTime() > Date.now();

  if (unlockedNow) {
    await writeAuditLog({
      userId: user.id,
      orgId: orgUser.orgId,
      action: 'SIGNING_PIN_UNLOCK_HONORED',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: {
        context: 'sign-note',
        unlockedUntil: me.signUnlockedUntil!.toISOString(),
      },
    });
  } else {
    if (!parsed.data.signPin) {
      return NextResponse.json(
        {
          error: {
            code: 'auth_required',
            message: 'Sign-unlock expired. Enter your 4-digit signing PIN.',
            pinAvailable: true,
          },
        },
        { status: 401 },
      );
    }
    const pinOk = await bcrypt.compare(parsed.data.signPin, me.signingPinHash);
    if (!pinOk) {
      await writeAuditLog({
        userId: user.id,
        orgId: orgUser.orgId,
        action: 'SIGNING_PIN_VERIFY_FAILED',
        resourceType: 'Note',
        resourceId: noteId,
        metadata: { context: 'sign-note' },
      });
      return NextResponse.json({ error: { code: 'invalid_pin' } }, { status: 401 });
    }
    await writeAuditLog({
      userId: user.id,
      orgId: orgUser.orgId,
      action: 'SIGNING_PIN_VERIFIED',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: { context: 'sign-note' },
    });
  }

  // The transaction — THE ONLY place finalJson is written. Mint `now` first
  // and pass it into canonicalize so finalJson.signedAt == Note.signedAt
  // (otherwise the two persisted artifacts of the same sign event differ).
  const draft = (note.draftJson as Record<string, { content: string; updatedAt: string }> | null) ?? {};
  const now = new Date();
  const finalCanonical = canonicalize(draft, sections, now);

  await prisma.$transaction(async (tx) => {
    await tx.note.update({
      where: { id: noteId },
      data: {
        status: NoteStatus.SIGNED,
        finalJson: finalCanonical as unknown as Prisma.InputJsonValue,
        signedAt: now,
        signedByUserId: user.id,
      },
    });
    // Follow-up sweep closes here in Unit 06 — placeholder for now.
  });

  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'NOTE_SIGNED',
    resourceType: 'Note',
    resourceId: noteId,
    metadata: {
      pinReverified: !unlockedNow,
      sectionCount: sections.length,
      signedAt: now.toISOString(),
      sweepAcknowledged: !!parsed.data.sweepAcknowledged,
      // Late-entry charting (spec: context/specs/late-entry-charting.md).
      // Extending existing metadata — no new audit action. A reviewer can
      // prove the late-entry attestation copy switch fired without joining
      // tables.
      isLateEntry: note.isLateEntry,
      lateEntryDaysGap: note.lateEntryDaysGap,
      dateOfService: note.dateOfService.toISOString(),
    },
  });

  if (parsed.data.sweepAcknowledged) {
    await writeAuditLog({
      userId: user.id,
      orgId: orgUser.orgId,
      action: 'FOLLOWUP_SWEEP_RESOLVED',
      resourceType: 'Note',
      resourceId: noteId,
    });
  }

  // Visit-counter hook (Unit 11). If the note's encounter has an episode,
  // increment EpisodeOfCare.visitsCompleted. The signing transaction has
  // already committed; this happens outside it so a counter failure doesn't
  // roll back the sign. We use `increment` so the write is atomic at the
  // DB level (no read-modify-write race if two notes for the same episode
  // sign in close succession — rare but possible).
  if (note.encounterId) {
    try {
      const encounter = await prisma.encounter.findUnique({
        where: { id: note.encounterId },
        select: { episodeOfCareId: true },
      });
      const episodeId = encounter?.episodeOfCareId ?? null;
      if (episodeId) {
        const updated = await prisma.episodeOfCare.update({
          where: { id: episodeId },
          data: { visitsCompleted: { increment: 1 } },
          select: { visitsCompleted: true, visitsAuthorized: true },
        });
        await writeAuditLog({
          userId: user.id,
          orgId: orgUser.orgId,
          action: 'EPISODE_VISIT_COUNT_INCREMENTED',
          resourceType: 'EpisodeOfCare',
          resourceId: episodeId,
          metadata: {
            noteId,
            visitsCompleted: updated.visitsCompleted,
            visitsAuthorized: updated.visitsAuthorized,
          },
        });
      }
    } catch (err) {
      // Counter failure is non-fatal — the sign already committed. Log + move on.
      console.warn('[sign] visit-counter increment failed:', err);
    }
  }

  // Post-sign enqueues — outside the transaction so a Redis hiccup doesn't
  // roll back the signed note. Wrapped in try/catch so a BullMQ jobId
  // validation error (or transient Redis outage) doesn't 500 the sign
  // request; the note is already SIGNED at this point and the artifacts
  // can be re-triggered later.
  try {
    await enqueueNoteBriefJob({ noteId, orgId: orgUser.orgId });
    await writeAuditLog({
      userId: user.id,
      orgId: orgUser.orgId,
      action: 'NOTE_BRIEF_ENQUEUED',
      resourceType: 'Note',
      resourceId: noteId,
    });
  } catch (e) {
    console.warn('[sign] note-brief enqueue failed (note already signed):', e instanceof Error ? e.message : e);
  }

  try {
    const patientInstructionsReqId = randomBytes(8).toString('hex');
    await enqueuePostSignArtifactJob({
      noteId,
      orgId: orgUser.orgId,
      type: 'generate-patient-instructions',
      requestId: patientInstructionsReqId,
    });
    await writeAuditLog({
      userId: user.id,
      orgId: orgUser.orgId,
      action: 'POST_SIGN_ARTIFACT_ENQUEUED',
      resourceType: 'Note',
      resourceId: noteId,
      metadata: { kind: 'PATIENT_INSTRUCTIONS', requestId: patientInstructionsReqId },
    });
  } catch (e) {
    console.warn('[sign] patient-instructions enqueue failed (note already signed):', e instanceof Error ? e.message : e);
  }

  if (hasReferralHint(finalCanonical)) {
    try {
      const referralReqId = randomBytes(8).toString('hex');
      await enqueuePostSignArtifactJob({
        noteId,
        orgId: orgUser.orgId,
        type: 'generate-referral-letter',
        requestId: referralReqId,
      });
      await writeAuditLog({
        userId: user.id,
        orgId: orgUser.orgId,
        action: 'POST_SIGN_ARTIFACT_ENQUEUED',
        resourceType: 'Note',
        resourceId: noteId,
        metadata: { kind: 'REFERRAL_LETTER', requestId: referralReqId },
      });
    } catch (e) {
      console.warn('[sign] referral-letter enqueue failed (note already signed):', e instanceof Error ? e.message : e);
    }
  }

  // Sprint 0.14 — chain-enqueue cleo-state refresh for (a) the signing
  // clinician AND (b) every other clinician who already has a
  // CopilotPatientState row on this patient. Both groups need to learn
  // from the new signed note. Throttled per-tuple (5-min bucket) at the
  // queue layer so a burst of signs collapses to one rebuild per
  // (patient × clinician). Wrapped to keep Redis hiccups from 500ing
  // the sign (the note already committed; the worker can replay).
  try {
    const signerOrgUserId = note.clinicianOrgUserId;
    const peers = await prisma.copilotPatientState.findMany({
      where: { orgId: orgUser.orgId, patientId: note.patientId },
      select: { clinicianOrgUserId: true },
    });
    const targets = new Set<string>([signerOrgUserId]);
    for (const p of peers) targets.add(p.clinicianOrgUserId);
    for (const clinicianOrgUserId of targets) {
      await enqueueCleoStateRefresh({
        orgId: orgUser.orgId,
        patientId: note.patientId,
        clinicianOrgUserId,
      });
    }
  } catch (e) {
    console.warn('[sign] cleo-state refresh enqueue failed:', e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ data: { ok: true, signedAt: now.toISOString() } });
}

type FinalSection = { id: string; label: string; content: string; required: boolean };
type FinalJson = {
  sections: FinalSection[];
  signedAt: string;
  schemaVersion: 1;
};

/**
 * Canonicalize draft into the frozen finalJson shape. Section order = template
 * order. Missing optional sections drop out. Whitespace trimmed. The result
 * is the ONLY representation that goes into Note.finalJson — anything that
 * needs to render or audit a signed note reads it from here.
 */
function canonicalize(
  draft: Record<string, { content: string; updatedAt: string }>,
  sections: NoteSectionDef[],
  signedAt: Date,
): FinalJson {
  const finalSections: FinalSection[] = [];
  for (const s of sections) {
    const content = (draft[s.id]?.content ?? '').trim();
    if (!content && !s.required) continue;
    finalSections.push({
      id: s.id,
      label: s.label,
      content,
      required: !!s.required,
    });
  }
  return {
    sections: finalSections,
    signedAt: signedAt.toISOString(),
    schemaVersion: 1,
  };
}

/**
 * Cheap heuristic: scan content for the word "refer". The real signal in
 * future units could be a structured Plan-section field; for Unit 05 we
 * keep it conservative + safe (false-positives just generate an unused
 * letter; false-negatives mean the clinician fires the letter manually).
 */
function hasReferralHint(finalJson: FinalJson): boolean {
  return finalJson.sections.some((s) => /\brefer\w*/i.test(s.content));
}
