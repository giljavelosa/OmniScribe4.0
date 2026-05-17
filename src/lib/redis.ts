import Redis, { type RedisOptions } from 'ioredis';

/**
 * ioredis singleton. BullMQ requires `maxRetriesPerRequest: null` on the
 * connection so blocking commands (BZPOPMIN, BRPOPLPUSH, etc.) work — without
 * it BullMQ throws "Connection is closed" on every blocking poll.
 *
 * Anti-regression rule 18: only ONE BullMQ worker fleet per Redis per
 * environment. The dev:workers script must NOT be running in parallel with
 * another local worker process against the same Redis.
 */

const globalForRedis = globalThis as unknown as { __omniscribeRedis?: Redis };

function buildOptions(): RedisOptions {
  return {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: true,
    lazyConnect: false,
  };
}

function build() {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL is not set. See .env.example.');
  }
  return new Redis(url, buildOptions());
}

export const redis: Redis = globalForRedis.__omniscribeRedis ?? build();

if (process.env.NODE_ENV !== 'production') globalForRedis.__omniscribeRedis = redis;
