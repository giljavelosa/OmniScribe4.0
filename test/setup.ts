import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import '@testing-library/jest-dom/vitest';

// Unit 37 — load .env so integration tests that touch Postgres (via
// Prisma's auto-loader this already works) AND Redis (manual load
// needed) see the canonical connection strings. Silent when .env is
// absent (CI sets env vars directly).
try {
  const text = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip surrounding quotes (matches dotenv behavior).
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
} catch {
  // .env not present (CI) — env vars come from elsewhere.
}

if (!globalThis.document) {
  GlobalRegistrator.register({ url: 'http://localhost:3000' });
}
