import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { isStripeConfigured } from '@/lib/stripe/env';

/**
 * Seat enforcement for note creation.
 *
 * A clinician needs an active, assigned seat to start a visit — UNLESS they
 * are an org admin (admins always have full clinical access and never consume
 * a seat, consistent with the assignment route refusing to seat them).
 *
 * The gate is INERT when Stripe is not configured: seat licensing is part of
 * the Stripe billing feature, so a deployment without billing keys (dev, or a
 * self-hosted deploy not using OmniScribe billing) has no subscriptions, no
 * seats, and is never gated.
 */

export type SeatGateResult = { ok: true } | { ok: false; reason: 'no_seat' | 'no_org_user' };

export async function checkClinicianSeat(
  clinicianOrgUserId: string,
): Promise<SeatGateResult> {
  if (!isStripeConfigured()) return { ok: true };

  const orgUser = await prisma.orgUser.findUnique({
    where: { id: clinicianOrgUserId },
    select: {
      role: true,
      seat: { select: { isActive: true, expiresAt: true } },
    },
  });
  if (!orgUser) return { ok: false, reason: 'no_org_user' };

  // Org admins have full clinical access without holding a seat.
  if (orgUser.role === 'ORG_ADMIN') return { ok: true };

  const seat = orgUser.seat;
  const hasActiveSeat =
    !!seat && seat.isActive && seat.expiresAt.getTime() > Date.now();
  return hasActiveSeat ? { ok: true } : { ok: false, reason: 'no_seat' };
}

/** The shared 403 returned by every note-creation route when the seat gate fails. */
export function seatRequiredResponse(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'no_seat_assigned',
        message:
          'The clinician for this visit needs an assigned seat. Ask your org admin to assign one on the Seats page.',
      },
    },
    { status: 403 },
  );
}
