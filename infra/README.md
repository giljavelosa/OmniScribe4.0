# OmniScribe infrastructure (AWS CDK v2)

This directory contains the AWS CDK app that provisions OmniScribe's
data plane. It is **separate** from the application's root `package.json`
— the root install does not pull CDK dependencies. Ops engineers
install + run from here.

## What's provisioned (v1: data plane only)

- **VPC** — 2 AZs, public/private/isolated subnets; 1 NAT in dev/
  staging, 2 NATs in prod (for HA).
- **RDS Postgres 16** — t4g.micro (dev) / t4g.medium (prod), Multi-AZ
  in prod, deletion-protected in prod. pgvector ready (post-create
  `CREATE EXTENSION` runs during the app's first migration).
- **ElastiCache Redis 7.1** — t4g.micro (dev) / t4g.small (prod) with
  replica + Multi-AZ in prod. AUTH token in Secrets Manager. TLS in
  transit + at rest.
- **S3 audio bucket** — `omniscribe-audio-{env}-{account}`. Public
  access fully blocked (Rule 15). 90-day transition to IA. NEVER
  hard-deletes objects (Rule 7 — soft-delete only at the app layer).
- **Secrets Manager** — auto-generated `NEXTAUTH_SECRET` + Redis
  AUTH token + placeholder secrets for `AWS_BEARER_TOKEN_BEDROCK`,
  `SONIOX_API_KEY`, `RESEND_API_KEY`. Ops fills the placeholders
  before deploying compute.

## What's NOT in v1

- **Compute** (App Runner / ECS Fargate / EKS) — the decision needs
  ops + product alignment on scaling + cold-start posture. Lands in a
  follow-up stack consuming the outputs from this one.
- **CloudFront + WAF** — depends on compute choice + domain decisions.
- **Bedrock IAM role** — depends on the compute task role.
- **Cross-region replication** — DR posture TBD.

## Prerequisites

- AWS CLI configured (`aws configure` or `AWS_PROFILE`).
- CDK bootstrapped in the target region:
  `npx cdk bootstrap aws://ACCOUNT_ID/REGION`
- Node 20+ (the root project's `.nvmrc` covers it).

## Install + deploy

```bash
cd infra
npm install
npm run synth                                 # emit CloudFormation template
npm run diff -- -c env=dev                    # compare against deployed stack
npm run deploy -- -c env=dev                  # deploy to dev
```

Override account / region / env via CDK context:

```bash
npx cdk deploy -c env=prod -c account=123456789012 -c region=us-east-1
```

## Post-deploy: fill placeholder secrets

The data stack provisions empty placeholder secrets for the external
providers. Ops must fill them before deploying compute (or before
running the app against this stack):

```bash
aws secretsmanager put-secret-value \
  --secret-id /omniscribe/dev/bedrock-bearer-token \
  --secret-string "ABSK..."

aws secretsmanager put-secret-value \
  --secret-id /omniscribe/dev/soniox-api-key \
  --secret-string "..."

aws secretsmanager put-secret-value \
  --secret-id /omniscribe/dev/resend-api-key \
  --secret-string "re_..."
```

> **Tripwire reminder** from the app's CLAUDE.md:
> `AWS_BEARER_TOKEN_BEDROCK` is the long-term API key (ABSK… format).
> Do NOT put it in `AWS_ACCESS_KEY_ID` — the SDK will try SigV4
> signing and Bedrock will reject with `UnrecognizedClientException`.
> The CDK stack creates a SEPARATE Secrets Manager entry for it.

## Post-deploy: install pgvector

The app's first Prisma migration runs `CREATE EXTENSION IF NOT EXISTS
vector` automatically. If you're spinning up RDS directly (without
running migrations yet), enable it manually:

```bash
psql "postgresql://omniscribe:...@<DbEndpoint>:5432/omniscribe" \
  -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

## Tear down (dev/staging only)

```bash
npm run destroy -- -c env=dev
```

Production stacks are deletion-protected. To tear them down: remove
the protection manually via the AWS console, then re-run destroy.

## Billing ops cron jobs (Unit 51 Group D)

Once the **compute stack** lands (ECS Fargate or similar), schedule
these npm scripts against the production app container:

| Schedule (UTC) | Command | Purpose |
|----------------|---------|---------|
| `0 6 1 * *` | `npm run billing:monthly-allowance` | Enterprise org banks — seats × visits/seat/month |
| `0 6 * * *` | `npx tsx scripts/billing-usage-report.ts` | Legacy draft overage → Stripe metered line |
| `15 6 * * *` | `npm run billing:visit-overage-report` | Visit-bank overage → Stripe `visit_overage` line |

Wire each as an **EventBridge rule → ECS RunTask** (or App Runner
job) with the same env + secrets as the web service. Exit code `1`
on partial failure is intentional — ops should review CloudWatch logs.

## Architecture decisions

- **CDK v2 in TypeScript**, not Terraform: matches the app's TS
  surface; shared lint/format conventions; CDK constructs map to the
  AWS-blessed paths for HIPAA-grade workloads (encryption at rest +
  in transit by default).
- **Data plane in its own stack** so compute can be experimented
  with (App Runner vs ECS Fargate) without churning the data
  resources. Compute stack will consume the data stack's outputs via
  `Fn::ImportValue`.
- **Per-env deployment via CDK context** (`-c env=prod`) rather than
  separate config files. Keeps the parameter surface small +
  introspectable via `cdk synth`.
- **deletion-protection + autoDeleteObjects driven by `envName`**.
  Prod is read-only from the CDK perspective: forces the operator to
  remove protection manually before `cdk destroy`, which is the
  intended friction for accidental teardowns.
