#!/usr/bin/env tsx
/**
 * scripts/verify-providers.ts
 *
 * One-shot provider verification. Exercises every configured external
 * service against the real keys in .env and reports a green/red checklist.
 * Never logs secrets (keys are truncated; tokens are hashed for diagnostics).
 *
 * Usage:
 *   node --env-file=.env --import=tsx scripts/verify-providers.ts
 *   (or: npm run verify:providers — wired into package.json)
 */

import { mintEphemeralKey, sonioxConfig } from '../src/services/transcription/SonioxService';
import { S3Client, HeadBucketCommand, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

type Result = { provider: string; ok: boolean; detail: string };

const results: Result[] = [];

function mask(s: string | undefined, keep = 6) {
  if (!s) return '<unset>';
  if (s.length <= keep) return '*'.repeat(s.length);
  return `${s.slice(0, keep)}…(${s.length} chars)`;
}

async function verifySoniox(): Promise<Result> {
  const provider = 'soniox';
  try {
    if (sonioxConfig.isStubMode) {
      return {
        provider,
        ok: false,
        detail: 'SONIOX_API_KEY unset — service is in stub mode. Capture works but transcription does not.',
      };
    }
    if (!sonioxConfig.baaOnFile && process.env.NODE_ENV !== 'development') {
      return { provider, ok: false, detail: 'SONIOX_BAA_ON_FILE != "true" — rule 17 blocks PHI in non-dev.' };
    }
    const mint = await mintEphemeralKey({ noteId: 'verify-providers', ttlSeconds: 30 });
    return {
      provider,
      ok: true,
      detail: `ephemeral key minted (stub=${mint.stub}, key=${mask(mint.apiKey)}, ws=${mint.websocketUrl}, model=${sonioxConfig.model}, expires=${mint.expiresAt})`,
    };
  } catch (e) {
    return { provider, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function verifyS3(): Promise<Result> {
  const provider = 's3';
  const bucket = process.env.S3_AUDIO_BUCKET;
  if (!bucket) {
    return { provider, ok: false, detail: 'S3_AUDIO_BUCKET unset — writes use ./tmp/audio/ stub (rule 13/15 only enforced in prod).' };
  }
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKey || !secretKey) {
    return {
      provider,
      ok: false,
      detail: 'S3 bucket set but AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY unset. Production should use IAM task role; local needs static keys.',
    };
  }
  try {
    const client = new S3Client({ region });
    await client.send(new HeadBucketCommand({ Bucket: bucket }));

    // Round-trip a tiny payload.
    const key = `audio/raw/_verify/${Date.now()}.bin`;
    const payload = Buffer.from('omniscribe-verify');
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: payload, ContentType: 'application/octet-stream' }));
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 60 });
    // Don't leak the URL; just confirm it was generated.
    const fetched = await fetch(url);
    const bodyOk = fetched.ok && (await fetched.arrayBuffer()).byteLength === payload.length;
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    if (!bodyOk) return { provider, ok: false, detail: `put+presigned-get round trip failed (fetch=${fetched.status})` };
    return { provider, ok: true, detail: `bucket=${bucket} region=${region} put/get/delete round-trip OK` };
  } catch (e) {
    // AWS SDK errors carry .name + .message + sometimes .$metadata.httpStatusCode.
    const err = e as { name?: string; message?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
    const status = err.$metadata?.httpStatusCode ? ` http=${err.$metadata.httpStatusCode}` : '';
    const code = err.name || err.Code || 'UnknownError';
    const msg = err.message ?? String(e);
    return { provider, ok: false, detail: `${code}${status}: ${msg}` };
  }
}

async function verifyBedrock(): Promise<Result> {
  const provider = 'bedrock';
  const token = process.env.AWS_BEARER_TOKEN_BEDROCK ?? '';
  const region = process.env.BEDROCK_REGION ?? 'us-east-1';
  const model = process.env.BEDROCK_MODEL_ID ?? '';
  if (!token) return { provider, ok: false, detail: 'AWS_BEARER_TOKEN_BEDROCK unset.' };
  if (!token.startsWith('ABSK')) {
    return {
      provider,
      ok: false,
      detail: `AWS_BEARER_TOKEN_BEDROCK does not start with "ABSK" (got ${mask(token, 4)}). Long-term Bedrock API keys are ABSK… tokens — see .env.example warning.`,
    };
  }
  if (model && !model.startsWith('us.')) {
    return {
      provider,
      ok: false,
      detail: `BEDROCK_MODEL_ID does not start with "us." (got ${model}). Sonnet 4.5 / Haiku 4.5 require the cross-region inference profile prefix.`,
    };
  }
  // Two endpoints check the model:
  //  - /foundation-models holds base models (e.g. anthropic.claude-sonnet-4-5-...)
  //  - /inference-profiles holds cross-region routes (the "us." prefixed IDs)
  // Sonnet/Haiku 4.5 use cross-region inference profiles per the kit, so the
  // `us.` ID lives in the latter — checking both keeps the diagnostic honest.
  try {
    const fmRes = await fetch(`https://bedrock.${region}.amazonaws.com/foundation-models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!fmRes.ok) {
      return { provider, ok: false, detail: `Bedrock list-foundation-models returned ${fmRes.status} ${fmRes.statusText}` };
    }
    const fmBody = (await fmRes.json()) as { modelSummaries?: Array<{ modelId: string }> };
    const baseId = model.startsWith('us.') ? model.slice(3) : model;
    const baseHit = fmBody.modelSummaries?.some((m) => m.modelId === baseId) ?? false;

    let profileHit = false;
    let profileCount = 0;
    if (model.startsWith('us.')) {
      const ipRes = await fetch(`https://bedrock.${region}.amazonaws.com/inference-profiles`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (ipRes.ok) {
        const ipBody = (await ipRes.json()) as { inferenceProfileSummaries?: Array<{ inferenceProfileId: string }> };
        profileCount = ipBody.inferenceProfileSummaries?.length ?? 0;
        profileHit =
          ipBody.inferenceProfileSummaries?.some((p) => p.inferenceProfileId === model) ?? false;
      }
    }
    const visible = baseHit || profileHit;
    const where = profileHit
      ? 'cross-region inference profiles'
      : baseHit
        ? `foundation models (as base id ${baseId})`
        : 'neither list';
    return {
      provider,
      ok: true,
      detail: `bearer token authorized; ${fmBody.modelSummaries?.length ?? 0} foundation models + ${profileCount} inference profiles; target ${model} ${visible ? '✓ VISIBLE in ' : '✗ NOT FOUND in '}${where}`,
    };
  } catch (e) {
    return { provider, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function verifyResend(): Promise<Result> {
  const provider = 'resend';
  const key = process.env.RESEND_API_KEY ?? '';
  if (!key) return { provider, ok: false, detail: 'RESEND_API_KEY unset — email transport runs in console-stub mode.' };
  try {
    const res = await fetch('https://api.resend.com/domains', {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) {
      const body = (await res.json()) as { data?: Array<{ name: string; status: string }> };
      const verified = body.data?.filter((d) => d.status === 'verified') ?? [];
      return {
        provider,
        ok: true,
        detail: `API key valid; ${body.data?.length ?? 0} domains (${verified.length} verified${verified.length ? ': ' + verified.map((d) => d.name).join(', ') : ''})`,
      };
    }
    return { provider, ok: false, detail: `Resend /domains returned ${res.status} ${res.statusText}` };
  } catch (e) {
    return { provider, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  console.log('\n┌─ provider verification ──────────────────────────────────────────────\n');
  results.push(await verifySoniox());
  results.push(await verifyS3());
  results.push(await verifyBedrock());
  results.push(await verifyResend());

  let pad = 0;
  for (const r of results) pad = Math.max(pad, r.provider.length);
  for (const r of results) {
    const marker = r.ok ? '✓' : '✗';
    const color = r.ok ? '\x1b[32m' : '\x1b[31m';
    const reset = '\x1b[0m';
    console.log(`│ ${color}${marker}${reset} ${r.provider.padEnd(pad)}  ${r.detail}`);
  }
  const failures = results.filter((r) => !r.ok).length;
  console.log(`└─ ${results.length - failures}/${results.length} passed${failures ? ` · ${failures} failed` : ''}\n`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('verify-providers fatal:', e);
  process.exit(2);
});
