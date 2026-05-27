/**
 * Sprint 0.19 / Tier 14 — Internal team coordination.
 *
 *   GET  /api/patient-messages?direction=inbox|sent&patientId=&status=&limit=
 *   POST /api/patient-messages
 *
 * In-app delivery only — no off-platform delivery (push/email/SMS) in
 * this sprint. Recipient lands the message via the bell + the
 * patient-chart thread surface (deferred UI).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { writeAuditLog } from '@/lib/audit/log';
import { InternalMessageUrgency } from '@prisma/client';

export const runtime = 'nodejs';

const postSchema = z.object({
  patientId: z.string().min(1).max(64),
  recipientOrgUserId: z.string().min(1).max(64),
  topic: z.string().min(1).max(120),
  body: z.string().min(1).max(4000),
  urgency: z.nativeEnum(InternalMessageUrgency).optional(),
  contextHref: z.string().min(1).max(500).optional(),
  inReplyToId: z.string().min(1).max(64).optional(),
});

// ---------------- GET ------------------------------------------------

export async function GET(req: Request) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { authorizationUser } = guard;
  const url = new URL(req.url);
  const direction = url.searchParams.get('direction') === 'sent' ? 'sent' : 'inbox';
  const patientId = url.searchParams.get('patientId') ?? undefined;
  const statusParam = url.searchParams.get('status') ?? undefined;
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '25', 10) || 25, 1), 100);

  const rows = await prisma.internalPatientMessage.findMany({
    where: {
      orgId: authorizationUser.orgId,
      isDeleted: false,
      ...(direction === 'inbox'
        ? { recipientOrgUserId: authorizationUser.orgUserId }
        : { senderOrgUserId: authorizationUser.orgUserId }),
      ...(patientId ? { patientId } : {}),
      ...(statusParam === 'SENT' || statusParam === 'READ' || statusParam === 'ARCHIVED'
        ? { status: statusParam }
        : {}),
    },
    orderBy: { sentAt: 'desc' },
    take: limit,
    select: {
      id: true,
      topic: true,
      body: true,
      urgency: true,
      status: true,
      sentAt: true,
      readAt: true,
      contextHref: true,
      patientId: true,
      senderOrgUserId: true,
      recipientOrgUserId: true,
      patient: { select: { firstName: true, lastName: true } },
      sender: { select: { user: { select: { name: true, email: true } } } },
      recipient: { select: { user: { select: { name: true, email: true } } } },
    },
  });

  return NextResponse.json({
    data: {
      direction,
      messages: rows.map((m) => ({
        messageId: m.id,
        topic: m.topic,
        body: m.body,
        urgency: m.urgency,
        status: m.status,
        sentAt: m.sentAt.toISOString(),
        readAt: m.readAt?.toISOString() ?? null,
        contextHref: m.contextHref,
        patientId: m.patientId,
        patientDisplay: `${m.patient.firstName} ${m.patient.lastName[0]}.`,
        senderDisplay: m.sender.user.name ?? m.sender.user.email,
        recipientDisplay: m.recipient.user.name ?? m.recipient.user.email,
      })),
    },
  });
}

// ---------------- POST -----------------------------------------------

export async function POST(req: Request) {
  const guard = await requireFeatureAccess('NOTE_REVIEW', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;
  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'invalid_body', issues: err instanceof z.ZodError ? err.issues : undefined } },
      { status: 400 },
    );
  }

  // Validate patient + recipient are in the sender's org.
  const [patient, recipient] = await Promise.all([
    prisma.patient.findFirst({
      where: { id: body.patientId, orgId: authorizationUser.orgId },
      select: { id: true },
    }),
    prisma.orgUser.findFirst({
      where: { id: body.recipientOrgUserId, orgId: authorizationUser.orgId, isActive: true },
      select: { id: true },
    }),
  ]);
  if (!patient) return NextResponse.json({ error: { code: 'patient_not_found' } }, { status: 404 });
  if (!recipient) return NextResponse.json({ error: { code: 'recipient_not_found' } }, { status: 404 });
  if (recipient.id === authorizationUser.orgUserId) {
    return NextResponse.json({ error: { code: 'cannot_message_self' } }, { status: 400 });
  }

  // Optional reply-thread validation.
  if (body.inReplyToId) {
    const parent = await prisma.internalPatientMessage.findFirst({
      where: {
        id: body.inReplyToId,
        orgId: authorizationUser.orgId,
        patientId: body.patientId,
        isDeleted: false,
      },
      select: { id: true },
    });
    if (!parent) return NextResponse.json({ error: { code: 'reply_target_not_found' } }, { status: 404 });
  }

  // Optional same-origin contextHref validation.
  if (body.contextHref && !body.contextHref.startsWith('/')) {
    return NextResponse.json({ error: { code: 'contextHref_must_be_relative' } }, { status: 400 });
  }

  const row = await prisma.internalPatientMessage.create({
    data: {
      orgId: authorizationUser.orgId,
      patientId: body.patientId,
      senderOrgUserId: authorizationUser.orgUserId,
      recipientOrgUserId: body.recipientOrgUserId,
      topic: body.topic,
      body: body.body,
      urgency: body.urgency ?? 'NORMAL',
      contextHref: body.contextHref ?? null,
      inReplyToId: body.inReplyToId ?? null,
    },
    select: { id: true, sentAt: true },
  });

  await writeAuditLog({
    userId: user.id,
    orgId: authorizationUser.orgId,
    action: 'INTERNAL_PATIENT_MESSAGE_SENT',
    resourceType: 'InternalPatientMessage',
    resourceId: row.id,
    metadata: {
      messageId: row.id,
      recipientOrgUserId: body.recipientOrgUserId,
      urgency: body.urgency ?? 'NORMAL',
      topicLength: body.topic.length,
      bodyLength: body.body.length,
      inReplyToId: body.inReplyToId ?? null,
    },
  });

  return NextResponse.json(
    { data: { messageId: row.id, sentAt: row.sentAt.toISOString() } },
    { status: 201 },
  );
}
