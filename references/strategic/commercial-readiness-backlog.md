# Commercial Readiness Backlog (Memory Note)

**Captured:** 2026-05-05
**Source:** Admin state-of-play audit run after Gil signaled intent to ship scribe-only commercially to existing customers.
**Full audit:** `audit-admin-state-of-play.md` (sibling file in repo root) — read that for evidence and citations.
**Status:** Deferred. Gil said "deal with that later" while finishing Phase 04 cluster + likely Phase 14 / FHIR work first.

---

## TL;DR for future-Gil

Both admin tiers are far more shipped than expected. Platform admin (`/ops/`, `/owner/`) is launch-ready. Team admin (`(admin)/`) has real CRUD across most surfaces but has 4 specific gaps that block first paying customer. Plan a 3-4 week commercial-readiness phase, not a 3-month rebuild.

## The four hard blockers

1. **Customer-side (downstream) BAA tracking on `Organization`.** Schema migration adds `baaExecutedAt`, `baaVersion`, `baaCountersignedBy`, `complianceProfile` enum. Surface in `/ops/dashboard/organizations` create + edit + list.
2. **MFA reset + password reset actions in `(admin)/users` edit form.** Today, locked-out clinicians require a database fix. Two buttons + two API routes + audit logging.
3. **Sites edit/delete + room CRUD in `(admin)/sites/page.tsx`.** Currently STUBBED — only create works. First customer address typo trips it.
4. **Pick one auth model and stop fork-coding.** Legacy `OrgUser.role + canManagePatients` and new `TeamMembership + MembershipFeatureGrant` tables both run in production with a `hasMembershipTables()` runtime check. Recommend: commit to `TeamMembership` (forward direction). Migration can come later — just stop adding new code that branches on the check.

## BAA layers — critical distinction

When the schema gap says "BAA tracking," it means **downstream** BAAs (between OmniScribe and each customer org), NOT upstream (between OmniScribe and vendors).

**Upstream BAAs (OmniScribe ← vendors):**
- AWS — signed (covers Bedrock, S3, RDS, ElastiCache, App Runner, ECS Fargate, CloudFront, Secrets Manager when used per AWS HIPAA Eligible Services list)
- Soniox — confirmed (CLAUDE.md enforces `SONIOX_BAA_ON_FILE=true` env flag)
- Anthropic — covered transitively through AWS Bedrock (no direct Anthropic API calls)
- AssemblyAI — parked emergency fallback; no BAA needed unless flipped on
- These are tracked externally (AWS Artifact, signed PDFs in Drive). Not part of the schema gap.

**Downstream BAAs (customer orgs ← OmniScribe):**
- LRCHC, customer #2, customer #N
- Each customer is a covered entity; OmniScribe is their business associate
- Each needs a separately tracked BAA execution
- This is what's missing from the `Organization` model

## Soft blockers (ship without, but feel pain in 30-60 days)

- Customer self-onboarding flow (today: operator creates org with admin → admin gets one-time password → admin signs in. No "accept invite, set password, enroll MFA" wizard.)
- Invoice history viewer in `(admin)/billing` (Stripe portal covers it for now)
- Audit log enrichment with before/after state (HIPAA covered-entity expectation; defer until customer compliance officer asks)
- Per-org LLM cost rollup in ops dashboard (cursor-task 28 territory)
- Account lockout fields (`loginAttempts`, `lockedUntil` absent; defer until public signup)

## Non-blockers (defer)

- WebAuthn / passkeys (TOTP acceptable v1)
- In-app pricing / discount / setup-fee config (`/owner/` console explicitly defers)
- Feature flag operationalization (UI exists, flag semantics unclear)
- Phase 04 follow-ups (per-clinician regenerate rate-limiting, edit-debounce timing, etc.)

## Recommended phase slicing when this becomes the priority

**Phase 15a — Commercial blockers (1.5-2 weeks):**
- Schema migration: downstream-BAA tracking fields on `Organization`
- MFA reset + password reset actions on `(admin)/users`
- Auth-model decision doc (commit to `TeamMembership`, stop fork-coding new branches)
- Verify invite `expiresAt` enforcement in code; patch if missing

**Phase 15b — Sites + onboarding polish (1-1.5 weeks):**
- Complete `(admin)/sites/page.tsx`: edit, delete, room CRUD
- Customer self-onboarding wizard (invite-acceptance page, password set, MFA enrollment)

**Phase 15c — Compliance polish (defer until first customer signs):**
- Audit log enrichment (before/after state)
- Per-org LLM cost rollup in ops dashboard
- Account lockout fields

**Phase 14 (Templates) and FHIR phases:** push back behind 15a + 15b only IF commercial shipping becomes the priority. Otherwise sequence Phase 14 / FHIR ahead per existing roadmap.

## Confirmed shipped admin surfaces (don't re-audit)

**Team admin (`(admin)/`):** users (full minus MFA/password reset), seats (team mode), billing (Stripe-bounded), manage-templates, voice (typed-name confirmation — gold standard), documentation. Shell uses `canManageTeam` gate via `/api/admin/shell`.

**Platform admin (`/ops/`):** signin, dashboard overview, organizations (full provisioning), users (impersonation + audit + 1-hour TTL), announcements, usage, subscriptions, transactions (Stripe sync), templates, prompts (read-only), health (queue depth + errors), audit, settings (password + IP allowlist + invite). 14 pages total.

**Platform owner (`/owner/`):** read-only summary, "Enter Admin Context" routes into ops scoped to org. Intentionally narrow.

## Design archive — UI direction is documented, don't re-derive

When commercial-readiness work touches admin UI, **do not redesign from scratch**. The design work is already done and sequenced. Read these first:

**Master design docs (repo root):**
- `design-critique.md` — full-app audit, April 29 2026. 5 critical findings (brand split Genscribe/OmniScribe, color-only goal pills, hardcoded badge colors, low-opacity error text, sheet-inside-sheet). Type scale fragmentation (11 sizes in use) flagged.
- `design-critique-capture-flow.md` — capture-flow deep dive. 4 critical findings including the 2,245-line monolith and inverted button polarity.
- `design-redesign-spec.md` — master implementation playbook. Mobile-first (40/40/20 mobile/tablet/desktop). Design tokens. Phased rollout.

**Mockups (`design-mockups-2026-05/` and root `design-mockups.html`):**
- Admin tier: `admin_overview_and_team_mockup.html`, `admin_team_responsive_v2.html`
- Platform owner: `owner_console_redesign.html`
- Plus 19 other screen mockups (capture, prepare, review, drafts, home, auth, templates, etc.)

**Redesign roadmap phases that affect admin tiers** (these are the redesign spec's internal phase numbers, NOT OmniScribe feature phases):
- **Redesign Phase 11** — Admin dashboard + Team page (real overview at `/admin`, member table replacing inline cards, filter chips, Sheet-based edit, AlertDialog for destructive actions, org switcher in top-right). Sprints 16-17 in the spec.
- **Redesign Phase 15** — Owner Console (split single `/owner` into `/owner` dashboard + `/owner/organizations` + `/owner/support` + `/owner/commercial` + new `/owner/[orgId]` tenant detail page; SaaS metrics replace administrative-gap metrics; purple-toned mode pill). Sprints 21-22.
- **Redesign Phase 16** — Remaining tenant admin pages (shared `<AdminPageShell>` + `<AdminTable>` foundation, applied to Sites + Seats + Voice + Billing + new `/admin/audit`). Sprints 23-24.

**Past chat session IDs with design context:**
- `local_2951db62-0824-4158-9aa2-e3dda1fb0b3d` — "Design handoff preparation" (Dashboard + Patient list + trust state mockups)
- `local_0658c5b4-f187-4e6e-b804-bbb589bbfc44` — "Design critique for Omniscribe"
- `local_07a5fcd9-1f30-4f29-83e0-6c24acd54b3a` — "Omniscribe design critique follow-up"
- `local_94180baf-ac37-4892-b17c-cde22bb82cba` — "Design critique for Omniscribe AI"

**Critical insight: admin UI parity work and admin redesign work are the same work.** When commercial-readiness 15a/15b lands, evaluate Option B: bundle redesign + functional gaps in the same PRs (e.g., when adding MFA reset buttons to Team admin, do the redesign Phase 11 layout). Requires building `<AdminPageShell>` and `<AdminTable>` first as foundation. Option A (separate redesign phase before commercial) is cleaner but slower.

**The Ops Console naming collision** flagged in the spec: current "Platform Admin" label collides with Org Admin / Site Admin / Platform Owner. Redesign renames to a distinct purple "Ops" mode pill. Worth resolving before commercial shipping so customer admins and your operator role are visually distinct.

## When to revisit this doc

- When Gil signals readiness to start commercial-readiness phase (after current FHIR / Templates work or whenever)
- When a specific customer asks about BAA tracking, MFA reset, or compliance officer-grade audit logs
- When Phase 04, Phase 14, and any FHIR work that's blocking-NextGen are all closed out
- When admin UI work begins — read the design archive before writing any code
