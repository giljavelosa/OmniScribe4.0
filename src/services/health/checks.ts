import {
  S3Client,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';

import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { mintEphemeralKey, sonioxConfig } from '@/services/transcription/SonioxService';
import { bedrockConfig } from '@/services/llm';

export type HealthCheckResult = {
  name:
    | 'postgres'
    | 'redis'
    | 's3'
    | 'bedrock'
    | 'soniox'
    | 'resend';
  ok: boolean;
  /** ms (rounded). null when the check timed out or never started. */
  latencyMs: number | null;
  /** Short, PHI-free human detail. May include the stub-mode banner. */
  detail: string;
  /** True when the provider is configured in stub mode (no key). The
   *  surface should distinguish "configured + healthy" from "stub mode
   *  works but production deploys need real keys." */
  stub: boolean;
};

const CHECK_TIMEOUT_MS = 5_000;

/**
 * runAllHealthChecks — exercises every provider in parallel with a 5s
 * per-check timeout. Results are PHI-free; the worst that can happen is
 * a leaking S3 bucket name (still org-routable, never patient-routable).
 *
 * Failures NEVER throw — they return `{ ok: false, detail }` so the surface
 * can render a red row without crashing the page.
 */
export async function runAllHealthChecks(): Promise<HealthCheckResult[]> {
  return Promise.all([
    withTimeout('postgres', checkPostgres()),
    withTimeout('redis', checkRedis()),
    withTimeout('s3', checkS3()),
    withTimeout('bedrock', checkBedrock()),
    withTimeout('soniox', checkSoniox()),
    withTimeout('resend', checkResend()),
  ]);
}

async function withTimeout(
  name: HealthCheckResult['name'],
  promise: Promise<HealthCheckResult>,
): Promise<HealthCheckResult> {
  const timeoutResult: HealthCheckResult = {
    name,
    ok: false,
    latencyMs: null,
    detail: `Timed out after ${CHECK_TIMEOUT_MS}ms.`,
    stub: false,
  };
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<HealthCheckResult>((resolve) => {
    timer = setTimeout(() => resolve(timeoutResult), CHECK_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkPostgres(): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      name: 'postgres',
      ok: true,
      latencyMs: Date.now() - start,
      detail: 'SELECT 1 returned',
      stub: false,
    };
  } catch (err) {
    return {
      name: 'postgres',
      ok: false,
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : 'unknown',
      stub: false,
    };
  }
}

async function checkRedis(): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const pong = await redis.ping();
    return {
      name: 'redis',
      ok: pong === 'PONG',
      latencyMs: Date.now() - start,
      detail: `PING → ${pong}`,
      stub: false,
    };
  } catch (err) {
    return {
      name: 'redis',
      ok: false,
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : 'unknown',
      stub: false,
    };
  }
}

async function checkS3(): Promise<HealthCheckResult> {
  const start = Date.now();
  const bucket = process.env.S3_AUDIO_BUCKET ?? '';
  if (!bucket) {
    return {
      name: 's3',
      ok: true,
      latencyMs: Date.now() - start,
      detail: 'S3_AUDIO_BUCKET unset — local-fs stub mode. Set bucket for production reads.',
      stub: true,
    };
  }
  try {
    const client = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return {
      name: 's3',
      ok: true,
      latencyMs: Date.now() - start,
      detail: `HeadBucket on ${bucket} succeeded`,
      stub: false,
    };
  } catch (err) {
    return {
      name: 's3',
      ok: false,
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : 'unknown',
      stub: false,
    };
  }
}

async function checkBedrock(): Promise<HealthCheckResult> {
  const start = Date.now();
  if (bedrockConfig.isStubMode) {
    return {
      name: 'bedrock',
      ok: true,
      latencyMs: Date.now() - start,
      detail: 'AWS_BEARER_TOKEN_BEDROCK or BEDROCK_MODEL_ID unset — service in stub mode.',
      stub: true,
    };
  }
  // Light real-Bedrock probe: a config-only check is sufficient for v1; a
  // deeper ping (e.g., ListFoundationModels) belongs in the bigger ops
  // dashboard. For now, "configured" + "model id well-formed" is enough.
  if (!/^us\./.test(bedrockConfig.sonnetModelId)) {
    return {
      name: 'bedrock',
      ok: false,
      latencyMs: Date.now() - start,
      detail: `Configured model "${bedrockConfig.sonnetModelId}" lacks the required us. cross-region prefix.`,
      stub: false,
    };
  }
  return {
    name: 'bedrock',
    ok: true,
    latencyMs: Date.now() - start,
    detail: `Configured model "${bedrockConfig.sonnetModelId}" in ${bedrockConfig.region}.`,
    stub: false,
  };
}

async function checkSoniox(): Promise<HealthCheckResult> {
  const start = Date.now();
  if (sonioxConfig.isStubMode) {
    return {
      name: 'soniox',
      ok: true,
      latencyMs: Date.now() - start,
      detail: 'SONIOX_API_KEY unset — capture works in stub mode (no real transcription).',
      stub: true,
    };
  }
  try {
    const mint = await mintEphemeralKey({ noteId: 'health-check', ttlSeconds: 30 });
    return {
      name: 'soniox',
      ok: true,
      latencyMs: Date.now() - start,
      detail: `Ephemeral key minted (stub=${mint.stub}, ws=${mint.websocketUrl}, model=${sonioxConfig.model}).`,
      stub: false,
    };
  } catch (err) {
    return {
      name: 'soniox',
      ok: false,
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : 'unknown',
      stub: false,
    };
  }
}

async function checkResend(): Promise<HealthCheckResult> {
  const start = Date.now();
  const key = process.env.RESEND_API_KEY ?? '';
  if (!key) {
    return {
      name: 'resend',
      ok: true,
      latencyMs: Date.now() - start,
      detail: 'RESEND_API_KEY unset — email transport in console-stub mode.',
      stub: true,
    };
  }
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      return {
        name: 'resend',
        ok: false,
        latencyMs: Date.now() - start,
        detail: `GET /domains → ${res.status}`,
        stub: false,
      };
    }
    return {
      name: 'resend',
      ok: true,
      latencyMs: Date.now() - start,
      detail: 'GET /domains returned 200',
      stub: false,
    };
  } catch (err) {
    return {
      name: 'resend',
      ok: false,
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : 'unknown',
      stub: false,
    };
  }
}
