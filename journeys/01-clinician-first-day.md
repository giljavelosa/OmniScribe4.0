# Journey 01 — Clinician's First Day

> **Sprint 0.20 — MFA removed.** Any reference to MFA, /mfa-challenge, /mfa-setup, TOTP, authenticator app setup, or login-verified gates in this document is HISTORICAL. Authentication is now password-only. See `context/specs/01-foundation-auth-tenant.md` and `progress-tracker.md`.


> A new clinician at a customer clinic. Goes from "I got an invite email" to "I just signed my first OmniScribe note" in under 20 minutes.

## Who

**Sam Rivera**, RN, Behavioral Health, joining a 4-clinician outpatient counseling group in Chicago. Sam's clinic adopted OmniScribe last month; their org admin (Dr. Ortega) just added Sam as a clinician seat. Sam has never used OmniScribe before. They've used two other AI scribes and one EHR with a built-in scribe; they're skeptical but open.

## The journey at a glance

It's Sam's first morning. By 8:30 AM Sam has accepted an invite, set a password, enrolled MFA, signed in, walked through a 60-second product orientation, and completed their first OmniScribe-recorded session with a patient.

This journey has to work, or Sam never uses OmniScribe a second time.

## The journey, step by step

### Step 1 — The invite email, 8:00 AM the night before

Sam's email contains:

> **You've been invited to OmniScribe**
>
> Dr. Maria Ortega added you to **Lakeshore Counseling Group** as a Clinician.
>
> [Get started → ] (single-use link)
>
> This link expires in 7 days.
>
> Lakeshore Counseling Group uses OmniScribe to capture and document clinical sessions. Setting up your account takes about 5 minutes — you'll set a password and enable two-factor authentication.

Sam taps the link on their phone. The link routes to **`/onboarding/[token]`**.

**Behind the scenes**: `Invite` row exists with `expiresAt = createdAt + 7d`, `consumedAt = null`. Token is single-use, server-side validated.

### Step 2 — Welcome, 8:01 AM

**Screen: `/onboarding/[token]` step 1 (Welcome)** — Full-page, no clinical chrome:

- **OmniScribe wordmark** centered (Geist Sans, teal→green gradient)
- **Heading**: "Welcome to OmniScribe, Sam"
- **Body**:
  - "You've been invited to **Lakeshore Counseling Group** by **Dr. Maria Ortega** as a **Clinician**."
  - "We'll set up your account in 3 steps:"
    1. Set a password
    2. Enable two-factor authentication (TOTP)
    3. Done — you'll land on your home screen
- **Primary button**: "Get started"

Sam taps **Get started**.

### Step 3 — Set password, 8:02 AM

**Screen: `/onboarding/[token]` step 2 (Password)**:

- **Heading**: "Choose a password"
- **Inputs**: password + confirm password
- **Validation**: 8+ chars, mix of upper + lower + number + symbol; live indicator shows strength
- **Primary button**: "Continue" (disabled until valid)
- **Secondary**: "Why this matters" (link → modal: HIPAA explanation, 2 short paragraphs)

Sam picks a password. Taps **Continue**.

**Behind the scenes**: `POST /api/onboarding/[token]/password` — bcryptjs hash, creates `User`, marks `Invite.consumedAt = now()`. The `OrgUser` row was pre-created by Dr. Ortega's invite action; now the `User.id` is linked. No active session yet (MFA gate next).

### Step 4 — MFA enrollment, 8:03 AM

**Screen: `/onboarding/[token]` step 3 (MFA)**:

- **Heading**: "Enable two-factor authentication"
- **Body**: "We require two-factor authentication for every clinician account. Scan this QR code with your authenticator app — Google Authenticator, Authy, 1Password, Microsoft Authenticator all work."
- **QR code** (large, scannable from phone if on desktop, or copy-paste if same device)
- **Manual entry key** below the QR code (collapsible) — for users with QR-incompatible apps
- **Input**: "Enter the 6-digit code from your authenticator"
- **Primary button**: "Verify"

Sam opens Authy on their phone, scans the QR, gets the 6-digit code, enters it. Taps **Verify**.

**Behind the scenes**: Server checks TOTP via `lib/mfa.ts` (otplib equivalent). On match: `User.mfaEnabled = true`, generates 10 recovery codes.

**Screen update**: "Save your recovery codes" — list of 10 codes; "Download as PDF" button; "Copy all" button; "I've saved them" checkbox required to proceed.

Sam taps **Download as PDF**, saves to phone. Checks "I've saved them." Taps **Continue**.

### Step 5 — Done, 8:04 AM

**Screen: `/onboarding/[token]` step 4 (Done)**:

- **Heading**: "You're all set, Sam"
- **Body**: "Welcome to Lakeshore Counseling Group on OmniScribe. We're taking you to your home screen now."
- Auto-redirect in 3 seconds, or tap "Continue" to go now

**Behind the scenes**: Server creates a NextAuth session (JWT). Audit log: `ONBOARDING_COMPLETED` with `userId`, `orgId`, `inviteId`. Session shape now includes `mfaEnabled: true, mfaVerified: true`.

### Step 6 — Land on home, 8:05 AM

**Screen: `/home`** — Clinical layout (top bar with wordmark + bottom navigation on mobile, or two-pane on desktop):

- **Top bar**: BrandWordmark + Sam's avatar (initials) at the right
- **Body**:
  - **Welcome card** (first-time-only): "Welcome to OmniScribe. Take 60 seconds to learn the basics." [Show me] / [Skip]
  - **Today's schedule**: empty (Sam hasn't been added to today's roster yet — they're seeing patients tomorrow)
  - **Drafts queue**: empty

Sam taps **Show me**.

### Step 7 — 60-second orientation, 8:05 AM

A **`<Sheet>`** slides in from the right with 4 swipeable cards:

1. **"Record a session"** — animated GIF: clinician taps a patient, taps "Start Recording," speaks, taps "Finish & Review." Caption: "Audio captured. AI-generated draft note ready when you finish."
2. **"Review and edit"** — animated GIF: section accordion, inline edit, regenerate-section button. Caption: "Edit what's off. Regenerate any section that didn't land. Your edits never get overwritten unless you say so."
3. **"Sign with confidence"** — animated GIF: review → sign → confirm. Caption: "Your signed note is locked. Addenda are separate records. Patient instructions print automatically."
4. **"Co-Pilot is always there"** — screenshot showing the beacon: "Tap the Sparkles button (bottom-right) anytime to ask Co-Pilot about a patient. Co-Pilot only reads signed notes and verified data — never drafts, never guesses."

Sam taps **Done**.

### Step 8 — Profile setup prompt, 8:06 AM

A non-blocking `<StatusBanner role="status">` at the top of `/home`:

> "Quick setup: tell us your profession + default note style + (optional) record a 30-second voice sample so Co-Pilot can recognize you in transcripts." [Set up now] [Later]

Sam taps **Set up now**.

**Screen: `/profile/setup`** — Three-step settings:
1. **Profession & specialty** — dropdown: RN, behavioral health
2. **Default note style** — choices: Narrative / Hybrid / Hybrid Bullet / Structured. Visual examples for each. Sam picks **Hybrid**.
3. **Voice profile (optional)** — "Record a 30-second sample so Co-Pilot can identify your voice in session transcripts. We use TitaNet to create a 192-dim embedding. We need your consent under BIPA."
   - **Consent checkbox**: "I consent to OmniScribe creating and storing a voice embedding for speaker identification. I understand I can revoke this at any time, and that revocation triggers a 30-day grace period before the embedding is permanently deleted."
   - Sam reads the consent (it's plain language), checks the box, taps **Record sample**.
   - Sam reads the on-screen prompt ("Please read this passage aloud") for 30 seconds. Stops automatically.
   - **Behind the scenes**: Audio uploaded to S3 → `voice-id` worker computes TitaNet embedding → `VoiceProfile` row created with `embedding vector(192)`, `consentVersion: '2026-Q2-v1'`, `consentedAt: now()`.
   - Toast: "Voice profile saved. Co-Pilot will recognize you in future sessions."

Sam returns to `/home`.

### Step 9 — First session, 8:30 AM the next morning

Dr. Ortega has added Sam to today's roster — 6 patients scheduled. Sam's 9:00 AM session is with a new patient (Riley, 28F, anxiety). At 8:55 Sam taps Riley's name in the schedule.

**Screen: `/prepare/[noteId]`** — Riley has no prior visits (no brief). The screen shows:

- Patient identity: "Riley Martinez · 28F · MRN 00582910 · DOB 1997-08-22 · English"
- **First-visit note**: "This is Riley's first visit. No prior-context brief available."
- **Setup form** — Template defaults to "Behavioral Health Intake" (org default for new BH patients), style is "Hybrid" (Sam's preference), division is `BEHAVIORAL_HEALTH`.
- **Sensitivity tier preview**: `BEHAVIORAL_HEALTH` (default; gated to BH-tier-cleared roles per 42 CFR Part 2). Sam can see this — it's a transparent affordance, not a surprise.

Sam doesn't change anything. Taps **Start Recording**.

The flow proceeds as Journey 02 — recording, drafting, review, sign — adapted for BH context. The note finishes signed at 9:53 AM.

### Step 10 — Sam's reaction, 9:54 AM

Sam took 5 minutes on the note review + sign (vs. their usual 12 minutes on the EHR-built-in scribe). The note reads natural. The Plan section captured "follow-up CBT homework assignment" verbatim from Sam's conversation — Sam was impressed.

Sam continues their day.

---

## What just happened — behind the scenes summary

| Step | User action | Data state | Audit log |
|---|---|---|---|
| 1 | Email tap → `/onboarding/[token]` | `Invite` validated; token not yet consumed | `ONBOARDING_OPENED` |
| 2 | Welcome screen | (none) | (none) |
| 3 | Set password | `User` created; `OrgUser` linked; `Invite.consumedAt` set | `USER_CREATED`, `INVITE_CONSUMED` |
| 4 | Enroll MFA (TOTP) | `User.mfaSecret` stored; `User.mfaEnabled = true`; 10 recovery codes generated | `MFA_ENROLLED` |
| 5 | Done → home | NextAuth session created; `mfaVerified: true` | `ONBOARDING_COMPLETED` |
| 6–7 | Home + orientation sheet | (no PHI access yet) | `FIRST_LOGIN` |
| 8 | Voice profile setup (optional) | `VoiceProfile` row with embedding + consent | `VOICE_PROFILE_CREATED` with `consentVersion` |
| 9 | Open first patient | `Note` created in `PREPARING` | `NOTE_PREPARING_OPENED` |
| 10 | Complete first visit (Journey 02 path) | (Journey 02 audit trail) | (Journey 02 audit trail) |

## Edge cases

- **Sam ignores the invite for 8 days.** Token expires. Tapping the link → "This invite has expired. Ask your administrator to send a new one." `Invite` is marked `EXPIRED` server-side. Dr. Ortega receives a notification on next login: "Sam's invite expired; resend?"
- **Sam never enables MFA.** Cannot complete onboarding. The flow blocks until MFA is enrolled. (Public sign-in routes also block until MFA is enrolled.)
- **Sam loses MFA device after enrolling.** Recovery: use a recovery code (sign-in flow accepts code instead of TOTP); if no recovery codes, admin-initiated MFA reset (Dr. Ortega clicks "Reset MFA" on Sam's user row, types a reason, Sam receives an email and re-enrolls on next sign-in).
- **Sam declines voice-profile consent.** Voice ID is skipped; copilot still works for Watch + Ask but cannot identify Sam in transcripts (default heuristic: speaker_1 = clinician).
- **Org has `forceMfa = true` but Sam tries to skip MFA.** Step 4 cannot be skipped; the only path forward is to enroll.
- **Sam's password validation fails.** Real-time feedback under the input ("Must include a number," etc.). Continue button stays disabled.
- **The org admin removes Sam mid-onboarding.** Onboarding session returns 403 on next step; redirect to `/onboarding-cancelled` ("Your invitation has been cancelled. Please contact your administrator.").
- **Sam opens onboarding link on a public computer.** No special handling; session is normal NextAuth JWT. Sam should sign out when done (standard advice surfaced in a non-blocking banner during step 5).

## What surfaces does this journey exercise?

- `/onboarding/[token]` (4 steps: welcome / password / MFA / done)
- `/home` (first time, with welcome card + orientation sheet)
- `/profile/setup` (3-step: profession / style / voice)
- `/prepare/[noteId]` (first visit; no-brief variant)
- `/capture/[noteId]` (BH first-visit recording)
- `/review/[noteId]`, `/sign/[noteId]` (per Journey 02)

## Three-lens evaluation for this journey

**Clinician** — Onboarding is brief, friendly, never patronizing. MFA enrollment is well-supported with multiple app options and recovery codes. Voice profile is opt-in with plain-language consent.

**Medicare Compliance Officer** — Sam's account is provisioned with role-based access controls + MFA before any PHI access. Audit log captures user creation, MFA enrollment, and first PHI access.

**Insurance Auditor** — `BIPA` consent is captured with version. Invite link is single-use + time-limited. Account state transitions (invite → user → mfa-enrolled → first PHI access) are all logged with reconstructable metadata.

## Build-team checklist for "this journey works"

- [ ] A clinician with a valid invite can complete the 4-step onboarding wizard end-to-end on phone + desktop.
- [ ] Expired tokens return 410 Gone with clear messaging.
- [ ] Wizard is resumable if interrupted (state recovered from `Invite.consumedAt` + `User.mfaEnabled`).
- [ ] First-time `/home` shows a welcome card; subsequent visits don't.
- [ ] Voice-profile consent captures version + `consentedAt`; revocation flow exists (covered in Unit 01).
- [ ] Audit log captures every step.
- [ ] Three-lens evaluation passes.

## Related references

- Onboarding details: [`references/audit-admin-state-of-play.md`](../references/audit-admin-state-of-play.md)
- Voice profile + BIPA: [`context/architecture.md`](../context/architecture.md) (Voice ID section)
- Build units delivering this journey: [`context/specs/01-foundation-auth-tenant.md`](../context/specs/01-foundation-auth-tenant.md), [`context/specs/08-admin-and-compliance-ready.md`](../context/specs/08-admin-and-compliance-ready.md)
