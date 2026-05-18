/**
 * Pre-call diagnostic helpers — Unit 18.
 *
 * The clinician's preflight surface runs three checks before the room:
 *   1. Browser compat — MediaStreamTrackProcessor must exist for the audio
 *      pipeline (Chrome / Edge). Pure logic, lives here.
 *   2. Network round-trip — small fetch to /api/telehealth/preflight/ping
 *      with a timeout; surfaces RTT. Pure logic, lives here.
 *   3. Mic permission + audio level — needs getUserMedia + AudioContext;
 *      stays in the client component (this file is environment-agnostic).
 *
 * Keeping (1) and (2) here lets the surface render the result inline AND
 * lets the unit tests exercise the timeout + slow-network behavior without
 * a real network.
 */

export type CompatResult = {
  ok: boolean;
  details: {
    hasMediaStreamTrackProcessor: boolean;
    hasAudioContext: boolean;
    hasGetUserMedia: boolean;
    hasWebSocket: boolean;
  };
};

/**
 * Check whether the current browser globals expose every API the audio
 * pipeline needs. The pipeline currently lives in `src/lib/telehealth/
 * audio-pipeline.ts`; if the API surface there grows, add the new global
 * here too.
 *
 * Pass an explicit `globals` argument from tests; defaults to `globalThis`.
 */
export function checkBrowserCompat(globals: Record<string, unknown> = globalThis): CompatResult {
  const hasMediaStreamTrackProcessor = 'MediaStreamTrackProcessor' in globals;
  const hasAudioContext = 'AudioContext' in globals;
  const hasWebSocket = 'WebSocket' in globals;
  const nav = (globals as { navigator?: { mediaDevices?: { getUserMedia?: unknown } } }).navigator;
  const hasGetUserMedia = typeof nav?.mediaDevices?.getUserMedia === 'function';
  return {
    ok:
      hasMediaStreamTrackProcessor &&
      hasAudioContext &&
      hasGetUserMedia &&
      hasWebSocket,
    details: { hasMediaStreamTrackProcessor, hasAudioContext, hasGetUserMedia, hasWebSocket },
  };
}

export type RoundTripResult =
  | { ok: true; rttMs: number }
  | { ok: false; reason: 'timeout' | 'http' | 'fetch_failed'; status?: number };

/**
 * Measure round-trip latency to the preflight ping endpoint. Uses
 * AbortController for the timeout — `signal: AbortSignal.timeout(...)` is
 * cleaner but Safari < 17 lacks it, and the preflight should work on every
 * browser even if the room can't.
 *
 * Returns a discriminated union so callers can branch on reason without
 * stringly-typed error messages.
 */
export async function measureRoundTrip(opts: {
  fetchImpl?: typeof fetch;
  url?: string;
  timeoutMs?: number;
  now?: () => number;
} = {}): Promise<RoundTripResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = opts.url ?? '/api/telehealth/preflight/ping';
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const now = opts.now ?? (() => performance.now());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = now();
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    const rttMs = Math.round(now() - start);
    if (!res.ok) {
      return { ok: false, reason: 'http', status: res.status };
    }
    return { ok: true, rttMs };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return { ok: false, reason: isAbort ? 'timeout' : 'fetch_failed' };
  } finally {
    clearTimeout(timer);
  }
}
