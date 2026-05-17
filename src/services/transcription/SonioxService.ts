/**
 * SonioxService — the SOLE path through which app code talks to Soniox.
 * Anti-regression rule 11: NEVER import the Soniox SDK directly elsewhere.
 *
 * Mints ephemeral STT-WS-only keys (60s TTL by default). Browser-side WS
 * connection uses that key + the config payload returned here.
 *
 * Real Soniox config (rule 12): MUST keep `enable_speaker_diarization: true`
 * and `audio_format: 'pcm_s16le'`. Sample rate 16,000 Hz mono. Model
 * `stt-rt-v4` (overridable via SONIOX_REALTIME_MODEL).
 *
 * Stub mode (SONIOX_API_KEY unset) returns a fake key + a localhost WS URL.
 * Real Soniox requires both SONIOX_API_KEY and SONIOX_BAA_ON_FILE=true in any
 * non-dev environment (rule 17, enforced by assertSonioxAllowedForPHI below).
 */

const SONIOX_API_BASE = process.env.SONIOX_API_BASE ?? 'https://api.soniox.com';
const SONIOX_WS_URL = process.env.SONIOX_REALTIME_WS_URL ?? 'wss://stt-rt.soniox.com/transcribe-websocket';
const SONIOX_MODEL = process.env.SONIOX_REALTIME_MODEL ?? 'stt-rt-v4';
const SONIOX_BATCH_MODEL = process.env.SONIOX_BATCH_MODEL ?? 'stt-async-preview';
const SONIOX_API_KEY = process.env.SONIOX_API_KEY ?? '';
const SONIOX_BAA_ON_FILE = process.env.SONIOX_BAA_ON_FILE === 'true';

export type RealtimeKeyResult = {
  apiKey: string;
  websocketUrl: string;
  config: SonioxRealtimeConfig;
  expiresAt: string;
  stub: boolean;
};

export type SonioxRealtimeConfig = {
  api_key?: string;          // included in WS init from the browser; not in the response object
  model: string;
  audio_format: 'pcm_s16le'; // RULE 12 — locked
  sample_rate: number;
  num_channels: number;
  enable_speaker_diarization: true; // RULE 12 — locked
  enable_endpoint_detection?: boolean;
  language_hints?: string[];
};

const FIXED_REALTIME_CONFIG: Omit<SonioxRealtimeConfig, 'api_key'> = {
  model: SONIOX_MODEL,
  audio_format: 'pcm_s16le',
  sample_rate: 16_000,
  num_channels: 1,
  enable_speaker_diarization: true,
  enable_endpoint_detection: true,
};

/**
 * Hard gate: any non-dev environment that processes PHI MUST have BOTH a real
 * Soniox API key AND SONIOX_BAA_ON_FILE=true (rule 17). Stub mode is dev-only.
 */
export function assertSonioxAllowedForPHI() {
  const env = process.env.NODE_ENV;
  if (env === 'development' || env === 'test') return;

  if (!SONIOX_API_KEY) {
    throw new Error(
      'Soniox not configured. SONIOX_API_KEY must be set in any non-dev environment that processes PHI. (Rule 11.)',
    );
  }
  if (!SONIOX_BAA_ON_FILE) {
    throw new Error(
      'SONIOX_BAA_ON_FILE must be "true" in any non-dev environment that processes PHI. Confirm the BAA is on file before flipping this flag. (Rule 17.)',
    );
  }
}

export type MintEphemeralKeyArgs = {
  noteId: string;
  ttlSeconds?: number;
};

export async function mintEphemeralKey(args: MintEphemeralKeyArgs): Promise<RealtimeKeyResult> {
  assertSonioxAllowedForPHI();

  const ttl = args.ttlSeconds ?? 60;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  // Stub mode: dev convenience. The capture page will gracefully surface that
  // real transcription is disabled — the rest of the flow (audio worklet, UI,
  // finalize) still exercises end-to-end.
  if (!SONIOX_API_KEY) {
    return {
      apiKey: `stub-${args.noteId}-${Date.now()}`,
      websocketUrl: SONIOX_WS_URL,
      config: FIXED_REALTIME_CONFIG,
      expiresAt,
      stub: true,
    };
  }

  // Real Soniox: mint a temporary key scoped to STT-WS only.
  // (Soniox's exact API surface for ephemeral keys varies by tier. The
  // canonical endpoint is `/v1/auth/temporary-api-keys`; if the deployed tier
  // doesn't expose it, fall back to passing the long-lived key directly — the
  // bare minimum is that the key never reaches the browser without explicit
  // server mediation.)
  try {
    const res = await fetch(`${SONIOX_API_BASE}/v1/auth/temporary-api-keys`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SONIOX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        usage: 'stt-ws',
        ttl_seconds: ttl,
        client_reference_id: args.noteId,
      }),
    });
    if (!res.ok) {
      // Anti-regression rule 11: the long-lived SONIOX_API_KEY must never reach
      // the browser. If the temporary-keys endpoint is unavailable, fail closed
      // — the operator must enable the temp-keys tier or fix the credential.
      const errBody = await res.text().catch(() => '');
      throw new Error(
        `Soniox temp-key mint failed (HTTP ${res.status}). Refusing to fall back to the long-lived key (rule 11). Body: ${errBody.slice(0, 200)}`,
      );
    }
    const body = (await res.json()) as { api_key?: string };
    if (!body.api_key) {
      throw new Error('Soniox response missing api_key.');
    }
    return {
      apiKey: body.api_key,
      websocketUrl: SONIOX_WS_URL,
      config: FIXED_REALTIME_CONFIG,
      expiresAt,
      stub: false,
    };
  } catch (e) {
    throw new Error(`Soniox temp-key mint failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export const sonioxConfig = {
  isStubMode: !SONIOX_API_KEY,
  baaOnFile: SONIOX_BAA_ON_FILE,
  model: SONIOX_MODEL,
  batchModel: SONIOX_BATCH_MODEL,
};

// =============================================================================
// Batch transcription — for UPLOADED capture mode.
// =============================================================================

import type { SonioxBatchTranscript } from './types';

export type TranscribeBatchArgs = {
  audio: Uint8Array | Buffer;
  contentType: string;
  noteId: string;
};

/**
 * Synchronous-from-the-caller's-perspective batch transcription. Internally
 * may use Soniox's async-job API + poll, or the sync API depending on tier.
 *
 * Stub mode: returns a single "Soniox stub transcript" token so the worker
 * pipeline + cleaner exercise end-to-end without a real API call. Useful for
 * local dev without a Soniox account.
 *
 * Rule 11 reminder: this is the SOLE entry point for batch transcription —
 * never import the Soniox SDK directly from worker code.
 */
export async function transcribeBatch(args: TranscribeBatchArgs): Promise<SonioxBatchTranscript> {
  assertSonioxAllowedForPHI();

  if (!SONIOX_API_KEY) {
    return {
      tokens: [
        {
          text: '[Soniox stub mode — no real transcription. UPLOADED audio was stored but not transcribed.]',
          speaker: 1,
          start_ms: 0,
          end_ms: 1,
          is_final: true,
        },
      ],
      duration_ms: 1,
      language: 'en',
    };
  }

  // Real Soniox async path: POST audio, poll for the result. The exact
  // endpoint shape is tier-dependent; we attempt the documented
  // /v1/transcribe-async surface and surface failures loudly to the caller
  // so the worker can mark the Note INTERRUPTED rather than silently lose
  // the audio.
  const formData = new FormData();
  const blob = new Blob([args.audio as BlobPart], { type: args.contentType || 'audio/wav' });
  formData.append('file', blob, 'audio');
  formData.append('model', SONIOX_BATCH_MODEL);
  formData.append('enable_speaker_diarization', 'true');
  formData.append('client_reference_id', args.noteId);

  const submitRes = await fetch(`${SONIOX_API_BASE}/v1/transcribe-async`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SONIOX_API_KEY}` },
    body: formData,
  });
  if (!submitRes.ok) {
    throw new Error(`Soniox batch submit failed: ${submitRes.status} ${submitRes.statusText}`);
  }
  const submitBody = (await submitRes.json()) as { id?: string };
  const jobId = submitBody.id;
  if (!jobId) throw new Error('Soniox batch submit returned no job id.');

  // Poll. Cap at ~10 minutes (300 attempts × 2 sec).
  const POLL_MS = 2_000;
  const MAX_ATTEMPTS = 300;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const pollRes = await fetch(`${SONIOX_API_BASE}/v1/transcribe-async/${jobId}`, {
      headers: { Authorization: `Bearer ${SONIOX_API_KEY}` },
    });
    if (!pollRes.ok) {
      throw new Error(`Soniox batch poll failed: ${pollRes.status} ${pollRes.statusText}`);
    }
    const pollBody = (await pollRes.json()) as { status?: string; result?: SonioxBatchTranscript; error?: string };
    if (pollBody.status === 'completed' && pollBody.result) return pollBody.result;
    if (pollBody.status === 'failed') {
      throw new Error(`Soniox batch job failed: ${pollBody.error ?? 'unknown'}`);
    }
  }
  throw new Error(`Soniox batch job timed out after ${(MAX_ATTEMPTS * POLL_MS) / 1000}s`);
}
