/**
 * S3 client + put/presigned helpers with a local-fs stub for dev.
 *
 * Rules:
 *   - rule 7  : audio files are NEVER hard-deleted (soft-delete in DB only).
 *   - rule 15 : S3 bucket public access MUST be blocked — presigned URLs only.
 *   - rule 13 : production uses IAM task roles, NOT static access keys.
 *
 * Stub mode (when S3_BUCKET is unset) writes to ./tmp/audio/ and returns
 * file:// URLs the dev can grep — saves bringing up MinIO or wiring an AWS
 * account just to test Unit 03 locally.
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const BUCKET = process.env.S3_AUDIO_BUCKET ?? '';
const REGION = process.env.AWS_REGION ?? 'us-east-1';
const LOCAL_STUB_ROOT = path.join(process.cwd(), 'tmp', 'audio');

let cachedClient: S3Client | null = null;
function getClient() {
  if (!BUCKET) return null;
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: REGION,
      // In production this resolves from the IAM task role (rule 13).
      // For non-prod env vars: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
    });
  }
  return cachedClient;
}

export type PutAudioInput = {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
};

export async function putAudio(input: PutAudioInput) {
  const client = getClient();
  if (!client) {
    // Stub mode — write under ./tmp/audio/.
    const full = path.join(LOCAL_STUB_ROOT, input.key);
    const dir = path.dirname(full);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(full, input.body);
    console.log(`[s3 stub] wrote ${full} (${input.body.byteLength} bytes)`);
    return;
  }
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
}

export async function getPresignedAudioUrl(key: string, ttlSeconds = 300) {
  const client = getClient();
  if (!client) {
    return `file://${path.join(LOCAL_STUB_ROOT, key)}`;
  }
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: ttlSeconds },
  );
}

/**
 * Fetch audio bytes by S3 key. Used by the transcription worker for UPLOADED
 * captures (the audio sits in S3; we pull it down to feed Soniox batch).
 *
 * For LIVE captures the worker doesn't need to re-download — the realtime
 * path already has Note.transcriptRaw populated; the audio in S3 is for
 * long-term storage + voice-id windowing.
 */
export async function getAudioBytes(key: string): Promise<Buffer> {
  const client = getClient();
  if (!client) {
    const full = path.join(LOCAL_STUB_ROOT, key);
    return readFile(full);
  }
  const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const body = res.Body;
  if (!body) throw new Error(`S3 GetObject returned no body for key ${key}`);
  // AWS SDK v3 Body is a stream — readable stream or web stream depending on runtime.
  const reader = (body as unknown as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray;
  if (typeof reader !== 'function') throw new Error('S3 Body missing transformToByteArray');
  const bytes = await (body as unknown as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
  return Buffer.from(bytes);
}

export function audioKeyFor(noteId: string, segmentId: string) {
  return `audio/raw/${noteId}/${segmentId}.wav`;
}

/**
 * S3 key for external-context audio uploads. Kept separate from audioKeyFor
 * so the bucket-listing UI / lifecycle policies can tell visit-audio from
 * prior-context-audio at a glance.
 */
export function externalContextAudioKeyFor(externalContextId: string, ext: string) {
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'wav';
  return `audio/external-context/${externalContextId}.${safeExt}`;
}

export const isS3StubMode = !BUCKET;
