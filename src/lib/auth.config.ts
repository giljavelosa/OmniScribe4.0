import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit/log';
import { PlatformRole } from '@prisma/client';
import { readActiveImpersonation, type ImpersonationContext } from '@/lib/impersonation';
import {
  evaluateLockState,
  recordFailedAttempt,
  recordSuccessfulAttempt,
} from '@/lib/auth/lockout';
// Sprint 0.20 — login-verification (MFA replacement) removed; the helper
// module was deleted. Sign-in events no longer issue a verification code.

const credentialsSchema = z.object({
  email: z.email().transform((s) => s.toLowerCase()),
  password: z.string().min(1),
});

/**
 * NextAuth v5 config — credentials provider + JWT strategy.
 *
 * Strategy: stateless JWT (no session table). The DB-side UserSession table
 * exists for invalidation use cases (password reset wipes all
 * UserSession rows for a user, which the client treats as "force re-auth"
 * since the JWT validity isn't checked against the table by default — UserSession
 * gates flows that need ground-truth, not the session cookie).
 *
 * Tripwire (NextAuth v5 beta): do NOT add @auth/prisma-adapter to `adapter`
 * here with JWT strategy + credentials provider; the adapter expects database
 * sessions and double-writes will surprise.
 */
export const authConfig = {
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(rawCredentials) {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const user = await prisma.user.findUnique({
          where: { email },
          include: {
            orgUsers: {
              where: {
                isActive: true,
                organization: { isDeleted: false },
              },
              include: { organization: true },
              take: 1,
            },
          },
        });
        if (!user) return null;
        if (user.isDeleted) return null;

        // Unit 37 — account lockout. Refuse logins during the lock
        // window REGARDLESS of password correctness so an attacker
        // pinging the account doesn't see timing artifacts. The
        // signed-in event below still fires on real success after
        // expiry; the audit row distinguishes.
        const lockState = evaluateLockState(user);
        if (lockState.state === 'locked') {
          await writeAuditLog({
            userId: user.id,
            action: 'USER_SIGNED_IN_FAILED',
            metadata: {
              reason: 'locked',
              lockedUntil: lockState.lockedUntil.toISOString(),
            },
          });
          return null;
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          // Unit 37 — increment failed-attempt counter; lock + audit
          // USER_LOCKED if this attempt crosses the threshold. Always
          // return null (no enumeration of valid vs locked).
          await recordFailedAttempt(user.id);
          return null;
        }

        // Successful auth — clear counter; emit USER_UNLOCKED if the
        // user WAS locked (lockedUntil set but past).
        await recordSuccessfulAttempt(user.id, user.lockedUntil);

        const orgUser = user.orgUsers[0] ?? null;

        return {
          id: user.id,
          email: user.email,
          emailVerified: null, // AdapterUser-shape compatibility; we don't use this field
          name: user.name,
          image: user.image,
          orgId: orgUser?.orgId ?? null,
          orgUserId: orgUser?.id ?? null,
          role: orgUser?.role ?? null,
          division: orgUser?.division ?? null,
          profession: orgUser?.profession ?? null,
          professionType: orgUser?.professionType ?? null,
          // Sprint 0.20 — MFA + login-verified removed; auth is password-only.
          platformRole: user.platformRole ?? PlatformRole.NONE,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        // Initial sign-in — copy User shape into the JWT.
        token.id = user.id;
        token.email = user.email!;
        token.orgId = user.orgId ?? null;
        token.orgUserId = user.orgUserId ?? null;
        token.role = user.role ?? null;
        token.division = user.division ?? null;
        token.profession = user.profession ?? null;
        token.professionType = user.professionType ?? null;
        token.platformRole = user.platformRole;
      }

      if (trigger === 'update' && session) {
        // Client called useSession().update(...). Re-fetch the fresh OrgUser
        // row so roles + flags reflect DB state.

        // Unit 32 — impersonation begin/end goes through update().
        // `session.impersonation === null` clears the field; an object
        // sets it; absence leaves the existing value untouched.
        if (session.impersonation === null) {
          token.impersonation = null;
        } else if (session.impersonation !== undefined) {
          // Cast through unknown — the update payload is loosely typed
          // by NextAuth but we wrote this contract ourselves.
          token.impersonation = session.impersonation as ImpersonationContext;
        }

        const fresh = await prisma.user.findUnique({
          where: { id: token.id },
          include: {
            orgUsers: {
              where: {
                isActive: true,
                organization: { isDeleted: false },
              },
              take: 1,
            },
          },
        });
        if (fresh && !fresh.isDeleted) {
          token.platformRole = fresh.platformRole;
          const ou = fresh.orgUsers[0] ?? null;
          token.orgId = ou?.orgId ?? null;
          token.orgUserId = ou?.id ?? null;
          token.role = ou?.role ?? null;
          token.division = ou?.division ?? null;
          token.profession = ou?.profession ?? null;
          token.professionType = ou?.professionType ?? null;
        }
      }

      // Unit 32 — defensively drop expired impersonation tokens on
      // every JWT pass. Past the 60-min cap the field is treated as
      // null at the read site anyway; clearing it here keeps the
      // cookie tidy.
      if (token.impersonation && !readActiveImpersonation(token)) {
        token.impersonation = null;
      }

      return token;
    },

    async session({ session, token }) {
      session.user = {
        id: token.id,
        email: token.email,
        emailVerified: null,
        name: session.user?.name ?? null,
        image: session.user?.image ?? null,
        orgId: token.orgId,
        orgUserId: token.orgUserId,
        role: token.role,
        division: token.division,
        profession: token.profession,
        professionType: token.professionType,
        platformRole: token.platformRole,
      };
      // Unit 32 — surface the active impersonation context (already
      // validated for expiry by the jwt callback above). Banner +
      // route guards read off session.impersonation.
      session.impersonation = readActiveImpersonation(token);
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      // Rule 8: audit writes never wrapped in swallowing try-catch. If audit
      // fails, the sign-in event fails — the user is left signed in (NextAuth
      // already minted the JWT before this event), but the next API call that
      // depends on a healthy DB will surface the underlying problem.
      await writeAuditLog({
        userId: user.id,
        action: 'USER_SIGNED_IN',
        metadata: { method: 'credentials' },
      });
    },
  },
} satisfies NextAuthConfig;
