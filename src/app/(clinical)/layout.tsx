import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { BrandWordmark } from '@/components/brand-wordmark';
import { AppNav } from '@/components/app-nav';
import { postSigninRedirect } from '@/lib/post-signin-redirect';
import { requiresProfileCompletion } from '@/lib/auth/profile-completion';

export const dynamic = 'force-dynamic';

/**
 * Clinical layout — wraps /home, /patients, /capture, /review, /sign,
 * /prepare, /processing, /telehealth.
 *
 * Polish (post-Wave 6): gained the global AppNav so clinicians can
 * reach /patients, /admin (if admin), /owner (if owner), /ops (if
 * ops or owner) without typing URLs. AppNav is role-aware — admin /
 * owner / ops links only render when the user has the matching role.
 */
export default async function ClinicalLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  // Enforce the D2 always-required MFA chain on every protected surface.
  const target = postSigninRedirect({
    mfaEnabled: session.user.mfaEnabled,
    mfaVerified: session.user.mfaVerified,
  });
  if (target !== '/home') redirect(target);

  // Profile-completion gate: a CLINICIAN without a concrete division +
  // categorical professionType cannot reach /capture or any (clinical)
  // surface. Division=MULTI is treated as "not chosen" because it's the
  // org-aggregate value, not a per-clinician scope of practice.
  if (requiresProfileCompletion(session.user)) {
    redirect('/onboarding/profile');
  }

  return (
    <div className="flex-1 flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl px-4 min-h-13 py-2 flex items-center gap-4 flex-wrap">
          <BrandWordmark />
          <AppNav
            email={session.user.email}
            role={session.user.role}
            platformRole={session.user.platformRole}
          />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
