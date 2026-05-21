# Unit 01: Foundation — Auth & Tenancy

> **Wave 0.** The `Seat` model in this unit is **Wave 7 §01** (billing foundation) — see [`00-build-plan.md`](00-build-plan.md) Wave 7.

## Goal

Build the multi-tenant identity, access-control, and BAA-tracking foundation that every subsequent unit depends on. After this unit, the product has Organizations (with BAA fields), Sites, Rooms, Users with role-based access, MFA TOTP, password reset, customer self-onboarding wizard, the `requireFeatureAccess` middleware, and PHI-scoping helpers — all backed by seed data that lets a developer sign in immediately.

## Design

UI surfaces in this unit are admin + auth flows; clinical surfaces come later.

- **`/login`** — centered card, brand wordmark, email + password, "Forgot password" link, "Sign in" button (primary teal)
- **`/mfa-challenge`** — 6-digit TOTP input, "Use recovery code" link
- **`/password-reset/request`** + **`/password-reset/confirm`** — simple form pages
- **`/onboarding/[token]`** — 4-step wizard: welcome → password → MFA enrollment (QR + recovery codes) → done → redirect to `/home`
- **`/admin/users`** — user list with row dropdown (Edit, Reset MFA, Send password reset, Deactivate); "+ Invite user" sheet
- **`/owner/orgs`** — list of all orgs with BAA-status column; "+ New Organization" CTA → provisioning form with required BAA fields
- **`/owner/orgs/[id]`** — org detail with BAA section + seat allocation (rest in Unit 09)

All admin/owner surfaces use the standard layout from `ui-context.md`: `<Card>` containers, `<StatusBadge>` for status, `<DropdownMenu>` for row actions, `<AlertDialog>` for destructive confirmations.

Reference: [`references/audit-admin-state-of-play.md`](../../references/audit-admin-state-of-play.md) (the canonical commercial-readiness audit that informs this unit).

## Implementation

### A. Prisma schema — tenancy + identity

In `prisma/schema.prisma`:

```prisma
enum ComplianceProfile {
  STANDARD     // HIPAA-only
  BH_42CFR2    // adds 42 CFR Part 2 controls
  RESEARCH     // adds research-data handling controls
}

enum OrgRole {
  SUPER_ADMIN
  ORG_ADMIN
  SITE_ADMIN
  CLINICIAN
  VIEWER
}

enum PlatformRole {
  PLATFORM_OWNER
  NONE
}

enum Division {
  MEDICAL
  REHAB
  BEHAVIORAL_HEALTH
  MULTI
}

enum SeatTier {
  SOLO
  TEAM
  ENTERPRISE
}

enum NoteStyle {
  NARRATIVE
  HYBRID
  HYBRID_BULLET
  STRUCTURED
}

model Organization {
  id                  String   @id @default(cuid())
  name                String
  division            Division
  defaultDivision     Division?
  billingEmail        String
  stripeCustomerId    String?
  forceMfa            Boolean  @default(false)
  
  // BAA tracking (required for v1)
  baaExecutedAt       DateTime?
  baaVersion          String?
  baaCountersignedBy  String?      // userId of platform owner
  complianceProfile   ComplianceProfile @default(STANDARD)
  
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  
  sites               Site[]
  orgUsers            OrgUser[]
  // ... more relations added in Unit 02+
  
  @@index([baaExecutedAt])
}

model Site {
  id              String   @id @default(cuid())
  orgId           String
  organization    Organization @relation(fields: [orgId], references: [id])
  name            String
  address         String?
  phone           String?
  primaryDivision Division?
  isArchived      Boolean  @default(false)
  archivedAt      DateTime?
  createdAt       DateTime @default(now())
  
  rooms           Room[]
  // ... departments added in Unit 02
}

model Room {
  id          String   @id @default(cuid())
  siteId      String
  site        Site     @relation(fields: [siteId], references: [id])
  name        String
  isArchived  Boolean  @default(false)
  archivedAt  DateTime?
  createdAt   DateTime @default(now())
}

model User {
  id              String   @id @default(cuid())
  email           String   @unique
  name            String?
  image           String?
  passwordHash    String
  mfaSecret       String?
  mfaEnabled      Boolean  @default(false)
  mfaRecoveryCodes Json?    // hashed recovery codes
  platformRole    PlatformRole @default(NONE)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  orgUsers        OrgUser[]
  sessions        UserSession[]
}

model OrgUser {
  id                    String   @id @default(cuid())
  userId                String
  user                  User     @relation(fields: [userId], references: [id])
  orgId                 String
  organization          Organization @relation(fields: [orgId], references: [id])
  role                  OrgRole
  division              Division
  profession            String?
  canManagePatients     Boolean  @default(false)
  preferredNoteStyle    NoteStyle @default(HYBRID)
  isActive              Boolean  @default(true)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  
  seatId                String?  @unique
  seat                  Seat?    @relation(fields: [seatId], references: [id])
  
  @@unique([userId, orgId])
  @@index([orgId, role])
}

model Seat {
  id              String   @id @default(cuid())
  orgId           String
  organization    Organization @relation(fields: [orgId], references: [id])
  tier            SeatTier
  expiresAt       DateTime
  createdAt       DateTime @default(now())
  
  assignedTo      OrgUser?
}

model UserSession {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  token       String   @unique
  expiresAt   DateTime
  createdAt   DateTime @default(now())
}

model PractitionerProfile {
  id              String   @id @default(cuid())
  orgUserId       String   @unique
  orgUser         OrgUser  @relation(fields: [orgUserId], references: [id])
  npi             String?
  specialty       String?
  displayName     String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model Invite {
  id              String   @id @default(cuid())
  email           String
  orgId           String
  organization    Organization @relation(fields: [orgId], references: [id])
  role            OrgRole
  division        Division
  profession      String?
  canManagePatients Boolean @default(false)
  token           String   @unique
  expiresAt       DateTime
  consumedAt      DateTime?
  consumedByUserId String?
  invitedByUserId String
  createdAt       DateTime @default(now())
  
  @@index([orgId, email])
}

model AuditLog {
  id              String   @id @default(cuid())
  userId          String?
  orgId           String?
  actingUserId    String?  // for impersonation: the platform owner acting
  onBehalfOfUserId String? // for impersonation: the user they're acting as
  action          String   // e.g. 'USER_CREATED', 'NOTE_SIGNED', 'BAA_UPDATED'
  resourceType    String?
  resourceId      String?
  metadata        Json?    // PHI-FREE
  createdAt       DateTime @default(now())
  
  @@index([orgId, createdAt])
  @@index([userId, createdAt])
}

model PlatformAuditLog {
  id              String   @id @default(cuid())
  actingUserId    String
  action          String
  resourceType    String?
  resourceId      String?
  metadata        Json?    // PHI-FREE
  createdAt       DateTime @default(now())
  
  @@index([actingUserId, createdAt])
}

model PlatformSession {
  id          String   @id @default(cuid())
  userId      String
  token       String   @unique
  expiresAt   DateTime
  createdAt   DateTime @default(now())
}

model FeatureFlag {
  id          String   @id @default(cuid())
  orgId       String
  organization Organization @relation(fields: [orgId], references: [id])
  key         String
  value       Json
  
  @@unique([orgId, key])
}

model SystemAnnouncement {
  id          String   @id @default(cuid())
  title       String
  body        String   // markdown
  severity    String   // 'info' | 'warning' | 'critical'
  targetOrgIds String[] // empty = all
  startsAt    DateTime
  endsAt      DateTime?
  createdAt   DateTime @default(now())
  createdByUserId String
}

model IpAllowlistEntry {
  id          String   @id @default(cuid())
  orgId       String
  organization Organization @relation(fields: [orgId], references: [id])
  cidr        String
  description String?
  createdAt   DateTime @default(now())
}
```

Run `npx prisma migrate dev --name init`. Update seed (`prisma/seed.ts`) — see §F.

### B. NextAuth.js v5 setup

`src/lib/auth.config.ts`:

```ts
import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { prisma } from './prisma';

export const authConfig: NextAuthConfig = {
  pages: { signIn: '/login' },
  session: { strategy: 'jwt' },
  providers: [
    Credentials({
      credentials: { email: { label: 'Email' }, password: { label: 'Password', type: 'password' } },
      async authorize(creds) {
        // 1. Validate inputs
        const email = (creds.email as string)?.toLowerCase();
        const password = creds.password as string;
        if (!email || !password) return null;
        // 2. Load user + first active org membership (for v1, single-org users)
        const user = await prisma.user.findUnique({ where: { email }, include: { orgUsers: { where: { isActive: true }, take: 1, include: { organization: true } } } });
        if (!user) return null;
        if (!await compare(password, user.passwordHash)) return null;
        // Return User shape; org-specific data populated in jwt callback
        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        // Initial sign-in: load OrgUser + populate token
        const orgUser = await prisma.orgUser.findFirst({
          where: { userId: user.id, isActive: true },
          include: { organization: true, user: true },
        });
        if (orgUser) {
          token.orgId = orgUser.orgId;
          token.role = orgUser.role;
          token.division = orgUser.division;
          token.profession = orgUser.profession;
          token.mfaEnabled = orgUser.user.mfaEnabled;
          token.mfaVerified = false; // re-verify on MFA challenge
          token.platformRole = orgUser.user.platformRole;
        }
      }
      if (trigger === 'update') {
        // Re-fetch on session updates (e.g., after MFA enrollment or role change)
        // ...
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.sub!;
      session.user.orgId = token.orgId;
      session.user.role = token.role;
      session.user.division = token.division;
      session.user.profession = token.profession;
      session.user.mfaEnabled = token.mfaEnabled;
      session.user.mfaVerified = token.mfaVerified;
      session.user.platformRole = token.platformRole;
      return session;
    },
  },
};
```

`src/lib/auth.ts`:

```ts
import NextAuth from 'next-auth';
import { authConfig } from './auth.config';

export const { auth, signIn, signOut, handlers } = NextAuth(authConfig);
```

`src/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from '@/lib/auth';
export const { GET, POST } = handlers;
```

### C. MFA TOTP

`src/lib/mfa.ts`:

```ts
import { authenticator } from 'otplib';
import { randomBytes } from 'crypto';
import { hash } from 'bcryptjs';

export function generateMfaSecret(): string {
  return authenticator.generateSecret();
}

export function buildOtpAuthUri(email: string, secret: string): string {
  return authenticator.keyuri(email, 'OmniScribe', secret);
}

export function verifyTotpToken(secret: string, token: string): boolean {
  return authenticator.verify({ token, secret });
}

export async function generateRecoveryCodes(count = 10): Promise<{ plain: string[]; hashed: string[] }> {
  const plain = Array.from({ length: count }, () => randomBytes(5).toString('hex').toUpperCase());
  const hashed = await Promise.all(plain.map(code => hash(code, 10)));
  return { plain, hashed };
}
```

Pages:
- `src/app/(auth)/mfa-challenge/page.tsx` — TOTP input; on submit → POST `/api/auth/mfa/verify` → sets `mfaVerified: true` in token via session update trigger
- `src/app/(auth)/login/page.tsx` — if user has `mfaEnabled` but token doesn't have `mfaVerified: true`, redirect to `/mfa-challenge`

### D. Password reset

Routes:
- `POST /api/auth/password-reset/request` — `{ email }` → generate single-use token (32 bytes random, 1h expiry) → store in DB → email via Resend
- `GET /api/auth/password-reset/verify?token=...` → 200 if valid + unconsumed, 410 if not
- `POST /api/auth/password-reset/confirm` — `{ token, newPassword }` → bcrypt hash → consume token → invalidate all `UserSession`s

Pages:
- `src/app/(auth)/password-reset/request/page.tsx`
- `src/app/(auth)/password-reset/confirm/page.tsx`

Audit: `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET_COMPLETED`.

### E. Admin-initiated MFA reset + password reset

Routes:
- `POST /api/admin/users/[id]/reset-mfa` — `requireFeatureAccess('TEAM_MEMBERS_MANAGE')` + admin re-MFA challenge + reason text → clears `User.mfaSecret`, sets `mfaEnabled = false`, invalidates user's sessions, emails user. Audit `MFA_RESET` with `targetUserId`, `actingUserId`, `reason`.
- `POST /api/admin/users/[id]/send-password-reset` — `requireFeatureAccess('TEAM_MEMBERS_MANAGE')` → generates reset token via existing flow + emails user. Audit `PASSWORD_RESET_INITIATED_BY_ADMIN`.

UI: `/admin/users` row dropdown → `<AlertDialog>` with reason textarea (for MFA reset) → confirm.

### F. Customer self-onboarding wizard

Route: `/onboarding/[token]` (public; no session needed yet).

State machine (server-derived from `Invite` + `User`):
- If `Invite.consumedAt == null` → step 1 (welcome)
- If consumed but `User.mfaEnabled == false` → step 3 (MFA)
- If MFA enrolled → step 4 (done; auto-sign-in + redirect to `/home`)

Page split into 4 server-component steps + client form for inputs.

**Step 1 — Welcome**: load `Invite` + `Organization` + `invitedByUser` → display. "Get started" button.

**Step 2 — Password**: form with password + confirm; validation (8+ chars, mixed case + number/symbol); submit → `POST /api/onboarding/[token]/password` → hash + create `User` + link existing `OrgUser` + consume `Invite`.

**Step 3 — MFA**: generate secret + QR code (use `qrcode` npm); verify TOTP input; on success → generate + display + offer download of recovery codes; "I've saved them" checkbox required.

**Step 4 — Done**: server creates NextAuth session; auto-redirect to `/home`.

Audit at every step.

### G. Invite flow

Admin invite route: `POST /api/admin/users` — `requireFeatureAccess('TEAM_MEMBERS_MANAGE')` + form input → creates `Invite` + sends email + creates pre-linked `OrgUser` (active=false until invite consumed) + audit.

Invite acceptance route inside `/onboarding/[token]/password` (see Step 2 above) MUST check `Invite.expiresAt > now()` — return 410 Gone if expired with clear messaging. Audit `INVITE_CONSUMED`.

### H. `requireFeatureAccess` middleware

`src/lib/authz/server.ts`:

```ts
import { auth } from '@/lib/auth';
import { canUseFeature } from './internal-authorization';
import type { FeatureKey } from './types';
import { NextResponse } from 'next/server';

export async function requireFeatureAccess(featureKey: FeatureKey, req: Request) {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 }) };
  }
  // Re-load OrgUser to get fresh permissions (avoid stale JWT)
  const orgUser = await prisma.orgUser.findFirst({
    where: { userId: session.user.id, orgId: session.user.orgId, isActive: true },
    include: { user: true, organization: true },
  });
  if (!orgUser) {
    return { error: NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 }) };
  }
  if (!canUseFeature(featureKey, orgUser)) {
    return { error: NextResponse.json({ error: { code: 'forbidden', message: `Missing feature: ${featureKey}` } }, { status: 403 }) };
  }
  // MFA gate for sensitive features
  if (orgUser.organization.forceMfa && !orgUser.user.mfaEnabled) {
    return { error: NextResponse.json({ error: { code: 'mfa_required' } }, { status: 403 }) };
  }
  return { user: session.user, orgUser, authorizationUser: { /* role, division, profession */ } };
}
```

`src/lib/authz/internal-authorization.ts` — the `canUseFeature(featureKey, orgUser)` predicate; matrix of `(OrgRole × Division × FeatureKey) → boolean`.

`src/lib/authz/types.ts` — `FeatureKey` enum (TypeScript type), exhaustive list per `code-standards.md` Auth section.

### I. PHI scoping helpers

`src/lib/phi-access.ts`:

```ts
export function canAccessClinicianOwnedResource(
  resource: { orgId: string; clinicianOrgUserId?: string },
  user: { orgId: string; orgUserId: string; role: OrgRole }
): boolean {
  if (resource.orgId !== user.orgId) return false;
  // Org admins access all; clinicians access their own
  if (user.role === 'CLINICIAN' && resource.clinicianOrgUserId && resource.clinicianOrgUserId !== user.orgUserId) {
    return false;
  }
  return true;
}
```

Every Prisma query touching PHI MUST include `orgId` in WHERE. Use a Prisma extension or helper if it's getting easy to forget.

### J. Seed data

`prisma/seed.ts` creates:
- 1 Organization (`Demo Clinic`, division `MULTI`, BAA executed, complianceProfile `STANDARD`)
- 1 Site (`Demo Main Office`) with 2 Rooms
- 5 Users: `admin@demo.local` (SUPER_ADMIN, MFA-enabled with known seed secret for dev), `clinician@demo.local` (CLINICIAN), `viewer@demo.local` (VIEWER), `siteadmin@demo.local` (SITE_ADMIN), `owner@demo.local` (PLATFORM_OWNER)
- All passwords `Demo1234!` (bcrypt hashed)
- 5 Seats (one per user, tier TEAM)
- (Patient + Encounter seed data added in Unit 02)

Every seeded action is wrapped in a transaction. Audit log entries are not seeded (audit log is for runtime, not seed).

### K. Audit logging

`src/lib/audit/log.ts`:

```ts
import { prisma } from '@/lib/prisma';

export async function writeAuditLog(entry: {
  userId?: string;
  orgId?: string;
  actingUserId?: string;
  onBehalfOfUserId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  // PHI-free check (lint or runtime): metadata must not contain known PHI field names
  await prisma.auditLog.create({ data: entry });
}
```

**NEVER wrap audit writes in try/catch that swallows errors.** If audit fails, the request fails.

## Dependencies

- `next-auth@5.0.0-beta` and `@auth/prisma-adapter@2.x`
- `bcryptjs@3.x`
- `otplib@12.x` (TOTP)
- `qrcode@1.5.x` (client-side QR rendering for MFA enrollment)
- `resend@x.x` (Resend SDK for email)
- `zod@4.x`
- `prisma@7.x` and `@prisma/client@7.x`

Add to `package.json`. Run `npm install`. Run `npx prisma generate`.

## Verify when done

- [ ] Schema: `Organization` has BAA fields with migration applied; all listed models present with relations.
- [ ] Seed runs cleanly: 1 org, 1 site, 2 rooms, 5 users, 5 seats; all sign-in-able with `Demo1234!`.
- [ ] Sign-in works: `clinician@demo.local` / `Demo1234!` → MFA challenge if mfaEnabled → land at `/home` (Unit 02 will build that page; for Unit 01, render a placeholder).
- [ ] Password reset works end-to-end (request → email → reset → all sessions invalidated).
- [ ] Admin-initiated MFA reset works (admin re-MFAs, types reason, user receives email, sessions invalidated, user re-enrolls on next sign-in, audit entry exists).
- [ ] Customer self-onboarding wizard completes end-to-end with a test invite (welcome → password → MFA → done → auto-sign-in).
- [ ] Expired invite tokens return 410 Gone.
- [ ] `requireFeatureAccess` callable in API routes and returns `{ user, orgUser, authorizationUser }` or `{ error }`.
- [ ] `orgId` is in WHERE clause of every PHI Prisma query (verify by code grep on common patterns).
- [ ] Platform owner can provision a new Org via `/owner/orgs/new` with BAA fields required.
- [ ] All admin actions write audit log entries with PHI-free metadata.
- [ ] `npm run build` + `npm run lint` pass.
- [ ] Three-lens evaluation: Clinician (onboarding wizard is welcoming, not bureaucratic), Compliance (BAA fields enforce HIPAA business-associate process; MFA + password reset + invite expiration + audit), Auditor (every admin action logged with reconstructable metadata).
- [ ] `progress-tracker.md` updated: Unit 01 moves to Completed with date and PR link.
