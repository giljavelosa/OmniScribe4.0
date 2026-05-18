'use client';

import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react';

/**
 * Thin client wrapper around NextAuth's SessionProvider — Unit 32.
 *
 * Mounted at the root layout so `useSession()` (and its `.update()`
 * method) is available on any client component without each surface
 * having to provide its own context.
 *
 * Existing server-side `auth()` reads (the canonical authz path) are
 * unaffected — SessionProvider is additive. The only consumer in v1
 * is the impersonation begin flow + the ImpersonationBanner.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>;
}
