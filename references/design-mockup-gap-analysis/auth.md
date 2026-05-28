# Auth + Sign flow — Mockup Gap Analysis

## At a glance
- **Mockup file(s):** `design-mockups-2026-05/auth_flow_redesign.html` (158 lines); `design-mockups-2026-05/sign_flow_redesign.html` (219 lines)
- **Production file(s):** `src/app/(auth)/layout.tsx` (11 lines); `src/app/(auth)/login/page.tsx` (112 lines); `src/app/(auth)/register/page.tsx` (32 lines); `src/app/signup/page.tsx` (210 lines); `src/app/page.tsx` (47 lines); `src/components/auth/register-form.tsx` (274 lines); `src/app/(clinical)/sign/[noteId]/page.tsx` (668 lines); related marketing: `src/components/marketing/omniscribe-ai-landing.tsx` (885+ lines); `src/app/rehab/page.tsx` (684+ lines)
- **Coverage estimate:** auth ~81% built / ~14% partial / ~5% missing; sign flow ~89% built / ~8% partial / ~3% missing
- **Stale mockup note:** The mockup's second card ("Two-factor verification") is **obsolete** — MFA/TOTP was removed in Sprint 0.20. Authentication is now email + password only; sign-time re-auth uses a 4-digit signing PIN (with a time-boxed unlock window). Treat the mockup's MFA card as superseded by the signing-PIN setup/verify surface.
- **Top blocking issue:** Remaining deltas are now mostly optional step-chrome and strict visual rhythm polish, not missing sign-method parity or baseline auth/sign safety UX.

## Mockup summary
**Auth (`auth_flow_redesign.html`):** Two cards on a soft gradient: **Login** with centered brand, subtitle "Sign in to continue to your workspace", sentence-case **Email** / **Password** with inline **Forgot?**, password eye, **Keep me signed in**, primary **Sign in**, **or** divider, **Email me a sign-in link** outline button, footer "New to OmniScribe? **Start a free trial →**", and **HIPAA-ready / SOC 2 Type II / End-to-end encrypted** trust pills. The mockup's second card ("Two-factor verification" with 6 authenticator-code boxes + resend/backup) is **obsolete** — MFA was removed in Sprint 0.20. The current equivalent is a **signing-PIN** setup/verify card: subtitle "Set your signing PIN", a 4-digit per-cell input, an unlock-window note, primary **Save PIN**, footer "Forgot your PIN? **Reset it →**".

**Sign (`sign_flow_redesign.html`):** **State 1:** back chip, **Step 3 of 3** pill, title **Sign and lock**, subcopy that the note becomes a **permanent record** and **cannot be edited**, patient/DOB·MRN/visit/template summary, collapsible **Note content** preview with "Show full note ↗", **How to sign** with three radio rows (**Touch ID** primary, **PIN**, **Type your full name**), **attestation** checkbox with licensure/accuracy language, **sibling warning** ("2 notes… sign both together, or sign just this one"), primary CTA e.g. "Sign both notes with Touch ID", secondary "Sign just this note". **State 2:** large success check, **Note signed**, patient·date, "Signed at… · **Permanent record**", **Note ID** row with "**Locked**", **Optional next steps** (copy, patient instructions, referral), **Done**.

## Production summary
**Auth shell:** Centered card on teal radial gradient, `max-w-sm` (`layout.tsx:7-9`).

**Login:** `BrandWordmark`, workspace-focused subtitle, email/password with forgot link + visibility toggle, remember-device checkbox, primary sign-in, divider, magic-link CTA, footer trial link, and trust pills (`AuthTrustRow`).

**Register:** Thin page wrapping `RegisterForm` with invite vs self-serve copy; `submitLabel` "Start Free Trial" for non-invite (`register/page.tsx:15-29`).

**Signing PIN:** No MFA page exists (removed in Sprint 0.20). Login lands the user directly on `/home`. Sign-time re-auth is a 4-digit signing PIN via `/api/auth/pin/{setup,verify,status}` with a time-boxed unlock window; setup/verify is surfaced at sign time and from the profile surface.

**Signup / landing:** `page.tsx` keeps trial wording and signup/marketing surfaces now use pilot-access copy aligned with published pricing framing.

**Sign:** Includes patient + identifiers + visit + date + template summary, collapsible note preview, attestation gate, sibling-group context, and permanence framing. Success state includes permanent-record badge, signed timestamp, note ID, lock framing, and next actions.

## Element-by-element diff

### Auth — Header
| Mockup | Production | Gap |
|--------|------------|-----|
| Brand + "Sign in to continue **to your workspace**" | "Sign in to continue" | Weaker workspace cue (`login/page.tsx:52` vs mockup line 72). |
| Same brand on MFA + "Two-factor verification" | No MFA page (removed Sprint 0.20) | Mockup MFA card is obsolete; current equivalent is the signing-PIN setup/verify card ("Set your signing PIN"). |

### Auth — Body
| Mockup | Production | Gap |
|--------|------------|-----|
| Forgot password link on password row | Present | Implemented. |
| Password visibility toggle | Present | Implemented. |
| Remember device | Present | Implemented. |
| Magic link secondary CTA | Present (stub-backed) | Implemented with API stub path. |
| 6 OTP cells, paste-friendly (mockup MFA card) | N/A — MFA removed | Obsolete. The surviving code-cell pattern is the 4-digit signing-PIN input. |
| Resend / backup code (mockup MFA card) | N/A — MFA removed | Obsolete. Account recovery is password reset via email. |
| Trust pills under login | Present | Implemented via `AuthTrustRow`. |

### Auth — Footer
| Mockup | Production | Gap |
|--------|------------|-----|
| "New to OmniScribe? Start a free trial →" | "Don't have an account? Start free trial" | Close; mockup arrow + brand name (`login/page.tsx:95-99` vs mockup 108–110). |
| MFA: "Contact support →" (mockup MFA card) | N/A — MFA removed | Obsolete. Signing-PIN card uses "Forgot your PIN? Reset it →". |

### Sign — Header
| Mockup | Production | Gap |
|--------|------------|-----|
| Circular back, **Step 3 of 3** | `ArrowLeft` + "Step 3 of 3" pill | Step framing present; icon chrome differs slightly from mockup. |

### Sign — Body
| Mockup | Production | Gap |
|--------|------------|-----|
| Title **Sign and lock** + permanent-record subcopy | "Sign note" / "Sign visit notes" + shorter lock copy | Legal weight lighter upfront (`sign/[noteId]/page.tsx:520-527` vs mockup 95–97). |
| Rich summary (DOB·MRN, template) | Present | Implemented on sign summary card. |
| Collapsible note preview | Present | Implemented. |
| Touch ID / PIN / typed name | Typed-name + PIN + device-biometric (WebAuthn) methods with method-specific CTA copy | Method parity now close; remaining drift is mostly visual rhythm/chrome. |
| Attestation checkbox | Present | Implemented before sign submission. |
| Sibling warning card | `SiblingEpisodesIndicator` + `canSignAll` / blocking banners | Conceptually aligned; different visual/IA (`sign/[noteId]/page.tsx:274-291, 539-547, 580-588` vs mockup 154–157). |

### Sign — Footer / CTAs
| Mockup | Production | Gap |
|--------|------------|-----|
| Primary "Sign both with Touch ID" style | "Sign all N notes with signature/PIN/device verification" | Device-auth pathway now supported; copy/chrome parity remains optional polish. |
| Explicit "Sign just this note" secondary | Present when siblings | Partial match. |

### Sign — Success
| Mockup | Production | Gap |
|--------|------------|-----|
| "Permanent record", signed time, **Note ID**, **Locked** | Date line, lock sentence, no note ID chip | `finalJson`/record immutability not tied to a visible ID (`sign/[noteId]/page.tsx:434-453` vs mockup 177–184). |
| Structured "Optional next steps" list | Similar actions exist (copy / instructions / referral) | IA differs; mockup uses rows with "Copy →" affordances (`sign/[noteId]/page.tsx:455-500` vs mockup 189–215). |

### Interactions
- **Login:** Credentials + magic-link request flow are both available; login lands directly on `/home` (no MFA step).
- **Signing PIN:** 4-digit PIN setup + verify via `/api/auth/pin/{setup,verify,status}` with a time-boxed unlock window. This is the sign-time re-auth mechanism that replaced re-MFA at sign.
- **Sign:** Production now supports typed-name and PIN pathways (same server signature field), plus preview + attestation + permanence framing.
- **Goal gate:** Production modal for `GOAL_RECS_UNVERIFIED` remains a compliance extension beyond mockup.

## Copy diff
| Location | Production | Mockup / intended |
|----------|------------|-------------------|
| Login subtitle | "Sign in to continue" | "Sign in to continue to your workspace" |
| Login CTA stack | Submit only | + "Email me a sign-in link", Forgot |
| Login footer | "New to OmniScribe? Start a free trial →" | "New to OmniScribe? Start a free trial →" |
| Signing-PIN title | "Set your signing PIN" | (mockup MFA card "Two-factor verification" is obsolete) |
| Signing-PIN field label | "Choose a 4-digit PIN to confirm note signing" | (mockup authenticator-code label is obsolete) |
| Sign title | "Sign note" / "Sign visit notes" | "Sign and lock" |
| Sign explainer | Locks note; sibling paragraph | Permanent record + **cannot be edited** |
| Sign method | "How to sign" with Typed Name + PIN options | Full mockup parity still expects device biometric path |
| Success | "This note is locked. Copy…" | + "Permanent record", signed time, note ID, "Locked" chip |
| Register default button | "Start Free Testing" path on signup | **Task #7** expects "Start free trial" family |

### Task #7 — "Start free testing" / "free testing" across `src/`
Current parity audit sweep found no remaining `free testing` string debt in `src/` for auth/signup surfaces covered by this gap report.

## Token / styling diff
- **Auth mockup:** CSS variables `--primary`, `--color-background-*`, `--color-border-*`, `0.5px` borders, 18px card radius. **Production:** Tailwind `rounded-[28px]`, `border-border/60`, `bg-card/95`, `shadow-xl shadow-primary/5` (`login/page.tsx:43`; `layout.tsx:7`).
- **Hardcoded colors (auth):** Login error `text-red-600/70` (`login/page.tsx:57`); register form error `text-red-600/80` (`register-form.tsx:154`).
- **Sign page:** Success icon uses blue-tinted shadow `rgba(10,132,255,...)` (`sign/[noteId]/page.tsx:430`) while primary brand elsewhere is teal — **inconsistent accent**.
- **Signing PIN:** The PIN setup/verify surface should use theme tokens (`text-destructive`) for errors, consistent with the rest of auth, rather than login's `text-red-600`. (The old `mfa/page.tsx` was removed in Sprint 0.20.)
- **Phase 0:** `StatusBadge` exists with `var(--status-*)` (`status-badge.tsx:6-20`) but **auth/sign pages do not use it** for trust or signatory badges; sign uses raw `destructive` and CSS vars for warnings (`sign/[noteId]/page.tsx:574, 581`).

## Refactor recommendations
1. ~~[sign flow methods] [L] [med]~~ **DONE** — Added WebAuthn-style device-biometric method alongside typed-name and PIN pathways for method-selector parity.
2. [sign header chrome] [S] [low] — Add explicit step-pill framing if wizard semantics become required.
3. [auth polish] [S] [low] — Continue visual/token micro-parity (card radius, border weight, spacing) where strict design fidelity is desired.

## Cross-reference to `cursor-tasks/01-quick-wins.md`
- **Task #7** auth/signup copy debt is substantially retired on current surfaces.
- **Phase 2+ candidates:** biometric/PIN sign methods, optional wizard-step chrome, and deeper sign visual parity polish.

### Sign flow — legal weight & immutability (.cursorrules)
- **Explicit review before sign:** Production now enforces attestation + sign blockers + goal verification modal, aligned with clinician-review requirements.
- **Legal clarity vs mockup:** Permanent-record framing and lock semantics are now explicit in both pre-sign and success UX.
- **`finalJson` immutability:** Success state now surfaces note ID + permanent-record framing, improving auditability cues.
