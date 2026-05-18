# Kickoff Prompts

Copy-paste prompts to start (and continue) an AI-coding-agent session against this kit. Works with Claude Code, Cursor, Codex, GitHub Copilot Chat, or any modern AI coding agent that can read files in the repo.

> First time on this repo? Start with [`README.md`](README.md) for orientation, then come back here when you're ready to put an agent to work.

## Which prompt when

| Moment | Use |
|---|---|
| First-ever session after clone | **Prompt A** — primary kickoff |
| Starting Unit 02, 03, 04, … (after a unit ships) | **Prompt B** — start next unit |
| Returning after a break (mid-unit or between units) | **Prompt C** — cold resume |
| You trust the kit and want minimum prose | **Prompt D** — ultra-minimal |

---

## Prompt A — Primary kickoff (cold start, first session)

```
I just cloned the OmniScribe Greenfield Implementation Kit
(https://github.com/giljavelosa/OmniScribe4.0). This is a complete
handoff kit for building OmniScribe — a HIPAA-grade medical AI scribe
with an agentic clinical copilot — from a clean slate. Everything you
need is in this repo. There is no prior code to inherit.

Before writing any code:

1. Read CLAUDE.md (your operating rules for this build; or AGENTS.md if
   you're not Claude Code — they're identical).
2. Read journeys/02-typical-visit.md — the heart of the product. If you
   understand this one journey, you understand OmniScribe.
3. Read these in order (~30 min total): context/project-overview.md,
   context/architecture.md, context/ui-context.md,
   context/code-standards.md, context/ai-workflow-rules.md,
   context/progress-tracker.md.
4. Read context/specs/00-build-plan.md to see the unit sequence.
5. Read context/specs/01-foundation-auth-tenant.md — the first unit.

Then propose a step-by-step plan to:
(a) Set up the local dev environment per context/architecture.md
    "Local Development" section (Docker compose for Postgres+Redis,
    Prisma migrate, seed, npm run dev + npm run dev:workers).
(b) Initialize a Next.js 16 + React 19 + TypeScript strict project
    matching the System Boundaries in context/architecture.md.
(c) Implement Unit 01 exactly as specified in
    context/specs/01-foundation-auth-tenant.md.

Hard constraints (the kit calls these "anti-regression rules" — there
are 24 in context/architecture.md Invariants section; read them all):
- Never bypass the LLM PHI guard (assertProviderAllowedForPHI).
- Never modify a signed note's finalJson after sign.
- Audit log writes never wrapped in silent try/catch.
- Use design tokens (OKLCH custom properties), never hardcoded hex
  values, in clinical/admin surfaces.
- Never run two BullMQ worker fleets against the same Redis.
- Three-lens evaluation (Clinician / Medicare Compliance Officer /
  Insurance Auditor) on every PR.
- 18 more rules — read them.

When you finish Unit 01, STOP. Summarize what's done, update
context/progress-tracker.md (move Unit 01 to Completed with date,
log any new architecture decisions or open questions), open a PR
titled `feat(unit-01): foundation auth & tenancy`, and wait for my
confirmation before starting Unit 02. Do NOT autonomously chain
through the build plan.

Ask clarifying questions before implementing anything ambiguous.
Don't invent product behavior, architecture, or visual decisions
that aren't in the context files.
```

---

## Prompt B — Start the next unit (after a unit ships)

```
Unit NN is complete and merged. Start Unit NN+1.

1. Read context/progress-tracker.md to confirm the prior unit is
   Completed and to see Open Questions.
2. Read context/specs/NN+1-<slug>.md — the unit you'll build.
3. Re-skim the journey file(s) that exercise the surface you're
   building (see the "Related references" section at the bottom of
   the unit spec).
4. Read any deep-dive references the unit spec cites.

Then implement Unit NN+1 exactly as specified. Same constraints as
last time — three-lens evaluation, audit logging on every PHI access,
orgId in every WHERE clause of every PHI query, no native confirm()
in clinical surfaces, no hardcoded status colors.

Stop when verified end-to-end and the unit's "Verify when done"
checklist is all green. Don't start the next unit.
```

---

## Prompt C — Cold resume (picking up after a break)

```
I'm picking up the OmniScribe build mid-stream. Read
context/progress-tracker.md and tell me:

- What unit is "In Progress"?
- What was the last completed work?
- Are there any Open Questions I need to resolve before continuing?
- What was the most recent Architecture Decision?
- What's the immediate next step?

Don't write any code yet — just orient me. Once I confirm I'm
oriented, we'll continue.
```

---

## Prompt D — Ultra-minimal (closest to "true vibe coding"; use with caution)

```
Read CLAUDE.md, then build OmniScribe by following
context/specs/00-build-plan.md starting at Unit 01. After each unit:
update context/progress-tracker.md, open a PR, then pause for my
confirmation before starting the next unit. Follow every rule in
CLAUDE.md and the 24 anti-regression invariants in
context/architecture.md. Three-lens evaluation on every PR.
```

---

## A note on vibe-coding medical software

OmniScribe is HIPAA-regulated. The kit is deliberately designed to slow the agent down at the right moments — 24 anti-regression rules, three-lens evaluation gate, "stop and ask if anything is ambiguous" rule in `context/ai-workflow-rules.md`, unit-by-unit build plan.

The right "vibe" here is:

> **You stay the architect. The agent executes your plan, one unit at a time, with audit trails at every step.**

Fully hands-off "agent builds while I sleep" mode is not appropriate for clinical software, and all four prompts above enforce stop-between-units. Resist the temptation to remove that constraint.

## Tips

- **Always open a PR per unit.** Even if you're the only engineer. The PR description is where the three-lens evaluation lives, and the PR diff is the artifact an auditor can review.
- **Update `context/progress-tracker.md` in the same PR as the code change.** Out-of-sync docs = next agent invents from scratch = drift.
- **If the agent starts inventing**, stop it and point at `context/ai-workflow-rules.md` "Handling Missing or Ambiguous Requirements" section. That section tells the agent exactly what to do when something is undefined (answer: stop and ask, don't guess).
- **For Unit 09 onward**, you (or the agent) write the spec file just-in-time using the template from `context/specs/01-foundation-auth-tenant.md`. The build plan tells you what's next; the methodology tells you how to spec it.
