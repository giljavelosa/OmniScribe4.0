# OmniScribe Commercial-Launch Roadmap (LOCKED)

> **Sprint 0.20 — MFA removed.** Any reference to MFA, /mfa-challenge, /mfa-setup, TOTP, authenticator app setup, or login-verified gates in this document is HISTORICAL. Authentication is now password-only. See `context/specs/01-foundation-auth-tenant.md` and `progress-tracker.md`.


**Status:** Active. Locked 2026-05-05 by Gil.
**Goal:** Ship the scribe portion of OmniScribe commercially to existing customers in 5-7 weeks. Bundle UI redesign work with commercial-readiness work — every page touched gets the redesign-spec'd version. FHIR work parked (waiting on NextGen).
**Workflow mode (LOCKED):** Claude implements directly on feature branches, runs tests to green, drafts PRs. Gil reviews and merges every PR. Production deploys remain Gil's call.

## Brand name (LOCKED)
**OmniScribe** is the singular brand across product, code, comms, marketing.
Genscribe is being purged.
Single `APP_NAME` constant in `src/lib/brand.ts` after RD-0a.

## Phase sequence

### RD-0 — Foundation (Week 1)
The cheapest, lowest-risk, highest-leverage work in the sequence. Doesn't touch any protected systems (AssemblyAI/Soniox, BullMQ, SSE, review/sign shell).

- **RD-0a** Brand-name unification (Genscribe → OmniScribe, single APP_NAME constant, deprecate `x-genscribe-org-id` header)
- **RD-0b** Design tokens (type scale 6 steps, spacing scale 5 steps, status color tokens, speaker color tokens) + ESLint rules banning arbitrary `text-[Npx]` and arbitrary spacing values
- **RD-0c** `<StatusBadge>` shared component + replace all hardcoded amber/blue/green Tailwind status classes app-wide
- **RD-0d** `<Label>` shared component + replace all custom uppercase-tracked labels
- **RD-0e** `<AdminPageShell>` + `<AdminTable>` foundation components (no consumers yet — used by RD-1 onwards)

### RD-1 — Team admin page + commercial blockers (Weeks 2-3)
- Apply `<AdminPageShell>` to `(admin)/users` per redesign spec Phase 11
- Real table replacing inline cards
- Filter chips (Status, Role)
- Sheet-based edit (replacing inline edit)
- AlertDialog for destructive actions (replacing native confirm())
- **Add MFA reset action** (commercial blocker)
- **Add password reset action** (commercial blocker)
- **Pick auth model: commit to `TeamMembership`** (technical hygiene)
- Audit logging on all admin actions (rule 8)

### RD-2 — Sites page completion + AdminPageShell (Week 3)
- Apply `<AdminPageShell>` + `<AdminTable>` to `(admin)/sites`
- **Complete edit/delete + room CRUD** (commercial blocker — currently STUBBED)
- Department-site relationship UI

### RD-3 — Other tenant admin pages (Weeks 3-4)
- Apply `<AdminPageShell>` to seats, billing, voice, documentation, manage-templates
- New `/admin/audit` page so org admins can see their own audit log

### RD-4 — Owner console redesign + BAA tracking (Weeks 4-5)
- Split single `/owner` page into:
  - `/owner` — dashboard
  - `/owner/organizations` — table view with filters and sortable columns
  - `/owner/support` — support queue
  - `/owner/commercial` — MRR breakdown, churn cohorts, expansion candidates, trial-conversion funnel
  - `/owner/[orgId]` — tenant detail page (NEW, doesn't exist today)
- Replace administrative-gap metrics with SaaS metrics (Active orgs, MRR, Trials ending this week, Support backlog, Total seats sold + utilization)
- Purple-toned mode pill in breadcrumb (distinct from teal Org Admin pill)
- **Schema migration: BAA tracking** (`baaExecutedAt`, `baaVersion`, `baaCountersignedBy`, `complianceProfile` enum) on `Organization` model
- Surface BAA fields in `/ops/dashboard/organizations` create + edit + list

### RD-5 — Customer self-onboarding wizard (Weeks 5-6)
- Invite-acceptance landing page
- Password set flow (with password strength meter)
- MFA enrollment wizard (TOTP via authenticator app, with QR code + setup key)
- First-login org-setup checklist (sites, departments, first clinician invites)

### RD-6 — Goal tracking investigation + harden (Weeks 6-7)
- Investigate current state of goal tracking from internal notes (no FHIR)
- Identify gaps between current state and what commercial customers need
- Implement what's missing
- Verify goal extraction works for new customers (zero prior notes) bootstrapping forward

### RD-7 — Final polish + clinician sign-off (Week 7)
- Run full accessibility pass on the four screens a clinician sees during one encounter (Login, Drafts, Capture, Processing)
- Fix sheet-inside-sheet on capture per critique
- Replace native `confirm()` calls with AlertDialog everywhere
- Brand-name purge verification (zero "Genscribe" remaining anywhere)
- Bug bash and final QA

## Cursor-task slot reservation
- 50 — RD-0a (brand unification)
- 51 — RD-0b (design tokens)
- 52 — RD-0c (StatusBadge)
- 53 — RD-0d (Label)
- 54 — RD-0e (AdminPageShell + AdminTable)
- 55 — RD-1 (Team admin page + MFA/password reset)
- 56 — RD-2 (Sites completion + room CRUD)
- 57-59 — RD-3 (other tenant admin pages, sliced as needed)
- 60-63 — RD-4 (owner console + BAA tracking)
- 64-66 — RD-5 (customer self-onboarding)
- 67-68 — RD-6 (goal tracking)
- 69-70 — RD-7 (polish)

(Note: with workflow mode 1 locked, cursor-tasks become *reference numbers* for tracking — Claude implements directly rather than handing tasks to a Cursor agent.)

## Anti-regression rules in scope (per CLAUDE.md)
1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19 — all apply.
Particular vigilance:
- Rule 6 (LLM abstraction layer) — no AI calls outside `src/services/llm/`
- Rule 8 (audit log writes) — never silently swallow errors
- Rule 9 (3-tap test) — clinical screens
- Rule 16 (`dev:workers` running) — required for end-to-end flows
- Rule 18 (single BullMQ fleet) — no double polling
- Founder rule: don't modify AssemblyAI/Soniox integration, BullMQ queues, SSE layer, or review/sign shell components without explicit instruction

## Out of scope for this roadmap
- FHIR phases (F1-F6) — blocked on NextGen
- Phase 14 Templates (template editing, section reordering, custom-section addition) — explicit deferral per Phase 04 locked decisions
- Phase 04 follow-ups (per-clinician regenerate rate-limiting, edit-debounce timing, failure-state recovery across reload)
- WebAuthn / passkeys (TOTP acceptable for v1)
- In-app pricing / discount / setup-fee configuration (intentionally narrow per `/owner/` console copy)

## How to revisit this doc
- After every RD-N PR merges, update the phase status here
- If scope shifts, version this file (`commercial-launch-roadmap-v2.md`) — do not silently rewrite
- Cross-reference: `audit-admin-state-of-play.md` for the audit findings and `memory/commercial-readiness-backlog.md` for the broader memory note + design archive pointers
