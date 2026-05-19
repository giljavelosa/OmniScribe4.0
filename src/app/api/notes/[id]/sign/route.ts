import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, NoteStatus } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { verifyTotpToken } from '@/lib/mfa';
import {
  enqueueNoteBriefJob,
  enqueuePostSignArtifactJob,
} from '@/lib/queue';
import { readSectionStatus } from '@/lib/notes/section-status';
import { deriveProgressStrip, isReadyForSign } from '@/lib/notes/derive-progress-strip';
import type { NoteSectionDef } from '@/lib/notes/build-prompt';
import { randomBytes } from 'node:crypto';

export const runtime = 'nodejs';

const bodySchema = z.object({
  /** Legacy / fallback path. Omit if the signing PIN unlock window is active. */
  mfaToken: z.string().regex(/^\d{6}$/, 'Invalid MFA token').optional(),
  /** Set true by the client after the sign-time follow-up sweep modal has
   *  been resolved (Unit 06). Default false → sign refuses with 409
   *  open_followups_present + the open list if any are still OPEN. */
  sweepAcknowledged: z.boolean().optional(),
});

/**
 * POST /api/notes/[id]/sign — THE SOLE write path for Note.finalJson
 * (anti-regression rule 3).
 *
 * Transaction body:
 *   1. Re-verify the signing clinician's MFA TOTP. Sensitive action ⇒
 *      D2 says always-required (Unit 01); this endpoint enforces.
 *   2. Update Note.status = SIGNED + finalJson = canonical(draftJson) +
 *      signedAt + signedByUserId. finalJson is FROZEN here; no other
 *      code path writes it (grep enforces).
 *   3. Audit NOTE_SIGNED with PHI-free metadata (mfaReverified flag,
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
 *   - 401 mfa_required if user has no mfaSecret (shouldn't happen with
 *     D2 always-required, but defense)
 *   - 401 invalid_mfa if the TOTP doesn't verify
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
    include: { template: true },
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
    const openFollowUps = await prisma.followUp.findMany({
      where: { patientId: note.patientId, orgId: authorizationUser.orgId, status: 'OPEN' },
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

  // Sign-time authorization. Prefer the signing-PIN unlock window if active
  // (Pattern D — Epic-style), else fall back to per-sign TOTP reverify.
  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      mfaSecret: true,
      mfaEnabled: true,
      signingPinHash: true,
      signUnlockedUntil: true,
    },
  });
  if (!me?.mfaSecret || !me.mfaEnabled) {
    return NextResponse.json({ error: { code: 'mfa_required' } }, { status: 401 });
  }

  const unlockedNow =
    !!me.signingPinHash &&
    !!me.signUnlockedUntil &&
    me.signUnlockedUntil.getTime() > Date.now();

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
    // Fall back to TOTP. Required when: no PIN set yet, OR unlock window expired.
    if (!parsed.data.mfaToken) {
      return NextResponse.json(
        {
          error: {
            code: 'auth_required',
            message: me.signingPinHash
              ? 'Sign-unlock expired. Verify your signing PIN or provide a TOTP token.'
              : 'Provide a TOTP token (or set up a signing PIN to avoid this prompt).',
            pinAvailable: !!me.signingPinHash,
          },
        },
        { status: 401 },
      );
    }
    const mfaOk = await verifyTotpToken({ secret: me.mfaSecret, token: parsed.data.mfaToken });
    if (!mfaOk) {
      await writeAuditLog({
        userId: user.id,
        orgId: orgUser.orgId,
        action: 'MFA_VERIFY_FAILED',
        resourceType: 'Note',
        resourceId: noteId,
        metadata: { context: 'sign-note' },
      });
      return NextResponse.json({ error: { code: 'invalid_mfa' } }, { status: 401 });
    }
    await writeAuditLog({
      userId: user.id,
      orgId: orgUser.orgId,
      action: 'MFA_VERIFIED',
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
      mfaReverified: true,
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
