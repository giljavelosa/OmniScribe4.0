/**
 * TitaNet embedding service — the SOLE path through which app code computes
 * speaker embeddings for voice-ID. Rule 11 pattern: never call the embedding
 * endpoint directly from worker code — always go through this module.
 *
 * Stub mode (TITANET_ENDPOINT unset): returns a deterministic synthetic
 * embedding so the enrollment + match-speakers pipeline exercises end-to-end
 * without a real TitaNet server. Stub embeddings are keyed to the input's
 * first 8 bytes so "different audio → different embedding" within the fake,
 * while matching calls on the same audio produce the same vector.
 *
 * Real mode: POST audio bytes to TITANET_ENDPOINT; expect JSON
 *   { embedding: number[] } — a 192-dim float32 array.
 *
 * Deployment decision (W0-01): self-hosted GPU vs external embedding API.
 * The stub here satisfies the pipeline contract; swap the real HTTP call in
 * once the hosting decision is made. No other files need changing.
 */

const TITANET_ENDPOINT = process.env.TITANET_ENDPOINT ?? '';
const EMBEDDING_DIM = 192;

export type TitaNetResult = {
  /** 192-dim float32 embedding as a plain JS number array. */
  embedding: number[];
  stub: boolean;
};

/**
 * Compute a speaker x-vector embedding for the given audio bytes.
 *
 * @param audio   Raw PCM bytes (or any audio format the TitaNet endpoint accepts).
 * @param mimeType  MIME type of the audio (e.g. "audio/wav").
 */
export async function computeEmbedding(audio: Buffer | Uint8Array, mimeType = 'audio/wav'): Promise<TitaNetResult> {
  if (!TITANET_ENDPOINT) {
    return { embedding: syntheticEmbedding(audio), stub: true };
  }

  const form = new FormData();
  const blob = new Blob([audio as BlobPart], { type: mimeType });
  form.append('audio', blob, 'audio');

  const res = await fetch(TITANET_ENDPOINT, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    throw new Error(`TitaNet embedding failed: HTTP ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { embedding?: number[] };
  if (!Array.isArray(body.embedding) || body.embedding.length !== EMBEDDING_DIM) {
    throw new Error(
      `TitaNet returned unexpected embedding shape: expected ${EMBEDDING_DIM}-dim array, got ${JSON.stringify(body.embedding?.length)}`,
    );
  }
  return { embedding: body.embedding, stub: false };
}

/**
 * Cosine similarity between two 192-dim vectors. Returns 0..1 (1 = identical).
 * Used in the match-speakers worker to compare per-utterance embeddings to
 * enrolled profiles.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export const titanetConfig = {
  isStubMode: !TITANET_ENDPOINT,
  endpoint: TITANET_ENDPOINT || null,
  embeddingDim: EMBEDDING_DIM,
};

// ---------------------------------------------------------------------------
// Stub helpers — deterministic synthetic embedding for local dev.
// ---------------------------------------------------------------------------

function syntheticEmbedding(audio: Buffer | Uint8Array): number[] {
  // Seed from the first 8 bytes of audio so two different audio clips produce
  // different vectors in stub mode, while the same audio always returns the
  // same vector (important for the enrollment → match round-trip in tests).
  const seed = Array.from(audio.slice(0, 8)).reduce((acc, b) => acc * 31 + b, 1);
  const embedding: number[] = new Array(EMBEDDING_DIM);
  let s = seed;
  let mag = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    s = (s * 1664525 + 1013904223) >>> 0; // LCG
    embedding[i] = ((s / 0xffffffff) * 2 - 1);
    mag += embedding[i]! * embedding[i]!;
  }
  // Normalize to unit sphere so cosine distance is meaningful.
  const norm = Math.sqrt(mag);
  for (let i = 0; i < EMBEDDING_DIM; i++) embedding[i]! /= norm;
  return embedding;
}
