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
import { mkdir, writeFile } from 'node:fs/promises';
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

export function audioKeyFor(noteId: string, segmentId: string) {
  return `audio/raw/${noteId}/${segmentId}.wav`;
}

export const isS3StubMode = !BUCKET;
