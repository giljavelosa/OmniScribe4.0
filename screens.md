# Screens — Reference Index

> Every screen in OmniScribe v1, with route, who can access it, what's on it, what the user can do. One section per screen. Use this as a map while reading the journey files or building the specs.

## Reading conventions

- **Route** — Next.js App Router path. `[id]` = dynamic segment.
- **Access** — who can see this screen. `Public` = no session needed.
- **Layout** — which layout wraps it (clinical / admin / owner / telehealth / standalone).
- **Key elements** — the components on the screen.
- **Primary actions** — what the user came here to do.
- **Audited** — yes if any action on this screen writes audit log.

---

## Auth & Onboarding

### `/login`
- **Access**: Public
- **Layout**: Standalone (centered card, no chrome)
- **Key elements**: Email input, password input, "Sign in" button, "Forgot password" link, "Don't have an invite?" support contact
- **Primary actions**: Sign in (gates MFA challenge if enabled)
- **Audited**: Yes (`SIGN_IN_ATTEMPTED`, `SIGN_IN_SUCCEEDED`, `SIGN_IN_FAILED`)

### `/mfa-challenge`
- **Access**: Authenticated user without `mfaVerified: true` in current session
- **Layout**: Standalone
- **Key elements**: 6-digit TOTP input, "Use recovery code instead" link, "Sign out" link
- **Primary actions**: Verify TOTP → land at `/home`
- **Audited**: Yes (`MFA_VERIFIED`, `MFA_FAILED`)

### `/password-reset/request`
- **Access**: Public
- **Layout**: Standalone
- **Key elements**: Email input, "Send reset link" button
- **Primary actions**: Request password reset email
- **Audited**: Yes (`PASSWORD_RESET_REQUESTED`)

### `/password-reset/confirm`
- **Access**: Public (with valid token)
- **Layout**: Standalone
- **Key elements**: New password + confirm inputs, "Set new password" button
- **Primary actions**: Set new password → all sessions invalidated → land at `/login`
- **Audited**: Yes (`PASSWORD_RESET_COMPLETED`)

### `/onboarding/[token]`
- **Access**: Public (with valid invite token)
- **Layout**: Standalone (4-step wizard)
- **Key elements**: Steps welcome → password → MFA enrollment (with QR + recovery codes) → done
- **Primary actions**: Set password, enroll MFA, sign in
- **Audited**: Yes (`ONBOARDING_OPENED`, `USER_CREATED`, `MFA_ENROLLED`, `ONBOARDING_COMPLETED`)
- **Detail**: Journey 01

---

## Clinical (clinician-facing)

### `/home`
- **Access**: Authenticated clinician (`CLINICIAN`/`SITE_ADMIN`/`ORG_ADMIN`/`SUPER_ADMIN`)
- **Layout**: Clinical (top bar + bottom nav on mobile; sidebar on desktop)
- **Key elements**: Today's schedule (cards per appointment with patient name, time, visit type, in-person/telehealth badge, status), drafts queue (notes in DRAFT/REVIEWING needing attention), search field
- **Primary actions**: Pick a patient to prepare for / open a draft / search a patient
- **Audited**: Yes (`HOME_OPENED`)

### `/prepare/[noteId]`
- **Access**: Authenticated clinician with `NOTE_CREATE` feature
- **Layout**: Clinical
- **Key elements**: Patient identity header, prior-context brief (`<BriefCard>`), copilot Watch cards (open follow-ups + plan for today), documentation setup form (template + style + division), copilot beacon (bottom-right)
- **Primary actions**: Read the brief, adjust setup if needed, tap "Start Recording"
- **Audited**: Yes (`NOTE_PREPARING_OPENED`)
- **Detail**: Journey 02 Step 1, Journey 03

### `/capture/[noteId]`
- **Access**: Authenticated clinician with `NOTE_EDIT` feature
- **Layout**: Clinical (full-viewport on `lg+`; mobile tabbed on `<lg`)
- **Key elements**:
  - Desktop: left transcript pane + right prior-context/live-note pane + controls bar
  - Mobile: tabs for Transcript / Live Note / History / Setup + controls bar
  - `<RecordingStatus>` chip (single source of truth for state)
  - `<AudioLevelBars>` VU meter
  - `<SectionProgressStrip>`
  - Copilot beacon
- **Primary actions**: Record visit, start drafting mid-visit, finish & review
- **Audited**: Yes (`REALTIME_KEY_ISSUED`, `RECORDING_STARTED`, `RECORDING_PAUSED`, `RECORDING_RESUMED`, `DRAFTING_STARTED`, `RECORDING_FINALIZED`, `AUDIO_UPLOADED`)
- **Detail**: Journey 02 Steps 2–3

### `/processing/[noteId]`
- **Access**: Authenticated clinician (note owner or covering)
- **Layout**: Clinical (transient screen)
- **Key elements**: `<ProcessingIndicator>` (3-gear spinner), reassurance copy with escalating empathy ("Wrapping up…" → "Taking a bit longer…" → "Heavy load — almost done")
- **Primary actions**: Wait. Auto-routes to `/review/[noteId]` when note exits `DRAFTING`.
- **Audited**: No (transient)

### `/review/[noteId]`
- **Access**: Authenticated clinician with `NOTE_REVIEW` feature
- **Layout**: Clinical
- **Key elements**:
  - Section accordions (one per template section), each with inline TipTap editor
  - `<SectionProgressStrip>` at top
  - `<SectionProgressCell>` per section with status glyph + regenerate button
  - `<SectionRegenerateConfirmDialog>` for overwriting edited sections
  - Readiness panel (right side desktop; collapsible on mobile): required-section completeness, AI compliance flags by severity, open follow-ups
  - Copilot beacon
- **Primary actions**: Read draft, edit inline, regenerate sections, close follow-ups, navigate to sign
- **Audited**: Yes (`NOTE_REVIEWED`, `NOTE_EDITED`, `SECTION_REGENERATED`, `FOLLOWUP_CLOSED`)
- **Detail**: Journey 02 Step 4, Journey 04

### `/sign/[noteId]`
- **Access**: Authenticated clinician with `NOTE_SIGN` feature
- **Layout**: Clinical
- **Key elements**: Read-only final preview (composed from `draftJson`), attestation block, MFA challenge modal (if `forceMfa` or `lastMfaVerifiedAt > 1h`), sign-time follow-up sweep modal (if any prior-visit FollowUps still OPEN), large "Sign Note" CTA, "Cancel" outlined button
- **Primary actions**: Sweep open follow-ups, re-verify MFA, sign → land at `/home`
- **Audited**: Yes (`NOTE_SIGNED`, `FOLLOWUP_CLOSED` × N from sweep)
- **Detail**: Journey 02 Step 5

### `/drafts`
- **Access**: Authenticated clinician
- **Layout**: Clinical
- **Key elements**: List of notes in DRAFT/REVIEWING status for this clinician, sortable by age, with patient identity + last-edit timestamp
- **Primary actions**: Open a draft → resume work
- **Audited**: Yes (`DRAFTS_VIEWED`)

### `/patients`
- **Access**: Authenticated clinician with `PATIENT_MANAGEMENT` feature
- **Layout**: Clinical
- **Key elements**: Searchable patient list (name, MRN, age, sex, division), filters (active episode, recently seen, etc.), "+ Add Patient" button
- **Primary actions**: Search → open patient detail OR add new patient
- **Audited**: Yes (`PATIENT_SEARCHED` with query length only, `PATIENTS_LISTED`)

### `/patients/[id]`
- **Access**: Authenticated clinician with PHI scope
- **Layout**: Clinical
- **Key elements**:
  - Patient identity header (inline-editable demographics)
  - Snapshot strip (division-keyed: rehab=pain/ROM/strength/gait/outcome-tool; medical=vitals; BH=PHQ-9/GAD-7) with trend arrows + source dots
  - Visit history (table; 2-line assessment per row; sortable)
  - Reference cards (active goals, watch items, open follow-ups)
  - Action bar: edit demographics (PatientEditSheet), schedule visit, recert (if episode due), telehealth CTA (if last visit was telehealth)
- **Primary actions**: Review patient state, edit demographics, schedule visit, recert
- **Audited**: Yes (`PATIENT_VIEWED`)

### `/templates`
- **Access**: Authenticated clinician with `TEMPLATE_LIBRARY_READ`
- **Layout**: Clinical
- **Key elements**: List of templates visible to user (preset + org + personal), filter by division/specialty, search
- **Primary actions**: Browse templates, set per-user preferred default
- **Audited**: Yes (`TEMPLATES_BROWSED`)

### `/profile`
- **Access**: Authenticated user (self)
- **Layout**: Clinical
- **Key elements**: Avatar, name, email, profession, specialty, default note style, MFA status, voice profile status, "Sign out" button
- **Primary actions**: Edit profile, manage MFA, manage voice profile
- **Audited**: Yes (`PROFILE_VIEWED`, `PROFILE_UPDATED`)

### `/profile/voice`
- **Access**: Authenticated user (self) with `VOICE_PROFILE_MANAGE`
- **Layout**: Clinical
- **Key elements**: Current voice profile status, BIPA consent text, re-record sample button, revoke + delete (with 30-day grace warning)
- **Primary actions**: Enroll, re-enroll, revoke
- **Audited**: Yes (`VOICE_PROFILE_CREATED`, `VOICE_PROFILE_REVOKED`)

---

## Telehealth

### `/telehealth/room/[scheduleId]` (clinician view)
- **Access**: Authenticated clinician scheduled for this session
- **Layout**: Telehealth
- **Key elements**: Pre-call diagnostic (mic/cam/network), patient waiting indicator, admit button, in-call A/V with controls, brief + setup right panel (when in call), transcript left panel (when in call), section progress + live note, copilot beacon, end-visit button
- **Primary actions**: Enter waiting room, run pre-call checks, admit patient, run visit, end visit
- **Audited**: Yes (`TELEHEALTH_PRECALL_OPENED`, `TELEHEALTH_CALL_STARTED`, `TELEHEALTH_CALL_ENDED`)
- **Detail**: Journey 06

### `/v/[magicToken]` (patient identity verification)
- **Access**: Public (with magic token)
- **Layout**: Standalone
- **Key elements**: OmniScribe wordmark, patient + clinician + practice name, DOB input, "Continue" button, recording consent + privacy note
- **Primary actions**: Verify identity → proceed to waiting room
- **Audited**: Yes (`TELEHEALTH_LINK_OPENED`, `TELEHEALTH_PATIENT_IDENTITY_VERIFIED`, `TELEHEALTH_IDENTITY_VERIFICATION_FAILED`)

### `/telehealth/waiting/[scheduleId]` (patient view)
- **Access**: Public (with valid patient session token)
- **Layout**: Standalone
- **Key elements**: Self-preview video, audio check (VU meter), waiting message, browser permission helper
- **Primary actions**: Wait for clinician admit
- **Audited**: Yes (`TELEHEALTH_WAITING`)

---

## Admin (org-level)

### `/admin/dashboard`
- **Access**: Org admin (`SUPER_ADMIN` / `ORG_ADMIN` / `SITE_ADMIN`)
- **Layout**: Admin
- **Key elements**: Today's stats (notes signed, in-progress, drafts), seat utilization, recent audit events, active features, quick links
- **Primary actions**: Quick navigate to common admin tasks

### `/admin/users`
- **Access**: Org admin with `TEAM_MEMBERS_MANAGE`
- **Layout**: Admin
- **Key elements**: User list (name, email, role, division, profession, seat status, last sign-in), filters, "+ Invite user" button, per-row dropdown (Edit, Reset MFA, Send password reset, Deactivate)
- **Primary actions**: Invite, edit role/permissions, reset MFA, reset password, deactivate
- **Audited**: Yes (`USER_INVITED`, `USER_UPDATED`, `MFA_RESET`, `PASSWORD_RESET_INITIATED_BY_ADMIN`, `USER_DEACTIVATED`)

### `/admin/sites`
- **Access**: Org admin
- **Layout**: Admin
- **Key elements**: Site list (name, address, room count, division), "+ Add site" button, per-site detail page (nested rooms CRUD)
- **Primary actions**: Create site, edit, archive, manage rooms
- **Audited**: Yes (`SITE_CREATED / UPDATED / ARCHIVED`, `ROOM_CREATED / UPDATED / ARCHIVED`)

### `/admin/seats`
- **Access**: Org admin with `BILLING_MANAGE`
- **Layout**: Admin
- **Key elements**: Allocated seats by tier, utilized vs unassigned, expiration dates, renewal preferences, "Request more seats" link to support
- **Primary actions**: Assign/unassign seats, view billing impact
- **Audited**: Yes (`SEAT_ASSIGNED / UNASSIGNED`)

### `/admin/billing`
- **Access**: Org admin with `BILLING_MANAGE`
- **Layout**: Admin
- **Key elements**: Current subscription (tier, seats, MRR), payment method, invoice history (Stripe portal embed or link), upgrade/downgrade
- **Primary actions**: Manage payment method, upgrade tier, view invoices
- **Audited**: Yes (`BILLING_VIEWED`, `BILLING_UPDATED`)

### `/admin/templates`
- **Access**: Org admin with `TEMPLATE_LIBRARY_MANAGE`
- **Layout**: Admin
- **Key elements**: All templates (preset + org-custom + personal), tabs for visibility, edit/duplicate/archive/set-as-default per template, "+ New from blank" button
- **Primary actions**: Create / customize / set defaults / archive
- **Audited**: Yes (per Journey 08)

### `/admin/templates/[id]/edit`
- **Access**: Org admin (template owner or higher)
- **Layout**: Admin
- **Key elements**: Name + visibility + division + specialty fields, section schema JSON editor (with live validation), prompt-hints editor, sensitivity default selector, set-as-default rules editor, save/cancel
- **Primary actions**: Edit template, set defaults
- **Audited**: Yes (`TEMPLATE_UPDATED`)

### `/admin/voice`
- **Access**: Org admin with `VOICE_PROFILE_MANAGE`
- **Layout**: Admin
- **Key elements**: List of org clinicians + voice profile status (enrolled / not / revoked / pending hard delete), consent versions, BIPA-required notice
- **Primary actions**: View status, revoke a clinician's profile (admin-initiated, audited)
- **Audited**: Yes (`VOICE_PROFILE_ADMIN_REVOKED`)

### `/admin/audit`
- **Access**: Org admin
- **Layout**: Admin
- **Key elements**: Audit log table (timestamp, actor, action, resource, metadata summary), filters (date range, actor, action type, patient), search, export to CSV
- **Primary actions**: Search audit log, export for compliance review
- **Audited**: Yes (`AUDIT_LOG_VIEWED`, `AUDIT_LOG_EXPORTED`)

### `/admin/org-settings`
- **Access**: Org admin (`SUPER_ADMIN` / `ORG_ADMIN`)
- **Layout**: Admin
- **Key elements**: Force MFA toggle, default note style, default templates per division, voice enrollment policy, audit retention, communication preferences (Twilio config), feature flags
- **Primary actions**: Configure org-wide policies
- **Audited**: Yes (`ORG_SETTINGS_UPDATED` with field list)

---

## Platform Owner (cross-org)

### `/owner/orgs`
- **Access**: `PLATFORM_OWNER`
- **Layout**: Owner
- **Key elements**: All customer orgs, columns for name, division, BAA status (✓ executed / ⚠ pending), seat count, MRR, last-active, "+ New Organization" button, sort/filter
- **Primary actions**: Browse orgs, provision new, drill into org detail
- **Audited**: Yes (`OWNER_ORGS_VIEWED`)

### `/owner/orgs/new`
- **Access**: `PLATFORM_OWNER`
- **Layout**: Owner (sheet form)
- **Key elements**: Name, primary contact, division, billing email, Stripe customer create, BAA fields (required), compliance profile (`STANDARD` / `BH_42CFR2` / `RESEARCH`)
- **Primary actions**: Provision org, auto-invite first admin
- **Audited**: Yes in `PlatformAuditLog` (`ORG_PROVISIONED`)
- **Detail**: Journey 07 Step 1

### `/owner/orgs/[id]`
- **Access**: `PLATFORM_OWNER`
- **Layout**: Owner
- **Key elements**: Org detail (read-mostly for the customer-side fields), BAA section (editable), seat allocation, subscription status, recent activity, impersonate-as-admin button (audited)
- **Primary actions**: Update BAA fields, allocate seats, impersonate for support
- **Audited**: Yes in `PlatformAuditLog` (`BAA_UPDATED`, `SEATS_ALLOCATED`, `IMPERSONATION_STARTED / ENDED`)

### `/owner/users`
- **Access**: `PLATFORM_OWNER`
- **Layout**: Owner
- **Key elements**: All users across all orgs, search by email/name/orgId, impersonate, reset MFA cross-org (rare; emergency)
- **Primary actions**: Cross-org user support
- **Audited**: Yes in `PlatformAuditLog`

### `/owner/audit`
- **Access**: `PLATFORM_OWNER`
- **Layout**: Owner
- **Key elements**: Both `PlatformAuditLog` and `AuditLog` (cross-org) searchable; PHI-free metadata only
- **Primary actions**: Investigate incidents, compliance review
- **Audited**: Yes (`PLATFORM_AUDIT_VIEWED`)

### `/owner/announcements`
- **Access**: `PLATFORM_OWNER`
- **Layout**: Owner
- **Key elements**: Active system announcements, create new, schedule expiration, target (all orgs / specific orgs)
- **Primary actions**: Create / edit / retire announcements
- **Audited**: Yes (`ANNOUNCEMENT_CREATED / UPDATED / RETIRED`)

### `/owner/health`
- **Access**: `PLATFORM_OWNER`
- **Layout**: Owner
- **Key elements**: System health (DB, Redis, S3, Bedrock latency, Soniox uptime, queue depths, recent error rates), CloudWatch link
- **Primary actions**: Triage operational issues
- **Audited**: No (read-only ops surface)

---

## Public / static

### `/`
- **Access**: Public
- **Layout**: Marketing landing (not part of v1 product surface; could be a separate Next.js project or a static page)
- **Key elements**: Brand pitch, "Sign in" button, "Request a demo" button, footer with `/hipaa`, `/privacy`, `/security`, `/terms` links

### `/hipaa`
- **Access**: Public
- **Layout**: Standalone (content page)
- **Key elements**: HIPAA narrative — what PHI we collect, BAA process, patient rights, contact for amendment/deletion requests

### `/privacy`, `/security`, `/terms`
- **Access**: Public
- **Layout**: Standalone (content pages)
- **Key elements**: Legal pages (Privacy Policy, Security Practices, Terms of Service)

---

## What's NOT a screen (clarification)

- **Copilot beacon + sheet** — these are overlays, rendered on top of any clinical/admin screen where they're enabled. Not a route.
- **Toasts, alert dialogs** — overlays.
- **Modal sheets** (PatientEditSheet, SettingsSheet, etc.) — overlays on top of their parent route.
- **Audio worklet** — runs in the browser worker thread; no UI.
- **Background workers** (BullMQ) — server-side; surfaced via SSE progress + audit log.

## How this maps to journeys

| Journey | Primary screens exercised |
|---|---|
| 01 Clinician first day | `/onboarding/[token]`, `/home`, `/profile/setup`, `/profile/voice`, `/prepare`, `/capture`, `/review`, `/sign` |
| 02 Typical visit | `/home`, `/prepare`, `/capture`, `/processing`, `/review`, `/sign` |
| 03 Returning patient + brief | `/prepare`, `/capture` (with `<PriorContextPanel>` + `<OpenFollowUpsCard>` + `<PlanForTodayCard>`), `/review`, `/sign` |
| 04 Section regenerate | `/review` |
| 05 Copilot Ask mode | `/capture` (with `<CopilotSheet>` overlay) |
| 06 Telehealth visit | `/v/[magicToken]`, `/telehealth/waiting/[scheduleId]`, `/telehealth/room/[scheduleId]`, then `/review`, `/sign` |
| 07 Admin onboards a clinic | `/owner/orgs`, `/owner/orgs/new`, `/owner/orgs/[id]`, `/onboarding/[token]`, `/admin/sites`, `/admin/users`, `/admin/org-settings`, `/admin/templates`, `/admin/dashboard` |
| 08 Templates + styles | `/admin/templates`, `/admin/templates/[id]/edit`, `/prepare`, `/capture`, `/review`, `/sign` |

## How this maps to build units

| Wave | Build units | Screens |
|---|---|---|
| Wave 0 — Foundation | 01–05 | `/login`, `/mfa-challenge`, `/password-reset/*`, `/onboarding/[token]`, `/home`, `/patients`, `/patients/[id]` (basic), `/prepare`, `/capture`, `/processing`, `/review`, `/sign`, `/admin/users` (basic) |
| Wave 1 — Copilot + commercial ready | 06–09 | Adds Brief surface to `/prepare` + `/capture`, adds copilot beacon + Watch cards, completes `/admin/sites`, `/admin/templates`, `/admin/seats`, `/admin/billing`, `/admin/voice`, `/admin/audit`, `/admin/org-settings`, `/admin/dashboard`, full `/owner/*` console with BAA |
| Wave 2 — UX maturity | 10–14 | Polish to `/review`, `/sign`, `/patients/[id]` |
| Wave 3 — Telehealth | 15–18 | `/v/[magicToken]`, `/telehealth/waiting/[scheduleId]`, `/telehealth/room/[scheduleId]` |
| Wave 4 — FHIR | 19–24 | Additions to `/prepare` (FHIR-enriched brief), `/admin/integrations` (new), copilot tool registry expands |
| Wave 5 — Copilot maturity | 25–31 | `<CopilotSheet>` becomes full Ask mode; Watch cards expand with FHIR; Research mode + Action tools |
| Wave 6 — Platform | 32–37 | `/owner/*` deepens; `/admin/audit` enrichment; mobile PWA polish; public signup adds `/signup` |
