# Progress Tracker

> Update this file after every meaningful implementation change. This is the only file in `context/` that changes constantly; the others are stable.

## Current Phase

- **Not started.** Greenfield build. Empty repo. No code yet.

## Current Goal

- Stand up the local development environment (per `context/architecture.md` Local Development) — Postgres + Redis via docker-compose; `npx prisma migrate dev`; `npx prisma db seed`; `npm run dev` + `npm run dev:workers` running in two terminals.
- Then start **Unit 01 — Foundation Auth & Tenancy** (per `context/specs/01-foundation-auth-tenant.md`).

## Completed

None yet.

## In Progress

None yet.

## Next Up

In priority order:

1. **Local environment** — repo init, docker-compose up, dependency install, baseline `package.json` with required deps, Prisma init.
2. **Unit 01 — Foundation Auth & Tenancy** ([`context/specs/01-foundation-auth-tenant.md`](specs/01-foundation-auth-tenant.md)) — Org / Site / Room with BAA fields, NextAuth + MFA, password reset, `requireFeatureAccess` middleware, PHI scoping helpers.
3. **Unit 02 — Patient & Schedule Core** ([`context/specs/02-patient-and-schedule.md`](specs/02-patient-and-schedule.md)) — Patient + Encounter + Schedule + Episode + Department + Division model.
4. **Unit 03 — Capture & Recording** ([`context/specs/03-capture-recording.md`](specs/03-capture-recording.md)) — browser AudioWorklet + Soniox ephemeral key + capture page (built per design-critique findings from day one).
5. **Unit 04 — Transcription Pipeline** ([`context/specs/04-transcription-pipeline.md`](specs/04-transcription-pipeline.md)) — finalization + cleaning + voice-id fan-out + SSE status stream.
6. **Unit 05 — Note Generation & Sign** ([`context/specs/05-note-generation-and-sign.md`](specs/05-note-generation-and-sign.md)) — LLM abstraction + division prompts + section progress + review + sign + immutability + post-sign artifacts.
7. **Unit 06 — Prior-Context Brief** ([`context/specs/06-prior-context-brief.md`](specs/06-prior-context-brief.md)) — `NoteBrief` precompute + brief UI + `FollowUp` lifecycle.
8. **Unit 07 — Encounter Copilot Watch v0** ([`context/specs/07-encounter-copilot-watch-v0.md`](specs/07-encounter-copilot-watch-v0.md)) — beacon + open-follow-ups + plan-for-today cards.
9. **Unit 08 — Admin & Compliance Ready** ([`context/specs/08-admin-and-compliance-ready.md`](specs/08-admin-and-compliance-ready.md)) — Sites + Rooms CRUD, admin-initiated MFA reset + password reset, customer self-onboarding wizard, BAA admin UI.

That's Wave 0 + Wave 1 = minimum credible v1, ~9–12 weeks for a 2–4 engineer team.

After Wave 1: see `context/specs/00-build-plan.md` for Waves 2–6.

## Open Questions

These need user/PM decision before the depending unit can ship. Quote the source so context isn't lost.

1. **Authentication seed data** — what test users should `prisma db seed` create besides `admin@demo.local` and `clinician@demo.local`? Suggest: at least one VIEWER, one ORG_ADMIN, one SITE_ADMIN, and one PLATFORM_OWNER for owner-console testing. Decide before completing Unit 01.

2. **Default templates to seed** — which preset templates ship in the initial seed? Suggest: 2 per division (one for new-patient intake, one for established-patient progress) — total 6 CMS-default templates. Decide before completing Unit 05.

3. **Watch v0 card content scope** — Watch v0 includes both open-follow-ups + plan-for-today cards. Should they ship as one PR or sequentially? Recommend one PR (they share the same data source); decide before starting Unit 07.

4. **Telehealth provider** — Daily.co is recommended in `references/telehealth-architecture-spec.md`. Confirm before Wave 3 starts.

5. **FHIR SMART launch model** — provider-launched per-clinician or per-org for v1? Affects token storage shape + consent UX. Decide before Wave 4 (Unit 19).

6. **Default note style preference** — initial value for `OrgUser.preferredNoteStyle`. Suggest `HYBRID`. Decide before completing Unit 05.

7. **Customer self-onboarding wizard placement** — single 4-step wizard (recommended) or split across pages with progress bar? Decide before completing Unit 08.

8. **Public signup** — confirm out of scope for v1 (invite-only). If/when added later, requires `User.failedLoginAttempts` + `User.lockedUntil` fields + lockout policy.

## Architecture Decisions

Append-only log. Include date + source so future agents can trace the why. Pre-populated with foundational decisions from the kit's specs and references — confirm or revise on day one before coding starts.

- **2026-05-17 — Stack** — Next.js 16 App Router + React 19 + TypeScript strict + Tailwind v4 + shadcn/ui + Base UI + Prisma 7 + Postgres 16 + pgvector + Redis 7 + BullMQ + Soniox + AWS Bedrock (Sonnet 4.5 / Haiku 4.5) + NextAuth v5. Source: `context/architecture.md` Stack.
- **2026-05-17 — Soniox for transcription** — BAA-confirmed; real-time `stt-rt-v4` with PCM Int16 LE @ 16 kHz mono + diarization. No AssemblyAI fallback in v1 (can re-add later). Source: `context/architecture.md` Stack + `references/encounter-copilot-spec.md`.
- **2026-05-17 — Bedrock Sonnet 4.5 default LLM, Haiku 4.5 fallback** — cross-region inference profile (`us.` prefix). PHI guard blocks OpenAI/OpenRouter for PHI. Source: `context/architecture.md` LLM Abstraction.
- **2026-05-17 — Single Redis fleet per environment** (rule 18). Section regenerate uses `ai-generation` queue with discriminator, NOT a new queue. Source: `references/section-progress-spec.md`.
- **2026-05-17 — `Note.finalJson` immutable on sign** (rule 3). Addenda are `NoteArtifact` records. Source: `context/architecture.md` Invariants.
- **2026-05-17 — Brief precomputed on sign, not per render**. Cached in `NoteBrief` table (1:1 with signed note). Cost ~$0.05/brief. Source: `references/prior-context-brief-spec.md`.
- **2026-05-17 — Rule 20 attested sources only for copilot** — reads only SIGNED/TRANSFERRED notes, clinician-confirmed FollowUp, verified FhirCachedResource. Source: `references/encounter-copilot-spec.md`.
- **2026-05-17 — Multi-division model** — `Organization.division` + `Organization.defaultDivision` + per-episode override via `EpisodeOfCare.division`. Source: `context/project-overview.md`.
- **2026-05-17 — Video NEVER stored as artifact of record** — telehealth audio is processed and retained per S3 lifecycle; video is discarded after call. Note is the artifact. Source: `references/telehealth-architecture-spec.md`.
- **2026-05-17 — Three-lens evaluation as merge gate** — Clinician / Medicare Compliance Officer / Insurance Auditor. Documented in every PR. Source: `context/code-standards.md`.

## Session Notes

For the next agent picking up cold:

- **Start here**: read `README.md` → `CLAUDE.md` → `journeys/02-typical-visit.md`, then context files in order.
- **Strategic anchors**: [`references/strategic/four-pillars-commercial-charter.md`](../references/strategic/four-pillars-commercial-charter.md). Four pillars: Trust, Diagnosis Support, Workflow Integration, Clinician Autonomy.
- **Commercial-readiness backlog**: [`references/strategic/commercial-readiness-backlog.md`](../references/strategic/commercial-readiness-backlog.md). Most items are addressed by Wave 1.
- **HIPAA controls matrix**: [`references/strategic/hipaa-scribe-controls-matrix.md`](../references/strategic/hipaa-scribe-controls-matrix.md).

## How to Update This File

After every meaningful change:

1. **Move completed work** from "In Progress" → "Completed" with date + summary + reference to commit/PR.
2. **Add new in-progress items** under "In Progress" when starting a unit.
3. **Update "Current Goal"** if the focus shifts.
4. **Append to "Architecture Decisions"** when you make a decision that affects future work. Include date + source.
5. **Add to "Open Questions"** when you find ambiguity you can't resolve alone.
6. **Append to "Session Notes"** when leaving context for the next session.

Never delete history. This file is the audit log of the build.
