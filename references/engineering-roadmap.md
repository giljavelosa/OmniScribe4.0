# Engineering roadmap

**For:** OmniScribe redesign · sprint-by-sprint execution plan
**Owner:** Gil
**Last updated:** April 30, 2026

This file is the master plan. Each sprint references a detailed task file in `cursor-tasks/` that you can open in a fresh Cursor session — those files are scoped, self-contained, and include the file references Cursor needs to ground its work.

## How to use this with Cursor AI

Cursor's @-mention syntax lets it read referenced files into context. The flow is:

1. **Open Cursor in the project root.**
2. **Pick a task file** from `cursor-tasks/` (start with `00-foundation.md`).
3. **Paste the task into a Cursor chat** with the @-mentions intact (or open the file and reference it via `@cursor-tasks/00-foundation.md`).
4. **Let Cursor draft the changes.** It will use the referenced files as context.
5. **Review against the acceptance criteria** in the task file before merging.

Cursor works best when each task is one cohesive change set — typically a single sprint's worth or smaller. Don't paste the entire roadmap into one Cursor session; it'll lose focus. Keep one task = one Cursor session.

## Anti-patterns Cursor should avoid (reference these in every prompt)

These map to existing project rules — repeat them in any task you give Cursor:

- Never call AssemblyAI or transcription providers directly. Always go through `src/services/transcription/`.
- Never call AI models directly. Always go through `src/services/llm/`.
- Never use native `confirm()`. Always use `<AlertDialog>` from `src/components/ui/dialog.tsx`.
- Never use hardcoded Tailwind palette classes for status (`bg-blue-50`, `bg-amber-100`, etc.). Use design tokens (`--status-success`, `--status-warning`, `--status-danger`, `--status-info`).
- Never reproduce the same status pattern in multiple places. Use the shared `<StatusBadge>` / `<StatusBanner>` components built in Phase 0.
- Never break the LLM abstraction layer. Note generation must go through `src/services/llm/`.
- Audit log writes are never wrapped in silent try-catch.
- BullMQ jobs must have retry logic (3 retries, exponential backoff).

## Sprint sequence (tier-ordered)

### Tier 1 — Foundation + visible wins

| Sprint | Phase | Task file | Effort |
|---|---|---|---|
| 1 | Foundation | `cursor-tasks/00-foundation.md` | 1 sprint |
| 1–2 | Health monitoring | `cursor-tasks/00-foundation.md` (sub-task) | ½ day |
| 2 | Quick visible wins | `cursor-tasks/01-quick-wins.md` | 1 sprint |

### Tier 2 — Core experience

| Sprint | Phase | Task file | Effort |
|---|---|---|---|
| 3–4 | Capture refactor (gating) | `cursor-tasks/02-capture-refactor.md` | 2 sprints |
| 5 | Move setup to prepare screen | `cursor-tasks/03-setup-to-prepare.md` | 1 sprint |
| 6 | Section progress + per-section regenerate | `cursor-tasks/04-section-progress.md` | 1 sprint |
| 7–8 | Review screen redesign + AI alerts | `cursor-tasks/05-review-redesign.md` | 2 sprints |
| 9 | Flag review panel polish (antihallucination) | `cursor-tasks/06-flag-review.md` | 1 sprint |
| 10 | Drafts list (triage-first) | `cursor-tasks/07-drafts-list.md` | 1 sprint |
| 11 | Home / patient picker | `cursor-tasks/08-home-redesign.md` | 1 sprint |
| 12 | Tablet/desktop split bonuses | `cursor-tasks/09-responsive-bonuses.md` | 1 sprint |

### Tier 3 — Trust + onboarding

| Sprint | Phase | Task file | Effort |
|---|---|---|---|
| 13 | Auth flow polish (password login, magic link) | `cursor-tasks/10-auth-flow.md` | 1 sprint |
| 14 | Sign / signature flow (biometric, attestation) | `cursor-tasks/11-sign-flow.md` | 1 sprint |
| 15–16 | Marketing / signup landing | `cursor-tasks/12-marketing-landing.md` | 2 sprints |

### Tier 4 — Patient + admin surfaces

| Sprint | Phase | Task file | Effort |
|---|---|---|---|
| 17–18 | Patient detail (medical + rehab variants) | `cursor-tasks/13-patient-detail.md` | 2 sprints |
| 19–20 | Templates manage + editor with live preview | `cursor-tasks/14-templates.md` | 2 sprints |
| 21–22 | Admin dashboard + Team page | `cursor-tasks/15-admin-team.md` | 2 sprints |
| 23 | Remaining admin pages (Sites · Seats · Voice · Billing · Audit) | `cursor-tasks/16-admin-pages.md` | 1 sprint |

### Tier 5 — Platform-level

| Sprint | Phase | Task file | Effort |
|---|---|---|---|
| 24–25 | Owner Console (multi-tenant) | `cursor-tasks/17-owner-console.md` | 2 sprints |
| 26–27 | Ops Console (internal staff) | `cursor-tasks/18-ops-console.md` | 2 sprints |
| 28–31 | Telehealth video visits | `cursor-tasks/19-telehealth.md` | 4 sprints |

## Dependency map

Read top to bottom — anything below depends on the things above it.

```
Sprint 1: Phase 0 Foundation
   │
   ├─► Sprint 2: Phase 1 Quick wins   (visible polish on existing screens)
   │
   ├─► Sprints 3–4: Phase 2 Capture refactor    (BLOCKS most clinical work)
   │       │
   │       ├─► Sprint 5: Phase 3 Setup → Prepare
   │       ├─► Sprint 6: Phase 4 Section progress
   │       ├─► Sprints 7–8: Phase 5 Review redesign
   │       │       └─► Sprint 9: Phase 12 Flag review polish
   │       └─► Sprint 12: Phase 6 Responsive bonuses
   │
   ├─► Sprint 10: Phase 7 Drafts list
   ├─► Sprint 11: Phase 8 Home redesign
   ├─► Sprints 13–14: Phase 13 Auth + Phase 14 Sign
   └─► Sprints 17+: Tier 4 (admin / patient detail) — independent of capture refactor
```

## What to ship if budget is tight (the minimum credible v1)

Cut everything in Tier 5 and most of Tier 4. Ship: Phases 0, 1, 2, 3, 4, 5, 7, 8, 12, 13, 14. Roughly **16 sprints = 8 months of work for 2 engineers**.

After this minimum, customer signal should drive the next priorities — not the document.

## Files in this redesign

- `design-redesign-spec.md` — full design spec for all 19 phases
- `design-mockups.html` — visual mockups (open in browser, 19 sections)
- `design-critique.md` — original full-app design audit
- `design-critique-capture-flow.md` — capture flow deep dive
- `telehealth-architecture-spec.md` — backend architecture for Phase 19
- `engineering-roadmap.md` — this file
- `cursor-tasks/` — per-phase task files for Cursor AI execution
- `src/app/api/healthcheck/route.ts` — health check endpoint (Whisper-aware)
