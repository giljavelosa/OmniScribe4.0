# Commercial deployment checklist (OmniScribe)

Use before pointing production traffic at a new environment or going live with a paying HIPAA customer. Adapt per hosting choice (AWS App Runner / ECS / Vercel hybrid per `CLAUDE.md`).

## Environment & secrets

- [ ] **Database:** PostgreSQL (RDS or equivalent), encrypted, backups enabled, least-privilege DB user for app.
- [ ] **Redis:** Dedicated instance for BullMQ; **never** run two worker fleets against the same Redis (CLAUDE.md rule 18).
- [ ] **Secrets:** Production secrets in **Secrets Manager** (or provider equivalent), not plaintext console env vars.
- [ ] **Soniox:** `SONIOX_API_KEY` server-only; non-dev: `SONIOX_BAA_ON_FILE=true` and confirmed BAA on file (rule 17).
- [ ] **Bedrock:** Region + inference profile IDs with `us.` prefix where required; long-term key via `AWS_BEARER_TOKEN_BEDROCK` **not** mistaken for SigV4 IAM keys (`CLAUDE.md`).
- [ ] **S3:** Bucket blocks public access; presigned URLs only.

## Application topology

- [ ] **Web app** deployed (e.g. App Runner / Vercel) with production `NEXTAUTH` / auth URLs correct.
- [ ] **Workers** deployed (`npm run dev:workers` equivalent in prod) — transcription finalize, AI generation, voice-id, note-finalize queues **must** run or notes stall in DRAFTING (rule 16).
- [ ] **Single worker fleet** per Redis — drain old fleet before starting new (rule 18).

## Compliance & contract

- [ ] **Downstream BAA** executed with customer; record in ops **BAA** dialog (`baaExecutedAt`, version, countersigner, `complianceProfile`).
- [ ] **Upstream BAAs** current for AWS, Soniox, and any other PHI subprocessors.
- [ ] **Support access** policy documented (impersonation / owner support mode if used).

## Post-deploy verification

- [ ] Smoke: login → create patient → note → capture → finalize → AI completes → review → sign.
- [ ] Redis outage / cap reset: after provider recovery, **force new ECS deployment** if workers silent (rule 19).
- [ ] Monitoring: errors and queue depth observable (logs/metrics); alerts for worker failures.

## Customer cutover

- [ ] Demo seed **not** applied to production.
- [ ] Org provisioned with correct division, seats, and admin invite/password flow tested.
- [ ] MFA expectation communicated to customer security contact.
