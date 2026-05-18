#!/usr/bin/env node
/**
 * OmniScribe CDK app entrypoint.
 *
 * Synthesizes one stack per environment via CDK context. Default
 * deploy target is `dev`; override via `cdk deploy -c env=prod`.
 *
 * Each env reads its AWS account + region from CDK context OR
 * environment variables (CDK_DEFAULT_ACCOUNT, CDK_DEFAULT_REGION).
 * Sensitive values (DB passwords, API tokens) are NEVER hard-coded
 * here — they come from Secrets Manager refs the app reads at
 * runtime (Rule 14 from CLAUDE.md: never store secrets in AWS console
 * env vars; use Secrets Manager only).
 */

import * as cdk from 'aws-cdk-lib';
import { OmniScribeDataStack } from '../lib/data-stack';

const app = new cdk.App();

type EnvName = 'dev' | 'staging' | 'prod';

const envName = (app.node.tryGetContext('env') as EnvName | undefined) ?? 'dev';
const region =
  (app.node.tryGetContext('region') as string | undefined) ??
  process.env.CDK_DEFAULT_REGION ??
  'us-east-1';
const account =
  (app.node.tryGetContext('account') as string | undefined) ??
  process.env.CDK_DEFAULT_ACCOUNT;

if (!account) {
  // eslint-disable-next-line no-console
  console.warn(
    'No AWS account specified. Set CDK_DEFAULT_ACCOUNT env var or `-c account=NNNNNNNN`.',
  );
}

new OmniScribeDataStack(app, `OmniScribeData-${envName}`, {
  env: { account, region },
  envName,
  // Production deletion-protection is non-overridable from here —
  // the stack enforces it based on envName. dev/staging stacks can
  // be torn down with `cdk destroy`.
  description: `OmniScribe data plane (${envName}): Postgres + Redis + S3 + Secrets`,
  tags: {
    Project: 'OmniScribe',
    Environment: envName,
    ManagedBy: 'cdk',
  },
});

app.synth();
