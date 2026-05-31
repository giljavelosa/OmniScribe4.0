# OmniScribe — Agent Entry Point

> Read this file at the start of every session. Then read the context files in order. This is a **greenfield build** — there is no prior codebase to inherit. Build toward the design described in this kit.

You are an AI coding agent working on **OmniScribe**, a HIPAA-grade medical AI scribe with an agentic clinical copilot. Medical software has regulatory and patient-safety stakes. Discipline matters more than speed.

## Read in this order — every session

1. **[`journeys/02-typical-visit.md`](journeys/02-typical-visit.md)** — the heart of the product; understand the user's experience first
2. **[`context/project-overview.md`](context/project-overview.md)** — what OmniScribe is, who uses it, what's in scope, what's not
3. **[`context/architecture.md`](context/architecture.md)** — stack, system boundaries, data model, storage, auth, AI/queue model, deployment topology, invariants
4. **[`context/ui-context.md`](context/ui-context.md)** — design tokens, typography, components, layout patterns, brand
5. **[`context/code-standards.md`](context/code-standards.md)** — TypeScript, Next.js, Prisma, API routes, LLM, transcription, BullMQ, audit, testing, commit conventions
6. **[`context/ai-workflow-rules.md`](context/ai-workflow-rules.md)** — how you (the agent) must behave: scoping, when to split, missing requirements, verification
7. **[`context/progress-tracker.md`](context/progress-tracker.md)** — current phase, completed units, in-progress units, open questions, architecture decisions

Then for the current unit:

8. **[`context/specs/00-build-plan.md`](context/specs/00-build-plan.md)** — confirm which unit and its dependencies
9. **[`context/specs/NN-<slug>.md`](context/specs/)** — the spec for the current unit
10. **Any [`journeys/`](journeys/) file** that exercises the user-facing surface of the unit
11. **Relevant [`references/`](references/) deep dives** — `encounter-copilot-spec`, `fhir-integration-spec`, etc.

## Update `context/progress-tracker.md` after every meaningful change

The progress tracker is the only file in `context/` that changes constantly. Move completed units to Completed (with date + PR link). Add new in-progress units. Append architecture decisions with the reason. Log open questions. Leave session notes for the next agent. Do this **in the same PR** as the code change.

## If implementation changes the architecture, scope, standards, or visual language

Update the relevant context file **before** continuing to code on top of the new reality. Docs out of sync = future agents invent from scratch = drift.

## Three-lens evaluation, every feature

Apply on every PR. Adapted from medical-product-management discipline.

1. **Clinician** — would a licensed provider trust this with their license? Document this way? Work this way?
2. **Medicare Compliance Officer** — would this establish medical necessity + skilled care and survive a MAC audit?
3. **Insurance Auditor** — is provenance traceable? Could an auditor reconstruct the visit?

Document the evaluation in the PR description. If any lens fails, the feature is not done.

## Anti-regression rules (the law — never violate)

The build inherits these rules from day one. They live in [`context/architecture.md`](context/architecture.md) Invariants section. Summary:

1. NEVER remove or rename existing Prisma models without a migration.
2. NEVER change `NoteStatus` enum values — append only.
3. NEVER modify a signed note's `finalJson` — immutable; addenda are distinct records.
4. ALWAYS run `npx prisma db seed` after schema changes.
5. ALWAYS verify file existence after creating files (S3 upload verification).
6. NEVER remove the LLM abstraction — all AI calls through `src/services/llm/`.
7. Audio files NEVER deleted from S3 — soft-delete in DB only.
8. Audit log writes NEVER wrapped in try-catch that swallows errors.
9. Clinical screens must pass the "3-tap test" before merging.
10. BullMQ jobs MUST have retry logic — 3 retries, exponential backoff.
11. NEVER call the Soniox SDK directly from app code — go through `src/services/transcription/`. Browser WS bootstrapped via `/api/notes/[id]/realtime-key` so the long-lived key never leaves the server.
12. Soniox real-time configs MUST keep `enable_speaker_diarization: true` and `audio_format: "pcm_s16le"`.
13. NEVER use AWS access keys in production — use IAM roles.
14. NEVER store secrets in AWS console env vars — use Secrets Manager only.
15. S3 bucket public access MUST ALWAYS be blocked — presigned URLs only.
16. `npm run dev:workers` MUST be running for any flow that ends in a generated note.
17. Any non-dev environment processing PHI MUST set `SONIOX_BAA_ON_FILE=true` AND have a current Soniox BAA on file.
18. NEVER run two BullMQ worker fleets against the same Redis simultaneously.
19. After any Redis recovery event, force a fresh ECS deployment.
20. Copilot reads only SIGNED/TRANSFERRED notes, clinician-confirmed FollowUp rows, verified FHIR resources, and clinician-verified document ExternalContext rows (`verifiedAt != null`). Never drafts. Never unverified OCR/extraction rows. Never inferences beyond source.
21. Three-lens evaluation on every PR.
22. No native `confirm()` or `alert()` in clinical surfaces — use `<AlertDialog>`.
23. No hardcoded status colors — use `<StatusBadge>` / `<StatusBanner>`.
24. Copilot cards never make clinical recommendations — data only; actions require explicit clinician initiation + confirmation.

## How to start a unit

1. Confirm the unit number in [`context/specs/00-build-plan.md`](context/specs/00-build-plan.md).
2. Open the unit's spec file. If it doesn't exist (units 09+), draft it with the user first.
3. Open the relevant journey + reference deep dive for the surface you're building.
4. Mark the unit "In Progress" in `context/progress-tracker.md`.
5. Implement exactly the spec — no more, no less.
6. Verify against the unit's `Verify when done` checklist + the global checklist in `context/ai-workflow-rules.md`.
7. Open a PR titled `feat(unit-NN): <slug>` with what / why / verify / three-lens in the description.
8. Update `context/progress-tracker.md` to move the unit to Completed.

## How to ask the user

When you must stop and ask:
- Be specific. Cite the source of the ambiguity. Offer options if 2–4 paths are equally valid.
- Don't ask permission for safe, reversible work.
- Ask when the action is risky, irreversible, or ambiguous.
