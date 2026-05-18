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
  mfaToken: z.string().regex(/^\d{6}$/, 'Invalid MFA token'),
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
 *   - 403 forbidden if user isn't the assigned clinician (or SUPER_ADMIN
 *     for incident response)
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('NOTE_SIGN');
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
    authorizationUser.role !== 'SUPER_ADMIN'
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

  // MFA re-verify
  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: { mfaSecret: true, mfaEnabled: true },
  });
  if (!me?.mfaSecret || !me.mfaEnabled) {
    return NextResponse.json({ error: { code: 'mfa_required' } }, { status: 401 });
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
    },
  });

  // Post-sign enqueues — outside the transaction so a Redis hiccup doesn't
  // roll back the signed note.
  await enqueueNoteBriefJob({ noteId, orgId: orgUser.orgId });
  await writeAuditLog({
    userId: user.id,
    orgId: orgUser.orgId,
    action: 'NOTE_BRIEF_ENQUEUED',
    resourceType: 'Note',
    resourceId: noteId,
  });

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

  if (hasReferralHint(finalCanonical)) {
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
