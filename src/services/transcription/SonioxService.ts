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
 *
 * Key-mode decision (2026-05-21):
 *   The Soniox temp-key endpoint (`POST /v1/auth/temporary-api-key`) returns
 *   404 on the current Soniox plan tier. When SONIOX_ALLOW_LONG_LIVED_KEY=true
 *   is set, mintEphemeralKey falls back to passing the long-lived API key as the
 *   "apiKey" return value. Rule 11's primary intent is that the browser never
 *   calls Soniox directly without server mediation — the key still travels only
 *   via /api/notes/[id]/realtime-key (server-authenticated, note-scoped). The
 *   security trade-off versus a 60-second TTL is: the key reaches the browser
 *   session context (not a hardcoded client bundle). This is explicitly accepted
 *   for the current Soniox tier; upgrade to the temp-keys tier to remove the
 *   flag (W0-04 in polish-waves-0-6.md).
 */

const SONIOX_API_BASE = process.env.SONIOX_API_BASE ?? 'https://api.soniox.com';
const SONIOX_WS_URL = process.env.SONIOX_REALTIME_WS_URL ?? 'wss://stt-rt.soniox.com/transcribe-websocket';
const SONIOX_MODEL = process.env.SONIOX_REALTIME_MODEL ?? 'stt-rt-v4';
// stt-async-v4 is the current model (replaces deprecated stt-async-preview / stt-async-v3).
const SONIOX_BATCH_MODEL = process.env.SONIOX_BATCH_MODEL ?? 'stt-async-v4';
const SONIOX_API_KEY = process.env.SONIOX_API_KEY ?? '';
const SONIOX_BAA_ON_FILE = process.env.SONIOX_BAA_ON_FILE === 'true';
/** Explicit operator opt-in: use the long-lived key when temp-key endpoint is unavailable. */
const SONIOX_ALLOW_LONG_LIVED_KEY = process.env.SONIOX_ALLOW_LONG_LIVED_KEY === 'true';

export type RealtimeKeyResult = {
  apiKey: string;
  websocketUrl: string;
  config: SonioxRealtimeConfig;
  expiresAt: string;
  stub: boolean;
  /** 'ephemeral' = proper temp key (preferred). 'long-lived' = fallback when
   *  temp-key tier unavailable; requires SONIOX_ALLOW_LONG_LIVED_KEY=true. */
  keyMode: 'ephemeral' | 'long-lived';
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
      keyMode: 'ephemeral',
    };
  }

  // Real Soniox: mint a temporary key scoped to STT-WS only.
  // Soniox 2025 API: path `/v1/auth/temporary-api-key` (singular);
  // body `usage_type: 'transcribe_websocket'`, `expires_in_seconds`,
  // optional `client_reference_id`. Response: `{ api_key, expires_at }`.
  // Docs: https://soniox.com/docs/api-reference/auth/create_temporary_api_key
  try {
    const res = await fetch(`${SONIOX_API_BASE}/v1/auth/temporary-api-key`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SONIOX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        usage_type: 'transcribe_websocket',
        expires_in_seconds: ttl,
        client_reference_id: args.noteId,
      }),
    });

    if (!res.ok) {
      const errStatus = res.status;
      const errBody = await res.text().catch(() => '');

      // 404 = temp-key endpoint not available on this Soniox tier.
      // If SONIOX_ALLOW_LONG_LIVED_KEY=true the operator has explicitly accepted
      // the Rule 11 trade-off (key is mediated by the server route but does reach
      // the browser session). Any other non-OK status is a hard error.
      if (errStatus === 404 && SONIOX_ALLOW_LONG_LIVED_KEY) {
        console.warn(
          '[SonioxService] temp-key endpoint returned 404; falling back to long-lived key ' +
          '(SONIOX_ALLOW_LONG_LIVED_KEY=true). Upgrade to a Soniox tier with temp-key support ' +
          'to remove this fallback (W0-04).',
        );
        return {
          apiKey: SONIOX_API_KEY,
          websocketUrl: SONIOX_WS_URL,
          config: FIXED_REALTIME_CONFIG,
          expiresAt,
          stub: false,
          keyMode: 'long-lived',
        };
      }

      throw new Error(
        `Soniox temp-key mint failed (HTTP ${errStatus}). ` +
        (errStatus === 404
          ? 'Temp-key endpoint returned 404 — set SONIOX_ALLOW_LONG_LIVED_KEY=true to fall back to the long-lived key on this Soniox tier (W0-04), or upgrade your Soniox plan.'
          : `Body: ${errBody.slice(0, 200)}`),
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
      keyMode: 'ephemeral',
    };
  } catch (e) {
    throw new Error(`Soniox temp-key mint failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export const sonioxConfig = {
  isStubMode: !SONIOX_API_KEY,
  baaOnFile: SONIOX_BAA_ON_FILE,
  allowLongLivedKey: SONIOX_ALLOW_LONG_LIVED_KEY,
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
 * Synchronous-from-the-caller's-perspective batch transcription.
 *
 * Current Soniox async API (verified 2026-05-21 against docs):
 *   1. POST /v1/files         — upload audio, get file_id
 *   2. POST /v1/transcriptions — start transcription with file_id + model
 *   3. Poll GET /v1/transcriptions/{id} — wait for status==="completed"
 *   4. GET /v1/transcriptions/{id}/transcript — fetch the actual words
 *
 * Stub mode: returns a single "Soniox stub transcript" token so the worker
 * pipeline + cleaner exercise end-to-end without a real API call.
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

  const authHeaders = { Authorization: `Bearer ${SONIOX_API_KEY}` };

  // Step 1: Upload audio to Soniox Files API.
  const fileForm = new FormData();
  const blob = new Blob([args.audio as BlobPart], { type: args.contentType || 'audio/wav' });
  fileForm.append('file', blob, `note-${args.noteId}.wav`);

  const fileRes = await fetch(`${SONIOX_API_BASE}/v1/files`, {
    method: 'POST',
    headers: authHeaders,
    body: fileForm,
  });
  if (!fileRes.ok) {
    throw new Error(`Soniox Files API upload failed: HTTP ${fileRes.status} ${fileRes.statusText}`);
  }
  const fileBody = (await fileRes.json()) as { id?: string };
  const fileId = fileBody.id;
  if (!fileId) throw new Error('Soniox Files API returned no file id.');

  // Step 2: Create transcription job.
  const txRes = await fetch(`${SONIOX_API_BASE}/v1/transcriptions`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: SONIOX_BATCH_MODEL,
      file_id: fileId,
      enable_speaker_diarization: true,
      client_reference_id: args.noteId,
    }),
  });
  if (!txRes.ok) {
    throw new Error(`Soniox transcription create failed: HTTP ${txRes.status} ${txRes.statusText}`);
  }
  const txBody = (await txRes.json()) as { id?: string };
  const txId = txBody.id;
  if (!txId) throw new Error('Soniox transcription create returned no id.');

  // Step 3: Poll for completion. Cap at ~10 minutes.
  const POLL_MS = 2_000;
  const MAX_ATTEMPTS = 300;
  let audioDurationMs: number | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const statusRes = await fetch(`${SONIOX_API_BASE}/v1/transcriptions/${txId}`, {
      headers: authHeaders,
    });
    if (!statusRes.ok) {
      throw new Error(`Soniox poll failed: HTTP ${statusRes.status} ${statusRes.statusText}`);
    }
    const statusBody = (await statusRes.json()) as {
      status?: string;
      error_message?: string;
      audio_duration_ms?: number;
    };
    if (statusBody.status === 'completed') {
      audioDurationMs = statusBody.audio_duration_ms;
      break;
    }
    if (statusBody.status === 'error') {
      throw new Error(`Soniox transcription failed: ${statusBody.error_message ?? 'unknown'}`);
    }
  }

  // Step 4: Fetch the actual transcript words.
  const transcriptRes = await fetch(`${SONIOX_API_BASE}/v1/transcriptions/${txId}/transcript`, {
    headers: authHeaders,
  });
  if (!transcriptRes.ok) {
    throw new Error(`Soniox transcript fetch failed: HTTP ${transcriptRes.status} ${transcriptRes.statusText}`);
  }
  const transcriptBody = (await transcriptRes.json()) as {
    words?: Array<{ text: string; speaker?: number; start_ms?: number; end_ms?: number; is_final?: boolean }>;
    tokens?: Array<{ text: string; speaker?: number; start_ms?: number; end_ms?: number; is_final?: boolean }>;
    language?: string;
  };

  // Clean up the file to avoid accumulating uploaded files in Soniox storage.
  void fetch(`${SONIOX_API_BASE}/v1/files/${fileId}`, {
    method: 'DELETE',
    headers: authHeaders,
  }).catch(() => {}); // fire-and-forget, not blocking

  return {
    tokens: transcriptBody.words ?? transcriptBody.tokens ?? [],
    duration_ms: audioDurationMs,
    language: transcriptBody.language,
  };
}
