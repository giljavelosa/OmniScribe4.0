# OmniScribe

> HIPAA-grade medical AI scribe with an integrated agentic clinical copilot.

## Implementation status

- **Phase:** Wave 0 — Foundation. Unit 01 (Foundation Auth & Tenancy) in progress.
- **Stack pins:** Next.js 16 (App Router) + React 19 + TypeScript strict, Prisma 7 + Postgres 16 + pgvector, Redis 7 + BullMQ 5, NextAuth v5 + MFA TOTP, AWS Bedrock (Sonnet 4.5 / Haiku 4.5), Soniox real-time STT.
- **Live ledger:** [`context/progress-tracker.md`](context/progress-tracker.md).

## Local-dev quickstart

```bash
# Prerequisites: Node 20+, Docker Desktop, openssl

cp .env.example .env
# Fill NEXTAUTH_SECRET with: openssl rand -base64 32

docker compose up -d                # postgres (host 5433) + redis (host 6380)
docker compose ps                   # both services should be "healthy"

npm install                         # postinstall runs `prisma generate`
npx prisma migrate dev --name init  # creates schema + runs seed
npx prisma studio                   # browse seeded org / users (optional)

# Two terminals — rule 16: workers process transcription, AI, voice-id, brief.
# Without `dev:workers`, notes stick in DRAFTING forever.
npm run dev                         # Terminal 1 — Next.js on localhost:3000
npm run dev:workers                 # Terminal 2 — BullMQ workers
```

Demo credentials seeded by `prisma db seed`:

| Email                    | Role         | Password    | MFA |
|--------------------------|--------------|-------------|-----|
| `admin@demo.local`       | SUPER_ADMIN  | `Demo1234!` | enrolled (see `docs/SEED_CREDENTIALS.md`) |
| `clinician@demo.local`   | CLINICIAN    | `Demo1234!` | enroll on first sign-in |
| `viewer@demo.local`      | VIEWER       | `Demo1234!` | enroll on first sign-in |
| `siteadmin@demo.local`   | SITE_ADMIN   | `Demo1234!` | enroll on first sign-in |
| `owner@demo.local`       | PLATFORM_OWNER | `Demo1234!` | enroll on first sign-in |

## Building the next unit

Open `KickOffPrompts.md`. Prompt B is the canonical "start the next unit" prompt — paste into your AI coding agent and let it work the spec. Stop between units (per Prompt A's contract — clinical software).

---

# Greenfield Implementation Kit (handoff document below)

> A self-contained handoff kit for a senior engineer and implementation team to build **OmniScribe** — a HIPAA-grade medical AI scribe with an integrated agentic clinical copilot — **from a clean slate**. No prior codebase required, no inherited bugs, no migration baggage.

This kit describes OmniScribe as a finished, polished, real-life application. Every screen, every interaction, every behind-the-scenes data flow is documented. The implementation team builds *toward* this description.

---

## Two ways to read this kit

**As a product owner** — start with [`journeys/`](journeys/). Eight user journeys describe what real users do, in real situations, with real reactions. Read them in order — by the end you'll have the product in your head.

**As an engineer about to build it** — start with this file, then [`CLAUDE.md`](CLAUDE.md) (or [`AGENTS.md`](AGENTS.md)) for the entry-point rules, then [`context/`](context/) for the six methodology files, then [`context/specs/`](context/specs/) for unit-by-unit build specs. Use [`references/`](references/) when you need a deep dive on a specific subsystem.

---

## Read in this order (engineer cold-start, ~45 min)

1. **This file** — orientation
2. **[`glossary.md`](glossary.md)** — terms: PHI, BAA, FHIR, SOAP, BIPA, pgvector, diarization, Rule-20 attested, three-lens evaluation
3. **[`CLAUDE.md`](CLAUDE.md)** (or [`AGENTS.md`](AGENTS.md)) — entry-point rules for your AI coding agent
4. **[`journeys/02-typical-visit.md`](journeys/02-typical-visit.md)** — the heart of the product; if you understand this journey, you understand OmniScribe
5. **[`context/project-overview.md`](context/project-overview.md)** — what OmniScribe is, who uses it, what's in scope, what's not
6. **[`context/architecture.md`](context/architecture.md)** — stack, system boundaries, data model, storage, auth, AI/queue model, deployment, invariants
7. **[`context/ui-context.md`](context/ui-context.md)** — design tokens, typography, components, brand. The visual law.
8. **[`context/code-standards.md`](context/code-standards.md)** — TypeScript, Next.js, Prisma, API routes, LLM, transcription, BullMQ, audit, testing
9. **[`context/ai-workflow-rules.md`](context/ai-workflow-rules.md)** — how an AI coding agent must behave in this build
10. **[`screens.md`](screens.md)** — every screen with route, purpose, layout, key elements
11. **[`context/specs/00-build-plan.md`](context/specs/00-build-plan.md)** — ordered unit list, 8 weeks to minimum credible v1, then ongoing
12. **[`context/specs/01-foundation-auth-tenant.md`](context/specs/01-foundation-auth-tenant.md)** — first build unit; spec template you'll use for new units

---

## Folder map

```
OmniScribe-Greenfield-Kit/
├── README.md                                  ← you are here
├── CLAUDE.md                                  ← entry point for Claude Code
├── AGENTS.md                                  ← entry point for Codex / Copilot / Cursor
├── glossary.md                                ← terms
├── screens.md                                 ← every screen, one-paragraph each
│
├── journeys/                                  ← USER PERSPECTIVE (8 walkthroughs)
│   ├── 01-clinician-first-day.md
│   ├── 02-typical-visit.md                    ← read this first
│   ├── 03-returning-patient-with-brief.md
│   ├── 04-section-regenerate.md
│   ├── 05-copilot-ask-mode.md
│   ├── 06-telehealth-visit.md
│   ├── 07-admin-onboards-a-clinic.md
│   └── 08-templates-and-styles.md
│
├── context/                                   ← SIX-FILE METHODOLOGY (build rules)
│   ├── project-overview.md
│   ├── architecture.md
│   ├── ui-context.md
│   ├── code-standards.md
│   ├── ai-workflow-rules.md
│   ├── progress-tracker.md                    ← starts empty (Phase: Not Started)
│   └── specs/
│       ├── 00-build-plan.md                   ← 37 units across 7 waves
│       ├── 01-foundation-auth-tenant.md
│       ├── 02-patient-and-schedule.md
│       ├── 03-capture-recording.md
│       ├── 04-transcription-pipeline.md
│       ├── 05-note-generation-and-sign.md
│       ├── 06-prior-context-brief.md
│       ├── 07-encounter-copilot-watch-v0.md
│       └── 08-admin-and-compliance-ready.md
│
└── references/                                ← SELF-CONTAINED DEEP DIVES
    ├── encounter-copilot-spec.md              ← agentic copilot architecture
    ├── fhir-integration-spec.md               ← SMART on FHIR, 6 phases
    ├── telehealth-architecture-spec.md        ← Daily.co, 4 phases
    ├── prior-context-brief-spec.md
    ├── prior-context-brief-prompt.md          ← LLM prompt for brief
    ├── prior-context-brief-ui-spec.md
    ├── patient-detail-spec.md
    ├── patient-detail-ui-spec.md
    ├── section-progress-spec.md
    ├── section-progress-ui-spec.md
    ├── audit-admin-state-of-play.md           ← admin commercial-readiness audit
    ├── design-redesign-spec.md                ← visual design across all screens
    ├── design-critique.md                     ← what to avoid (audit of v1 prototype)
    ├── design-critique-capture-flow.md        ← deep dive on capture-flow pitfalls
    ├── design-mockups.html                    ← open in browser for visual reference
    ├── engineering-roadmap.md                 ← original 31-phase sequence
    │
    ├── design-mockup-gap-analysis/            ← per-screen UI analysis
    │   ├── admin.md / auth.md / capture.md / drafts.md / home.md
    │   ├── owner.md / patient-detail.md / prepare.md / review.md
    │   └── templates.md / flag-review.md / README.md
    │
    └── strategic/                             ← commercial framing
        ├── four-pillars-commercial-charter.md
        ├── commercial-launch-roadmap.md
        ├── commercial-readiness-backlog.md
        ├── commercial-deploy-checklist.md
        └── hipaa-scribe-controls-matrix.md
```

Everything in this kit resolves inside the kit. You can zip it, email it, and the team can read it on a plane. No external dependencies on a "current repo" — there isn't one.

---

## What this kit assumes

- **Greenfield build.** A new repo. Empty `git log`. No legacy state.
- **Senior engineer + small team** (2–4 engineers, 1 designer, 1 product owner, 1 compliance reviewer).
- **HIPAA-regulated production target.** AWS-resident. BAA with every subprocessor (AWS, Soniox).
- **Three divisions on day one**: Medical, Rehabilitation, Behavioral Health. (Multi-division orgs supported.)
- **The implementation team writes additional spec files** for units 09–37 as they reach them. Eight foundation specs ship in this kit; the methodology template is in [`context/specs/01-foundation-auth-tenant.md`](context/specs/01-foundation-auth-tenant.md).

## What this kit does NOT contain

- **No code.** This is a design + spec kit. The team writes the code.
- **No production secrets.** Bring your own AWS account, Soniox BAA, Stripe account, Resend DNS.
- **No legal documents.** BAA templates, Privacy Policy, Terms, HIPAA Notice of Privacy Practices are out of scope; the kit specifies what the *product* must support, not the contracts themselves.
- **No marketing copy.** Outreach + sales material is referenced in `references/strategic/` but not authored here.

---

## Estimated build effort (rough)

For a 2–4 engineer team building toward minimum credible v1 (Wave 0 + 1 of the build plan):

| Wave | Units | Effort | Outcome |
|---|---|---|---|
| 0 — Foundation | 01–05 | 6–8 weeks | Sign-in → record → AI note → sign works end-to-end |
| 1 — Copilot foundation + commercial ready | 06–09 | 3–4 weeks | Prior-context brief + Watch v0 + commercial-readiness gates |
| **v1 ship** | | **9–12 weeks** | First paying customer can use the product |
| 2 — UX maturity | 10–14 | 4–6 weeks | Patient detail redesign, review polish, section regenerate UX |
| 3 — Telehealth | 15–18 | 4 weeks | Telehealth visits work |
| 4 — FHIR (NextGen first) | 19–24 | 3–6 months | EHR integration; copilot reads real chart |
| 5 — Copilot maturity | 25–31 | ongoing | Ask mode, action tools, research mode, reasoning chains |
| 6 — Platform + polish | 32–37 | ongoing | Owner/Ops console maturity, audit enrichment, PWA polish |

Build plan in [`context/specs/00-build-plan.md`](context/specs/00-build-plan.md) has the dependency graph.

---

## How to deliver this kit

```bash
cd /Users/gil/Downloads
zip -r OmniScribe-Greenfield-Kit.zip OmniScribe-Greenfield-Kit/
# email/share OmniScribe-Greenfield-Kit.zip
```

The recipient unzips into any folder, opens README.md, and starts reading.

---

## License + confidentiality

Proprietary. Treat as confidential. Do not distribute outside the implementation team and the OmniScribe owner without explicit permission.
