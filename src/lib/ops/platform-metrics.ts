/**
 * Platform-wide ops metrics — Unit 33.
 *
 * On-demand aggregation across all orgs, with a 60-second in-memory
 * cache. No new DB table for v1 — metrics are quick aggregations
 * (small fixed number of `count` + bounded-range queries). Promotes
 * to a cached table when the page becomes hot.
 *
 * Cache lives at module scope: survives only for the lifetime of the
 * Node process. Multi-instance deployments see staggered refreshes
 * (acceptable jitter for ops metrics). Refresh happens lazily inside
 * `getPlatformMetrics` when the cached value is past its expiry.
 */

import { prisma } from '@/lib/prisma';

export type PlatformMetrics = {
  computedAt: string; // ISO
  orgs: {
    total: number;
    activeLast30d: number;
  };
  users: {
    activeLast30d: number;
  };
  notes: {
    signedLast24h: number;
    signedLast7d: number;
    signedLast30d: number;
    interrupted: number;
  };
  workers: {
    transcriptionFailedLast24h: number;
    aiGenerationFailedLast24h: number;
  };
  /** Count of audit rows with `action LIKE '%_FAILED'` in the last hour.
   *  Useful proxy — not exhaustive (some failures are silent, e.g.
   *  worker crash before audit write) but bounded + indexable. */
  errorRateLastHour: number;
};

export const PLATFORM_METRICS_CACHE_TTL_MS = 60_000;

type CachedEntry = {
  value: PlatformMetrics;
  expiresAt: number;
};

let cached: CachedEntry | null = null;

/** Test-only: clear the in-memory cache so each test starts cold. */
export function _resetPlatformMetricsCacheForTest(): void {
  cached = null;
}

/** Read the cache without computing — useful for assertions. */
export function _peekPlatformMetricsCacheForTest(): PlatformMetrics | null {
  return cached?.value ?? null;
}

export async function getPlatformMetrics(now: Date = new Date()): Promise<PlatformMetrics> {
  if (cached && cached.expiresAt > now.getTime()) {
    return cached.value;
  }

  const nowMs = now.getTime();
  const dayAgo = new Date(nowMs - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(nowMs - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(nowMs - 30 * 24 * 60 * 60 * 1000);
  const hourAgo = new Date(nowMs - 60 * 60 * 1000);

  const [
    totalOrgs,
    activeOrgsRows,
    activeUsersRows,
    signedLast24h,
    signedLast7d,
    signedLast30d,
    interrupted,
    transcriptionFailedLast24h,
    aiGenerationFailedLast24h,
    errorRateLastHour,
  ] = await Promise.all([
    prisma.organization.count(),
    // Distinct orgs that have ≥1 SIGNED note in the last 30 days.
    prisma.note.findMany({
      where: { status: 'SIGNED', signedAt: { gte: monthAgo } },
      select: { orgId: true },
      distinct: ['orgId'],
    }),
    // Distinct users with a USER_SIGNED_IN audit row in the last 30 days.
    prisma.auditLog.findMany({
      where: { action: 'USER_SIGNED_IN', createdAt: { gte: monthAgo } },
      select: { userId: true },
      distinct: ['userId'],
    }),
    prisma.note.count({ where: { status: 'SIGNED', signedAt: { gte: dayAgo } } }),
    prisma.note.count({ where: { status: 'SIGNED', signedAt: { gte: weekAgo } } }),
    prisma.note.count({ where: { status: 'SIGNED', signedAt: { gte: monthAgo } } }),
    prisma.note.count({ where: { status: 'INTERRUPTED' } }),
    prisma.auditLog.count({
      where: {
        // We don't have a FAILED-specific action for transcription worker;
        // closest proxy is NOTE_INTERRUPTED when retries exhausted.
        action: 'NOTE_INTERRUPTED',
        createdAt: { gte: dayAgo },
      },
    }),
    prisma.auditLog.count({
      where: { action: 'NOTE_GENERATION_FAILED', createdAt: { gte: dayAgo } },
    }),
    prisma.auditLog.count({
      where: {
        action: {
          in: [
            'USER_SIGNED_IN_FAILED',
            'MFA_VERIFY_FAILED',
            'MFA_ENROLL_FAILED',
            'NOTE_GENERATION_FAILED',
            'SECTION_GENERATION_FAILED',
            'POST_SIGN_ARTIFACT_GENERATION_FAILED',
            'BRIEF_GENERATION_FAILED',
            'FHIR_AUTH_FAILED',
            'TELEHEALTH_MAGIC_LINK_FAILED',
            'TELEHEALTH_PRECALL_CHECK_FAILED',
            'VOICE_ID_FAILED',
          ],
        },
        createdAt: { gte: hourAgo },
      },
    }),
  ]);

  const value: PlatformMetrics = {
    computedAt: now.toISOString(),
    orgs: {
      total: totalOrgs,
      activeLast30d: activeOrgsRows.length,
    },
    users: {
      activeLast30d: activeUsersRows.filter((r) => r.userId !== null).length,
    },
    notes: {
      signedLast24h,
      signedLast7d,
      signedLast30d,
      interrupted,
    },
    workers: {
      // transcriptionFailedLast24h now comes directly from NOTE_INTERRUPTED
      // (the parallel batch query was switched at line 99) — no follow-up
      // sequential query, no void suppression.
      transcriptionFailedLast24h,
      aiGenerationFailedLast24h,
    },
    errorRateLastHour,
  };

  cached = { value, expiresAt: nowMs + PLATFORM_METRICS_CACHE_TTL_MS };
  return value;
}
