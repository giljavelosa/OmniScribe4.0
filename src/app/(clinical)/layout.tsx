import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { BrandWordmark } from '@/components/brand-wordmark';
import { AppNav } from '@/components/app-nav';
import { MobileBottomNav } from '@/components/navigation/mobile-bottom-nav';
import { postSigninRedirect } from '@/lib/post-signin-redirect';

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

  // Fetch the org name once in the layout so every clinical page shows
  // the correct workspace context in the header and bottom nav — no JWT
  // bloat, single lightweight read on every layout render.
  const org = session.user.orgId
    ? await prisma.organization.findUnique({
        where: { id: session.user.orgId },
        select: { name: true },
      })
    : null;
  const orgName = org?.name ?? null;

  // Note: profile-completion gate lives on the two recording-entry pages
  // (/prepare/[noteId], /capture/[noteId]) rather than this layout —
  // admins also record, so we don't want to block /home or /patients on
  // profile completeness.

  return (
    <div className="flex-1 flex flex-col">
      <header className="bg-gradient-to-b from-primary to-primary/90">
        <div className="mx-auto max-w-6xl px-4 min-h-13 py-2 flex items-center gap-4 flex-wrap">
          <BrandWordmark inverted />
          <AppNav
            email={session.user.email}
            role={session.user.role}
            platformRole={session.user.platformRole}
            orgName={orgName}
          />
        </div>
      </header>
      {/* pb-[calc(4rem+env(safe-area-inset-bottom))] clears the fixed
          MobileBottomNav (h-16 = 4rem) + iOS home indicator on mobile.
          Removed at lg+ where the bottom nav is hidden. */}
      <main className="flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
        {children}
      </main>
      <MobileBottomNav
        role={session.user.role}
        platformRole={session.user.platformRole}
        orgName={orgName}
      />
    </div>
  );
}
