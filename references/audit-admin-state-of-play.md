# Admin State-of-Play Audit

**Date:** 2026-05-05
**Scope:** Team admin (customer-side) + platform admin (operator-side) readiness for shipping the scribe portion of OmniScribe commercially.
**TL;DR:** Both admin tiers are **far more developed than I expected coming in.** Platform admin is genuinely close to launch-ready. Team admin has real CRUD across most surfaces but is missing two operational must-haves (MFA reset, password reset) and one regulatory must-have (BAA tracking — schema-level, not UI). Sites is a stub. Plan a 3-4 week commercial-readiness phase, not a 3-month rebuild.

---

## Team admin (`src/app/(admin)/`)

This is the surface a customer's practice manager or IT admin uses inside their own org.

| Route | Status | What's there | Gap for commercial |
|---|---|---|---|
| **users** | SHIPPED | Invite (name/email/role/division/profession), edit, deactivate, role change, site/department reassignment, seat assignment popover, multi-division support, invite-token copy-link UX. Backed by `/api/admin/invites` with audit log. | **No MFA reset action. No password reset action.** First time a clinician locks themselves out, you'll be doing it via DB. |
| **seats** | SHIPPED (team mode) | Seat table, transfer/revoke, "buy more seats" via Stripe checkout. Solo mode redirects to billing. Backed by `/api/admin/subscription` + `/api/seats`. | Seat purchase POST handler unclear from audit (UI references it, route presence not confirmed). Revoke lacks typed-name confirmation (voice page has it; seats doesn't — minor safety gap). |
| **billing** | SHIPPED (Stripe-bounded) | Subscription dashboard, Stripe checkout, Stripe portal for self-serve invoice/card. "Auto-grant patient management" org toggle. Backed by `/api/billing/checkout` + `/api/billing/portal`. | No in-app invoice history viewer (customer goes to Stripe portal for that). No tier upgrade/downgrade UI. Both deferrable. |
| **sites** | **STUBBED** | Create site (name/address). Read-only display of site cards with counts. | No edit, no delete, no room CRUD, no department-site relationship UI. First customer who needs to fix a typo in a site address will hit this wall. |
| **manage-templates** | SHIPPED | Org-level template authoring via `SectionEditor`, distinct from per-clinician clinical templates. Tabs, create/edit/delete. | No identified gap for v1. |
| **voice** | SHIPPED | Voice ID enrollment roster, consent-version tracking, revoke with **typed-name confirmation** (gold standard). Backed by `/api/admin/voice-profiles`. | None. This is the strongest admin surface. |
| **documentation** | SHIPPED | Org defaults for documentation/templates via `OrgDocumentationSettings`. Links to clinical docs + template editor. | None blocking. |

**Shell:** `(admin)/layout.tsx` fetches `/api/admin/shell`, gates by `canManageTeam` (ORG_ADMIN, SUPER_ADMIN, or PLATFORM_OWNER in support mode). Non-200 → /home redirect. Role gating is real, not stub.

---

## Platform admin (`src/app/ops/` + `src/app/owner/`)

This is the surface you (the operator) use to manage all customer orgs. Two distinct entry points.

`/ops/` is the working surface (14 pages). `/owner/` is a read-only "safe support" wrapper that routes you back into ops scoped to a specific org. Platform admin uses **separate auth** from tenant auth — `PlatformRole` enum (`NONE` | `PLATFORM_OWNER`) and a separate cookie session.

| Route | Status | What's there | Gap |
|---|---|---|---|
| **`/ops/signin`** | SHIPPED | Email/password, separate cookie. | Operators must be seeded at deploy (no self-signup, which is correct). |
| **`/ops/dashboard` (overview)** | SHIPPED | Real metrics, service health (DB, AssemblyAI, Anthropic, OpenAI), recent ops activity from audit log. | None. |
| **`/ops/dashboard/organizations`** | SHIPPED | **Full org provisioning from UI** — create with name/division/billing email/admin email. Generates initial admin with one-time password. Suspend/resume, feature flags, transfer ownership. | None for creation. **Customer self-onboarding flow is missing** (more on this below — it's a gap on the *invite acceptance* side, not creation side). |
| **`/ops/dashboard/users`** | SHIPPED | Cross-org user list, **impersonation with audit + 1-hour token TTL**, force password reset, toggle MFA. Cannot impersonate other PLATFORM_OWNERs. | None. |
| **`/ops/dashboard/announcements`** | SHIPPED | Platform-wide or org-specific announcements with scheduling (info/warning/critical). | None. |
| **`/ops/dashboard/usage`** | SHIPPED | Notes/day, division breakdown, top orgs, CSV export. | No per-org LLM token cost rollup (cursor-task 28 territory). |
| **`/ops/dashboard/subscriptions`** | SHIPPED | Tier list, active seats, max notes/month, quota override, credit adjustment with reason. | No in-app pricing/discount/setup-fee config (intentional per `/owner/` console copy). |
| **`/ops/dashboard/transactions`** | SHIPPED | Stripe invoice + subscription read-only sync. Refund button (likely requires manual Stripe verification). | None blocking. |
| **`/ops/dashboard/templates`** | SHIPPED | System template management across divisions. | None. |
| **`/ops/dashboard/prompts`** | SHIPPED (read-only) | Division prompts viewer. | View-only — edits require code deploy. Acceptable. |
| **`/ops/dashboard/health`** | SHIPPED | Queue depth, recent errors per service, refresh button. | None. |
| **`/ops/dashboard/audit`** | SHIPPED | Paginated platform audit log with filters, CSV export. | None. |
| **`/ops/dashboard/settings`** | SHIPPED | Change ops password, IP allowlist (CIDR), invite new ops admin (one-time invite password). | None. |
| **`/owner/`** | SHIPPED (intentionally narrow) | Read-only summary across orgs. "Enter Admin Context" routes into ops scoped to that org. Explicitly states "commercial controls remain intentionally narrow." | This is by design, not a gap. |

---

## Schema + auth findings (cross-cutting)

These are the issues that bite across both admin tiers. Verified directly against `prisma/schema.prisma`.

**1. No customer-side (downstream) BAA tracking on the `Organization` model.**

> **Important distinction — two layers of BAAs:**
>
> **Upstream BAAs** are between OmniScribe-the-company and your vendors who touch PHI on your behalf — AWS (signed), Soniox (per CLAUDE.md `SONIOX_BAA_ON_FILE=true`), Anthropic-via-Bedrock (covered transitively through AWS BAA since you don't call Anthropic directly), AssemblyAI (parked, no BAA needed unless flipped on). These are filed externally (AWS Artifact, vendor portals, signed PDFs in your Drive). They are **necessary but not sufficient** for commercial shipping.
>
> **Downstream BAAs** are between OmniScribe-the-company and each individual customer org (LRCHC, future customers). Each customer is a covered entity; you are their business associate. Each customer signs their own BAA with you before sending PHI through your platform.
>
> **The schema gap below is about downstream BAAs only.** Upstream is fine.

The `Organization` model has `name`, `division`, `billingEmail`, `stripeId`, `suspendedAt`, etc. — but no `baaExecutedAt`, no `baaVersion`, no `baaCountersignedBy`, no `complianceProfile` enum, no flag for HIPAA / 42 CFR Part 2 / Medicare. **This is a regulatory blocker for healthcare commercial shipping.** First time a customer's compliance officer asks "where do you track that *we* have a signed BAA with you?" — separately for LRCHC, separately for customer #2, etc. — you have no answer. Schema migration + `/ops/dashboard/organizations` UI to capture and display.

**2. Dual auth model mid-migration.** Two RBAC schemes coexist: legacy `OrgUser.role` + `canManagePatients` boolean, and new `TeamMembership` + `MembershipProfession` + `MembershipFeatureGrant` tables. Code checks `hasMembershipTables()` and falls back. **Pick one and migrate before commercial launch** — running both in production multiplies bug surface.

**3. Audit log lacks before/after state.** `AuditLog` captures actor, action, resource, IP, metadata — but no structured before/after JSON. HIPAA covered-entity audit requirements expect reconstructable state transitions. Operationally fine for v1; will need enrichment for any customer with a compliance officer who actually reads audit logs.

**4. MFA is TOTP only.** No WebAuthn, no backup codes in schema. Acceptable for v1; revisit if you target enterprise.

**5. No account lockout fields.** `loginAttempts`, `lockedUntil` absent. Brute-force defense is at the rate-limiter / WAF layer, not the model. Add before public-facing signup, not blocking for invite-only commercial.

**6. Invite expiration not enforced in code.** Schema has `expiresAt` on `Invite`; the audit didn't find middleware that prevents redemption past expiry. Verify and patch.

**7. Soft-delete is biometric-only.** `VoiceProfile` has `deletedAt` + `hardDeleteAt` (BIPA pattern). Other models don't. Audio files referenced by `Note.audioFileKey` rely on S3 retention policy, not DB-level soft delete. Anti-regression rule 7 says "audio files are NEVER deleted from S3 — only soft-deleted in DB" — verify the DB-side soft-delete path actually exists.

---

## What blocks commercial scribe-only shipping

**Hard blockers (must ship before first paying customer):**

1. **Customer-side (downstream) BAA tracking on `Organization`.** Schema migration adds `baaExecutedAt`, `baaVersion`, `baaCountersignedBy`, `complianceProfile` enum. Surface in `/ops/dashboard/organizations` create + edit + list. Upstream vendor BAAs (AWS, Soniox, Anthropic-via-Bedrock) are tracked externally and are not part of this gap. Small scope.
2. **MFA reset + password reset actions in `(admin)/users`.** Customer admin can't unblock their own clinicians today. Two buttons + two API routes.
3. **Sites edit/delete + room CRUD.** First address typo trips this. Small scope but unavoidable.
4. **Pick one auth model.** Either commit to TeamMembership and migrate, or revert to legacy OrgUser.role. Running both in production is a footgun.

**Soft blockers (can ship without, but you'll feel pain in first 30-60 days):**

5. **Customer self-onboarding flow.** Today: operator creates org with admin → admin gets one-time password → admin signs in. There's no self-serve "accept invite, set password, do MFA enrollment" wizard. Manageable for first 5 customers (you do it by hand); breaks at customer 10+.
6. **Invoice history viewer in `(admin)/billing`.** Customers go to Stripe portal today. Acceptable but a tier-up ask.
7. **Audit log enrichment (before/after state).** Required for compliance officers who actually audit; defer until a customer asks.
8. **Per-org LLM cost visibility in ops.** Cursor-task 28 territory. Defer until you see real spend variance across customers.
9. **Account lockout.** Defer until public signup or after first security review.

**Non-blockers (defer):**

- WebAuthn / passkeys (TOTP is acceptable v1).
- In-app pricing / discount / setup-fee configuration (`/owner/` explicitly defers this).
- Feature flag operationalization (UI exists but unclear what flags do).
- Per-clinician regenerate rate-limiting + other Phase 04 follow-ups.

---

## Recommended phase slicing

If you want to ship to 1-3 existing LRCHC-adjacent customers in the next 6-8 weeks, the path is:

**Phase 15a — Commercial blockers (1.5-2 weeks):**
- Schema migration: add downstream-BAA tracking fields (`baaExecutedAt`, `baaVersion`, `baaCountersignedBy`, `complianceProfile` enum) to `Organization`. Expose in `/ops/dashboard/organizations` create + edit + list. Upstream vendor BAAs (AWS, Soniox, etc.) are tracked externally and are out of scope for this work.
- Add MFA reset + password reset actions to `(admin)/users` edit form. Wire to existing `/api/users/[id]` PATCH or new sub-endpoints with audit logging.
- Decide auth model (recommend: commit to `TeamMembership` since it's the forward direction). Document migration path. Don't migrate yet — just stop fork-coding.
- Verify invite `expiresAt` enforcement; patch if missing.

**Phase 15b — Sites + onboarding polish (1-1.5 weeks):**
- Complete `(admin)/sites/page.tsx`: edit, delete, room CRUD.
- Add customer self-onboarding flow: invite-acceptance page, password set, MFA enrollment wizard. Even a minimal version reduces founder load per customer significantly.

**Phase 15c — Compliance polish (defer until first customer signs):**
- Audit log enrichment.
- Per-org LLM cost rollup in ops dashboard.
- Account lockout fields.

**Phase 14 (Templates) and FHIR phases:** push back behind 15a + 15b. Templates are nice-to-have for v1 commercial; preset templates cover the basic case. FHIR remains blocked on NextGen.

---

## What I'd do next

If you agree with this slicing, **15a is the next ship after 04c merges**. It's about 4-6 PRs, scoped tightly, no review/sign shell touches, no AssemblyAI/Soniox touches, all rule-compliant.

If you want me to draft cursor-tasks for 15a (BAA tracking, MFA/password reset, auth-model decision doc, invite expiration check), say the word and I'll structure them the same way Phase 04 was sliced — one task per concern, evidence-based, plain-English-first deliverable.
