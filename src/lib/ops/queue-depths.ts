/**
 * BullMQ queue depth probe — Unit 33.
 *
 * Reads per-queue counts (waiting, active, failed, completed, delayed)
 * via the BullMQ `Queue.getJobCounts` helper. Fail-soft on Redis
 * unavailability: returns `{ stub: true, ... null counts }` per queue
 * so the surface can render "Redis unavailable" without throwing.
 *
 * v1 surfaces only the count snapshots; per-job introspection
 * (specific failed job details, worker liveness pings) is Wave 6.5+
 * polish.
 */

import {
  aiGenerationQueue,
  externalContextExtractionQueue,
  externalContextTranscriptionQueue,
  noteBriefQueue,
  noteFinalizeQueue,
  postSignArtifactsQueue,
  transcriptionQueue,
  voiceIdQueue,
} from '@/lib/queue';
import type { Queue } from 'bullmq';

export type QueueDepth = {
  name: string;
  /** Counts. null when the probe failed (Redis unavailable, etc.). */
  waiting: number | null;
  active: number | null;
  failed: number | null;
  completed: number | null;
  delayed: number | null;
  /** True when the underlying probe didn't reach Redis. UI surfaces a
   *  "Redis unavailable" hint per row. */
  stub: boolean;
  /** Short PHI-free detail when stub=true. */
  detail: string | null;
};

const REGISTRY: ReadonlyArray<{ name: string; queue: Queue }> = [
  { name: 'transcription', queue: transcriptionQueue },
  { name: 'ai-generation', queue: aiGenerationQueue },
  { name: 'note-finalize', queue: noteFinalizeQueue },
  { name: 'voice-id', queue: voiceIdQueue },
  { name: 'note-brief', queue: noteBriefQueue },
  { name: 'post-sign-artifacts', queue: postSignArtifactsQueue },
  { name: 'external-context-transcription', queue: externalContextTranscriptionQueue },
  { name: 'external-context-extraction', queue: externalContextExtractionQueue },
];

const PROBE_TIMEOUT_MS = 3_000;

/**
 * Reads counts from every registered queue in parallel with a 3-second
 * per-queue timeout. Each row is independent — a slow queue doesn't
 * block the others.
 */
export async function getQueueDepths(): Promise<QueueDepth[]> {
  return Promise.all(
    REGISTRY.map(async ({ name, queue }) => {
      try {
        const counts = await withTimeout(queue.getJobCounts('waiting', 'active', 'failed', 'completed', 'delayed'));
        return {
          name,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          failed: counts.failed ?? 0,
          completed: counts.completed ?? 0,
          delayed: counts.delayed ?? 0,
          stub: false,
          detail: null,
        } satisfies QueueDepth;
      } catch (err) {
        const message =
          err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : 'unknown';
        return {
          name,
          waiting: null,
          active: null,
          failed: null,
          completed: null,
          delayed: null,
          stub: true,
          detail: message,
        } satisfies QueueDepth;
      }
    }),
  );
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`queue probe timed out after ${PROBE_TIMEOUT_MS}ms`)),
      PROBE_TIMEOUT_MS,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
