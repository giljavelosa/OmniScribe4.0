/**
 * Usage rollup compute — Unit 32.
 *
 * Per-org daily counts (notes signed, transcription minutes, copilot
 * asks, drafts accepted) computed on-demand. Cached in OrgUsageDaily
 * with a 60-minute freshness window; stale buckets recompute
 * synchronously before the route returns.
 *
 * Hard 30-day window keeps cold-cache compute bounded. Bucket boundary
 * = UTC midnight (no per-tz handling in v1 — customer success doesn't
 * need it).
 *
 * Promotes to a BullMQ background job once the owner usage page
 * becomes hot. v1 ships on-demand to avoid the operational overhead.
 */

import { prisma } from '@/lib/prisma';

/** Freshness window — a cached row older than this triggers a recompute. */
export const USAGE_CACHE_TTL_MS = 60 * 60 * 1000; // 60 min

/** Hard cap on the request window. Bounds worst-case cold-cache compute
 *  at 30 days × 4 queries = 120 queries on a single page load. */
export const USAGE_MAX_WINDOW_DAYS = 30;

export type DailyUsage = {
  day: string; // YYYY-MM-DD (UTC bucket)
  notesSigned: number;
  transcriptionMinutes: number;
  copilotAsks: number;
  draftsAccepted: number;
};

/** Returns the UTC midnight of `date`. */
function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Format a Date as YYYY-MM-DD in UTC. */
function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Generate the N most recent UTC-day buckets, sorted ASC (oldest first). */
function generateDayBuckets(now: Date, days: number): Date[] {
  const today = startOfUtcDay(now);
  const out: Date[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(new Date(today.getTime() - i * 24 * 60 * 60 * 1000));
  }
  return out;
}

type RawCounts = {
  notesSigned: number;
  transcriptionMinutes: number;
  copilotAsks: number;
  draftsAccepted: number;
};

/**
 * Aggregate the four metrics for a single org × day bucket.
 *
 * Notes signed = count of Note rows with status SIGNED + signedAt in
 * window. Transcription minutes = sum of AudioSegment.durationMs for
 * segments belonging to those signed notes (rounded down to integer
 * minutes). Copilot asks + drafts accepted pull from the AuditLog
 * action stream.
 *
 * Transcription compute is a two-step (fetch note ids, then aggregate
 * segments) because AudioSegment has no orgId of its own — relation
 * traversal would force a `note.is.orgId` filter which Prisma can do
 * but the explicit two-step is simpler to reason about + matches the
 * query plan we'd get anyway.
 */
async function computeOneBucket(orgId: string, dayStart: Date): Promise<RawCounts> {
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const [signedNotes, copilotAsks, draftsAccepted] = await Promise.all([
    prisma.note.findMany({
      where: {
        orgId,
        status: 'SIGNED',
        signedAt: { gte: dayStart, lt: dayEnd },
      },
      select: { id: true },
    }),
    prisma.auditLog.count({
      where: {
        orgId,
        action: 'COPILOT_ASK_QUERY',
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    }),
    prisma.auditLog.count({
      where: {
        orgId,
        action: 'COPILOT_DRAFT_CONFIRMED',
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    }),
  ]);

  let transcriptionMs = 0;
  if (signedNotes.length > 0) {
    const noteIds = signedNotes.map((n) => n.id);
    const durationAgg = await prisma.audioSegment.aggregate({
      where: { noteId: { in: noteIds }, isDeleted: false },
      _sum: { durationMs: true },
    });
    transcriptionMs = durationAgg._sum.durationMs ?? 0;
  }

  return {
    notesSigned: signedNotes.length,
    transcriptionMinutes: Math.floor(transcriptionMs / 60_000),
    copilotAsks,
    draftsAccepted,
  };
}

/**
 * Compute (with cache) the per-day usage rollup for an org over the
 * last `windowDays` UTC-day buckets.
 *
 * Returns rows sorted ASC (oldest first). Always returns exactly
 * `windowDays` entries — buckets with no activity render as zeros.
 *
 * Cache strategy:
 *   - Fetch all OrgUsageDaily rows for the org × range.
 *   - For each expected bucket where the row is missing OR
 *     `computedAt > USAGE_CACHE_TTL_MS ago`, recompute synchronously
 *     and upsert.
 *   - Return the merged result.
 */
export async function computeOrgUsage(
  orgId: string,
  windowDays: number = USAGE_MAX_WINDOW_DAYS,
  now: Date = new Date(),
): Promise<DailyUsage[]> {
  const days = Math.min(Math.max(windowDays, 1), USAGE_MAX_WINDOW_DAYS);
  const buckets = generateDayBuckets(now, days);
  const oldest = buckets[0]!;
  const newest = buckets[buckets.length - 1]!;
  const cacheCutoff = new Date(now.getTime() - USAGE_CACHE_TTL_MS);

  const existingRows = await prisma.orgUsageDaily.findMany({
    where: {
      orgId,
      day: { gte: oldest, lte: newest },
    },
  });
  const byDay = new Map(
    existingRows.map((row) => [row.day.getTime(), row]),
  );

  // Identify stale or missing buckets that need recompute.
  const toCompute = buckets.filter((dayStart) => {
    const row = byDay.get(dayStart.getTime());
    if (!row) return true;
    return row.computedAt < cacheCutoff;
  });

  // Compute + upsert each stale bucket. Sequential rather than
  // parallel — the underlying queries are cheap and parallelizing all
  // 30 days × 4 queries against a single connection pool wastes
  // capacity for marginal latency win on a low-frequency endpoint.
  for (const dayStart of toCompute) {
    const counts = await computeOneBucket(orgId, dayStart);
    await prisma.orgUsageDaily.upsert({
      where: { orgId_day: { orgId, day: dayStart } },
      create: {
        orgId,
        day: dayStart,
        notesSigned: counts.notesSigned,
        transcriptionMinutes: counts.transcriptionMinutes,
        copilotAsks: counts.copilotAsks,
        draftsAccepted: counts.draftsAccepted,
        computedAt: now,
        computedAtSourceCount:
          counts.notesSigned + counts.copilotAsks + counts.draftsAccepted,
      },
      update: {
        notesSigned: counts.notesSigned,
        transcriptionMinutes: counts.transcriptionMinutes,
        copilotAsks: counts.copilotAsks,
        draftsAccepted: counts.draftsAccepted,
        computedAt: now,
        computedAtSourceCount:
          counts.notesSigned + counts.copilotAsks + counts.draftsAccepted,
      },
    });
  }

  // Re-read so the returned array reflects the post-compute state.
  const finalRows = await prisma.orgUsageDaily.findMany({
    where: { orgId, day: { gte: oldest, lte: newest } },
    orderBy: { day: 'asc' },
  });
  const finalByDay = new Map(finalRows.map((r) => [r.day.getTime(), r]));

  return buckets.map((dayStart) => {
    const row = finalByDay.get(dayStart.getTime());
    return {
      day: toIsoDay(dayStart),
      notesSigned: row?.notesSigned ?? 0,
      transcriptionMinutes: row?.transcriptionMinutes ?? 0,
      copilotAsks: row?.copilotAsks ?? 0,
      draftsAccepted: row?.draftsAccepted ?? 0,
    };
  });
}
