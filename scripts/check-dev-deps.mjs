#!/usr/bin/env node
// Preflight check for local-dev services: Postgres + Redis via Docker.
// Uses the `docker exec` CLI so no npm deps are needed — runs even before `npm install`.
//
// Exit 0 = both healthy. Exit 1 = something missing/unhealthy with a friendly hint.

import { spawnSync } from 'node:child_process';

const POSTGRES_CONTAINER = 'omniscribe-postgres';
const REDIS_CONTAINER = 'omniscribe-redis';
const REDIS_PASSWORD = 'localpassword';

function run(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8' });
}

function checkDocker() {
  const r = run('docker', ['--version']);
  if (r.status !== 0) {
    console.error('✗ docker CLI not found.');
    console.error('  Install Docker Desktop and retry: https://www.docker.com/products/docker-desktop');
    process.exit(1);
  }
}

function checkContainer(name) {
  const r = run('docker', ['inspect', '-f', '{{.State.Running}}', name]);
  if (r.status !== 0 || r.stdout.trim() !== 'true') {
    console.error(`✗ container "${name}" not running.`);
    console.error('  Did you `docker compose up -d`?');
    process.exit(1);
  }
}

function checkPostgres() {
  const r = run('docker', ['exec', POSTGRES_CONTAINER, 'pg_isready', '-U', 'omniscribe', '-d', 'omniscribe_dev']);
  if (r.status !== 0) {
    console.error('✗ postgres not accepting connections.');
    console.error(`  stdout: ${r.stdout.trim()}`);
    console.error(`  stderr: ${r.stderr.trim()}`);
    process.exit(1);
  }
  console.log('✓ postgres ready');
}

function checkRedis() {
  const r = run('docker', ['exec', REDIS_CONTAINER, 'redis-cli', '-a', REDIS_PASSWORD, 'ping']);
  if (r.status !== 0 || !r.stdout.includes('PONG')) {
    console.error('✗ redis not responding to PING.');
    console.error(`  stdout: ${r.stdout.trim()}`);
    console.error(`  stderr: ${r.stderr.trim()}`);
    process.exit(1);
  }
  console.log('✓ redis ready');
}

checkDocker();
checkContainer(POSTGRES_CONTAINER);
checkContainer(REDIS_CONTAINER);
checkPostgres();
checkRedis();
console.log('✓ local dev services healthy — `npm run dev` + `npm run dev:workers` are good to go');
