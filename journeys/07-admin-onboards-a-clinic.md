# Journey 07 — Admin Onboards a New Clinic

> **Sprint 0.20 — MFA removed.** Any reference to MFA, /mfa-challenge, /mfa-setup, TOTP, authenticator app setup, or login-verified gates in this document is HISTORICAL. Authentication is now password-only. See `context/specs/01-foundation-auth-tenant.md` and `progress-tracker.md`.


> Two parallel storylines: the platform owner provisions the customer organization with full BAA tracking; the customer's org admin sets up sites, rooms, users, billing, templates. By the end, the clinic is operational.

## Who

**OmniScribe side**: **Priya Sharma**, OmniScribe platform owner (you / your team). Has `PlatformRole = PLATFORM_OWNER`.

**Customer side**: **Dr. Maria Ortega**, founding clinician + admin at **Lakeshore Counseling Group** (a 4-clinician outpatient BH counseling group in Chicago). Maria signed the BAA + service agreement last week; today's the technical onboarding.

## The journey at a glance

By the end of today, Lakeshore Counseling Group exists in OmniScribe as an Organization with full BAA tracking, has a Site + 4 Rooms, has 4 clinician seats (Maria + 3 others) — invites sent — and Maria has signed in and previewed the product. First real visit happens tomorrow.

## Storyline A — Platform owner provisions Lakeshore

### Step 1 — Priya provisions the org, 10:00 AM

Priya signs into the owner console at `/owner` (a separate surface from the customer-facing app; gated to `PLATFORM_OWNER`).

**Screen: `/owner/orgs`** — list of all customer organizations. Filterable. Sortable by BAA status, last-active, MRR.

She clicks **+ New Organization**.

**Screen: `/owner/orgs/new`** — Sheet form:

- **Name**: Lakeshore Counseling Group
- **Primary contact**: Maria Ortega · maria@lakeshorecg.com · 312-555-0142
- **Division**: BEHAVIORAL_HEALTH (or MULTI if they expand later)
- **Billing email**: billing@lakeshorecg.com
- **Stripe customer**: she clicks "Create Stripe customer" — a Stripe customer is created via the API; the customer ID is stored on the Org.
- **BAA execution**:
  - `baaExecutedAt`: 2026-05-10 (date BAA was countersigned)
  - `baaVersion`: 2026-Q2-v3 (the latest OmniScribe BAA template)
  - `baaCountersignedBy`: Priya (auto-set to her userId)
  - `complianceProfile`: **BH_42CFR2** (adds 42 CFR Part 2 controls — required for BH clinics)

She taps **Provision**.

**Behind the scenes**:
- `Organization` row created with all fields including BAA tracking.
- Default `FeatureFlag`s applied per the BH compliance profile (BH templates, sensitivity defaults, etc.).
- Default `NoteTemplate`s seeded (Behavioral Health Intake, BH Progress Note, etc. — preset CMS templates).
- A SUPER_ADMIN-level invite is auto-generated for `maria@lakeshorecg.com`, expires 7 days.
- Email sent via Resend with the invite link.
- Audit (in `PlatformAuditLog`): `ORG_PROVISIONED` with `orgId`, `provisionedBy: priya.userId`, `complianceProfile`, `baaVersion`.

Toast: "Lakeshore Counseling Group provisioned. Invite sent to Maria Ortega."

### Step 2 — Priya configures seat allocation, 10:05 AM

She stays on the new Org's detail page. There's a **Seats** section.

She clicks **Allocate seats** → form:
- **Tier**: TEAM (covers 5–25 clinicians)
- **Count**: 5 (the contract was for 5, leaving 1 spare for growth)
- **Start date**: 2026-05-17 (today)
- **Renewal cycle**: monthly (matches billing)

Taps **Allocate**.

**Behind the scenes**: 5 `Seat` rows created with `tier: TEAM`, `orgId: lakeshore.id`, `expiresAt: now() + 30d` (initial period), `assignedToOrgUserId: null` (unassigned). Stripe subscription created with the 5-seat TEAM SKU. Audit: `SEATS_ALLOCATED`.

### Step 3 — Priya hands off, 10:10 AM

She emails Maria (outside the product): "Maria, OmniScribe is provisioned for Lakeshore. Your admin invite was sent — check your email. Five clinician seats are allocated. You'll set up sites, rooms, and invite your team. Loom walk-through here: [link]. I'll check in at end of day."

She moves on to the next org.

## Storyline B — Maria sets up Lakeshore

### Step 4 — Maria accepts the invite, 10:30 AM

She received the invite email at 10:00 AM, opens it now. Taps the link. Goes through the onboarding wizard (Journey 01 Steps 1–6: welcome → password → MFA → done).

She lands on `/home` at 10:35 AM. As a `SUPER_ADMIN` (because she's the first invited org admin), she also has access to the `/admin` console.

### Step 5 — Maria creates her first Site, 10:36 AM

**Screen: `/admin/sites`** — empty list (no sites yet). "+ Add Site" button.

She clicks. Sheet:
- **Name**: Lakeshore Main Office
- **Address**: 2401 N Clark St, Chicago IL 60614
- **Phone**: 312-555-0142
- **Primary division**: BEHAVIORAL_HEALTH
- **Initial room count**: 4

She submits.

**Behind the scenes**: `Site` row + 4 `Room` rows (named "Room 1" through "Room 4" by default; renamable). Audit: `SITE_CREATED`, `ROOM_CREATED × 4`.

### Step 6 — Maria invites the 3 other clinicians, 10:38 AM

**Screen: `/admin/users`** — shows just Maria.

She clicks **+ Invite user**. Form:
- Email: dr.aiden@lakeshorecg.com
- Role: CLINICIAN
- Division: BEHAVIORAL_HEALTH
- Profession: LCSW
- Permissions: `canManagePatients = true`

Submit. Invite generated, email sent. Repeats for 2 more.

**Behind the scenes**: 3 `Invite` rows + 3 `OrgUser` rows (pre-created; awaiting User link on invite acceptance per Journey 01). 3 `Seat` rows auto-assigned (out of the 5 allocated). Audit: `USER_INVITED × 3`, `SEAT_ASSIGNED × 3`.

### Step 7 — Maria configures org-wide settings, 10:42 AM

**Screen: `/admin/org-settings`** — org-level configuration:
- **Force MFA**: on (BH clinic; required)
- **Default note style**: Hybrid
- **Default template per division**: BEHAVIORAL_HEALTH → "Behavioral Health Intake" (for new patients), "BH Progress Note" (for established)
- **Voice profile enrollment**: encourage (clinicians can opt out)
- **Audit log retention**: 7 years (HIPAA default)
- **Patient communication preferences**: SMS + email (org has Twilio set up)

She reviews + saves.

### Step 8 — Maria reviews templates, 10:46 AM

**Screen: `/admin/templates`** — shows the org's templates (preset CMS-default + any org-custom).

Maria sees the preset BH templates were seeded by the provisioning step. They look good. She decides to customize the BH Intake template to add a section for trauma history (her clinic specializes in this).

She clicks **BH Intake → Duplicate as custom**. The duplicate opens in the template editor (Wave 2 Unit 13 — for v1 this is a basic JSON editor; better UI in Unit 13). She adds a "Trauma History" section with a structured schema (categorical + free text). Saves. Sets it as the default for new BH intakes.

**Behind the scenes**: New `NoteTemplate` row with `visibility: TEAM`, `division: BEHAVIORAL_HEALTH`, `isDefault: true`. Audit: `TEMPLATE_CREATED`, `TEMPLATE_SET_AS_DEFAULT`.

### Step 9 — Maria adds a few test patients, 10:55 AM

**Screen: `/patients`** — empty list. She clicks **+ Add Patient** and creates 2 test patients (using her own info + a colleague's, for safety walkthrough).

She doesn't add real patients yet — clinicians will create them as needed during real visits.

### Step 10 — Maria does a dry-run visit, 11:05 AM

She picks one of the test patients, navigates to `/prepare/[noteId]`, clicks **Start Recording**, records herself reading a 90-second mock counseling session, taps **Finish & Review**, watches the AI draft a BH note, edits a section, signs.

It works. The note signs cleanly. She's confident.

### Step 11 — Maria checks the dashboard, 11:15 AM

**Screen: `/admin/dashboard`** (org-admin dashboard, distinct from `/home`):
- **Today's stats**: 1 note signed (her test note), 0 in-progress, 0 in DRAFTING
- **Seat utilization**: 1/5 active (4 pending invite acceptance)
- **Recent audit events**: Org provisioning + her setup actions
- **Active features**: MFA enforced, BH templates active, voice enrollment enabled
- **Quick links**: Invite user, Add template, View audit log

Maria takes a screenshot, sends to her team Slack: "We're live. Invites out. First patient visits tomorrow."

### Step 12 — Priya's end-of-day check, 5:00 PM

Priya opens `/owner/orgs/lakeshore`, sees:
- BAA: ✓ executed 2026-05-10
- Seats: 1 active / 5 allocated (rest pending invite)
- First sign: 11:13 AM today (Maria's test)
- No errors in audit log

She marks Lakeshore as **onboarded** internally.

---

## What just happened — behind the scenes summary

### Platform owner side (`PlatformAuditLog`)
| Event | Action |
|---|---|
| Org provision | `ORG_PROVISIONED` |
| Seats allocated | `SEATS_ALLOCATED` |
| (BAA fields set during provision) | included in provision event metadata |
| Org status changed | (manual; could be added: `ORG_MARKED_ONBOARDED`) |

### Customer admin side (`AuditLog`)
| Event | Action |
|---|---|
| First admin invite consumed | `INVITE_CONSUMED`, `USER_CREATED`, `MFA_ENROLLED`, `ONBOARDING_COMPLETED` |
| Site + rooms created | `SITE_CREATED`, `ROOM_CREATED` |
| Clinician invites | `USER_INVITED`, `SEAT_ASSIGNED` |
| Org settings updated | `ORG_SETTINGS_UPDATED` (with field-name list, no values for PHI-sensitive fields) |
| Template customized | `TEMPLATE_CREATED`, `TEMPLATE_SET_AS_DEFAULT` |
| Test patients + dry-run sign | `PATIENT_CREATED × 2`, `NOTE_SIGNED × 1` (per Journey 02 trail) |

## What makes this work (build-team mental model)

**Two separate consoles, two separate roles.** The platform owner sees ALL orgs, manages BAA + Stripe + provisioning. The customer admin sees ONLY their org, manages site/room/user/template/billing-view. Never confused; never overlapping. Owner can impersonate a customer admin (with audit) for support, but acts on the customer's behalf.

**BAA tracking on `Organization` is a hard schema requirement.** Per [`references/audit-admin-state-of-play.md`](../references/audit-admin-state-of-play.md), `baaExecutedAt`, `baaVersion`, `baaCountersignedBy`, `complianceProfile` are critical compliance fields. The owner console exposes them; the customer doesn't see them (the customer signed the BAA, the field tracks OmniScribe's countersignature).

**Compliance profile drives defaults.** `STANDARD` (HIPAA only), `BH_42CFR2` (adds 42 CFR Part 2 sensitivity controls), `RESEARCH` (adds research-data handling). Compliance profile drives default sensitivity tier on notes, what templates are enabled, audit retention defaults.

**Seats are a pricing layer.** `Seat` rows exist independent of `OrgUser`. Owner allocates N seats per tier; org admin assigns specific seats to users on invite. Stripe billing tracks the *seat allocation*, not seat *utilization* — customers pay for allocated seats whether utilized or not (standard SaaS model).

**Customer-self-onboarding wizard is the bridge.** The admin invite → password → MFA → first-login wizard (Journey 01) is what makes Step 4 above smooth. Without it, Maria would have to do something painful on day 1.

**The owner console BAA UI is unique to v1.** Per `audit-admin-state-of-play.md` this is a hard blocker for first paying customer. The owner CAN'T provision an org without filling in BAA fields. If she tries, the form rejects.

## Edge cases

- **Stripe creation fails during provisioning.** Org is NOT created; entire transaction rolls back; owner sees an error toast with specific Stripe error code. Try again after fixing the Stripe side.
- **Invite to Maria expires before she accepts.** Owner sees on the org page: "Pending invite for Maria expired 2 days ago. [Resend]." Tap resend → new invite generated; old invite marked EXPIRED.
- **Customer's first admin loses access.** Owner can `Reset MFA` (admin-initiated path; Maria gets an email + re-enrolls on next sign-in). Owner can `Reset password` similarly. Both audited.
- **Customer reduces seat count after upgrade.** Stripe handles proration; some assigned seats become unassigned at next billing cycle; users with unassigned seats become read-only until reassigned.
- **Customer requests org deletion.** This is a contractual + data-handling decision, not a self-service feature. Owner-only; full data export + deletion follows org's BAA terms. Out of scope for the immediate journey; handled via support process.
- **42 CFR Part 2 sensitivity** — when `complianceProfile = BH_42CFR2`, all BH notes default to `NoteSensitivityLevel.BEHAVIORAL_HEALTH`; only roles cleared for that tier can read them.
- **Multi-site customer.** Maria's clinic later opens a second location. She creates a second `Site` with its own `Room` set; users can be associated with one or more sites (via `OrgUser.siteIds` array, or `SiteUser` join table — schema choice in Unit 01).

## Three-lens evaluation

**Clinician** — Maria can stand up her clinic in under 90 minutes without engineering help. She sees what's happening; the language is clinical, not bureaucratic.

**Medicare Compliance Officer** — The compliance profile drives the right defaults (BH = 42 CFR Part 2 sensitivity). MFA is enforced. Audit retention is 7 years. BAA fields are populated.

**Insurance Auditor** — Every action from provision through go-live is logged in `PlatformAuditLog` + `AuditLog` with PHI-free metadata. The org's BAA execution is on file in the database.

## What this journey doesn't cover

- Org migration from a different scribe (data import — out of scope for v1)
- Multi-EHR integration during onboarding (FHIR comes in Wave 4)
- White-label or co-branded customer experience (out of scope for v1)
- Custom contract terms beyond the standard tiers (handled in Stripe + ops, not in product)

## Build-team checklist for "this journey works"

- [ ] Owner console exists at `/owner` (gated to `PLATFORM_OWNER`).
- [ ] Org provisioning form requires BAA fields; cannot submit without them.
- [ ] Stripe customer + subscription created atomically with Org provision.
- [ ] Compliance profile drives default templates + sensitivity + feature flags.
- [ ] Auto-invite first admin (SUPER_ADMIN role) on org provision.
- [ ] Customer admin can: create sites + rooms, invite users with role + division + permissions, configure org-wide MFA + defaults, customize templates.
- [ ] Org dashboard shows utilization, recent audit events, active features.
- [ ] Admin-initiated MFA reset + password reset works (per Unit 08).
- [ ] Owner can view (read-only) any customer org's state.
- [ ] All admin actions audited; PlatformAuditLog and AuditLog separate.
- [ ] Three-lens evaluation passes.

## Related references

- Admin commercial-readiness audit (BAA, MFA reset, Sites CRUD, onboarding wizard): [`references/audit-admin-state-of-play.md`](../references/audit-admin-state-of-play.md)
- HIPAA controls matrix: [`references/strategic/hipaa-scribe-controls-matrix.md`](../references/strategic/hipaa-scribe-controls-matrix.md)
- Commercial-readiness backlog: [`references/strategic/commercial-readiness-backlog.md`](../references/strategic/commercial-readiness-backlog.md)
- Build units delivering this journey: [`context/specs/01-foundation-auth-tenant.md`](../context/specs/01-foundation-auth-tenant.md), [`context/specs/08-admin-and-compliance-ready.md`](../context/specs/08-admin-and-compliance-ready.md)
