import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { BrandWordmark } from '@/components/brand-wordmark';
import { postSigninRedirect } from '@/lib/post-signin-redirect';

export const dynamic = 'force-dynamic';

export default async function ClinicalLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  // Enforce the D2 always-required MFA chain on every protected surface.
  const target = postSigninRedirect({
    mfaEnabled: session.user.mfaEnabled,
    mfaVerified: session.user.mfaVerified,
  });
  if (target !== '/home') redirect(target);

  return (
    <div className="flex-1 flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl px-4 h-13 flex items-center justify-between">
          <BrandWordmark />
          <p className="text-xs text-muted-foreground">
            {session.user.email}
          </p>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
