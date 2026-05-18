import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireFeatureAccess } from '@/lib/authz/server';
import { canActAtSite, getClinicianSiteIds } from '@/lib/authz/site-scope';
import { writeAuditLog } from '@/lib/audit/log';
import { startVisit, type PickerSource } from '@/lib/encounters/start';

export const runtime = 'nodejs';

const bodySchema = z
  .object({
    /** Optional override — when the schedule has no pre-linked episode AND
     * the patient has 2+ active episodes, the client picker asks the
     * clinician to choose and POSTs the choice here. When omitted, the
     * route falls back to schedule.episodeOfCareId (if present) or lets
     * startVisit's auto-link behavior take over. */
    episodeOfCareId: z.string().min(1).nullable().optional(),
    /** Records where the episode choice originated. See PickerSource. */
    pickerSource: z
      .enum(['picker', 'auto-single', 'auto-none', 'manual-skip', 'inherited-schedule'])
      .optional(),
  })
  .optional();

/**
 * Transition a SCHEDULED schedule to IN_PROGRESS, create the Encounter, mint
 * the Note (status PREPARING), and return the noteId so the client can route
 * to /prepare/[noteId]. Note.division is locked at this moment per spec §E.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeatureAccess('VISITS_CREATE', req);
  if ('error' in guard) return guard.error;
  const { user, authorizationUser } = guard;

  const { id } = await params;
  // Body is optional — most start clicks have no body at all. We always try
  // to parse so the route works whether the client sends JSON, an empty body,
  // or no Content-Type header. Bad JSON → treated as no body. Bad SHAPE (the
  // schema rejects) → 400.
  let bodyParsed: { episodeOfCareId?: string | null; pickerSource?: PickerSource } = {};
  const text = await req.text().catch(() => '');
  if (text.length > 0) {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = undefined;
    }
    if (raw !== undefined) {
      const parsed = bodySchema.safeParse(raw);
      if (!parsed.success) {
        return NextResponse.json({ error: { code: 'bad_request' } }, { status: 400 });
      }
      bodyParsed = parsed.data ?? {};
    }
  }

  const schedule = await prisma.schedule.findFirst({
    where: { id, orgId: authorizationUser.orgId },
  });
  if (!schedule) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  // Multi-site enrollment guard — the schedule.siteId must be in the caller's
  // scope. Org-wide roles bypass via scope 'all'. Cross-coverage exception is
  // hard-blocked in v1 per spec; warn-and-proceed lands when the per-org
  // policy toggle ships.
  const siteScope = await getClinicianSiteIds(
    authorizationUser.orgUserId,
    authorizationUser.orgId,
  );
  if (!canActAtSite(siteScope, schedule.siteId)) {
    return NextResponse.json(
      {
        error: {
          code: 'site_not_enrolled',
          message:
            'You are not enrolled at this site. Ask your admin to add you on the Team members page.',
        },
      },
      { status: 400 },
    );
  }

  // Decide which episode the encounter should link to:
  //   1. Explicit body param wins (clinician used the picker, or chose skip).
  //   2. Else the schedule's pre-linked episode (set at scheduling time).
  //   3. Else null — startVisit will auto-link if the patient has exactly 1
  //      active episode.
  let episodeOfCareIdToUse: string | undefined;
  let pickerSource: PickerSource | undefined = bodyParsed.pickerSource;
  if (Object.prototype.hasOwnProperty.call(bodyParsed, 'episodeOfCareId')) {
    // Body explicitly set (including null = "skip").
    episodeOfCareIdToUse = bodyParsed.episodeOfCareId ?? undefined;
  } else if (schedule.episodeOfCareId) {
    episodeOfCareIdToUse = schedule.episodeOfCareId;
    pickerSource = pickerSource ?? 'inherited-schedule';
  }

  // Run the idempotency check + visit creation in a single tx so two concurrent
  // requests cannot both pass the check and trip the Encounter.scheduleId unique
  // constraint. On constraint violation, fall back to returning the existing row.
  let result: { encounter: { id: string }; note: { id: string }; reused: boolean };
  try {
    result = await prisma.$transaction(async (tx) => {
      const existing = await tx.encounter.findUnique({
        where: { scheduleId: schedule.id },
      });
      if (existing) {
        const existingNote = await tx.note.findFirst({
          where: { encounterId: existing.id },
          orderBy: { createdAt: 'asc' },
        });
        if (existingNote) {
          return { encounter: existing, note: existingNote, reused: true };
        }
      }
      const created = await startVisit({
        tx,
        orgId: schedule.orgId,
        patientId: schedule.patientId,
        clinicianOrgUserId: schedule.clinicianOrgUserId,
        siteId: schedule.siteId,
        roomId: schedule.roomId,
        scheduleId: schedule.id,
        actingUserId: user.id,
        episodeOfCareId: episodeOfCareIdToUse,
        pickerSource,
      });
      return { ...created, reused: false };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.encounter.findUnique({ where: { scheduleId: schedule.id } });
      const existingNote = existing
        ? await prisma.note.findFirst({ where: { encounterId: existing.id }, orderBy: { createdAt: 'asc' } })
        : null;
      if (existing && existingNote) {
        return NextResponse.json({ data: { noteId: existingNote.id, encounterId: existing.id } });
      }
    }
    throw err;
  }

  if (!result.reused) {
    await writeAuditLog({
      userId: user.id,
      orgId: authorizationUser.orgId,
      action: 'SCHEDULE_STARTED',
      resourceType: 'Schedule',
      resourceId: schedule.id,
      metadata: { encounterId: result.encounter.id, noteId: result.note.id },
    });
  }

  return NextResponse.json({ data: { noteId: result.note.id, encounterId: result.encounter.id } });
}
