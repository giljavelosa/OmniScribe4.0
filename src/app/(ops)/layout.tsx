import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';

import { auth } from '@/lib/auth';
import { BrandWordmark } from '@/components/brand-wordmark';
import { StatusBadge } from '@/components/ui/status-badge';

export const dynamic = 'force-dynamic';

/**
 * /ops layout — Unit 33.
 *
 * Gates by PLATFORM_OPS OR PLATFORM_OWNER + MFA. Owner is the strict
 * superset so it appears in BOTH /owner and /ops navs (one user, two
 * consoles, distinct affordances). NONE platformRole sees /home like
 * any other clinician.
 *
 * Mirrors the owner layout shape so muscle memory carries over for ops
 * staff who also have owner access. Distinct "Ops" chip + nav links
 * for quick recognition.
 */
export default async function OpsLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!session.user.mfaEnabled) redirect('/mfa-setup');
  if (!session.user.mfaVerified) redirect('/mfa-challenge');
  if (
    session.user.platformRole !== 'PLATFORM_OPS' &&
    session.user.platformRole !== 'PLATFORM_OWNER'
  ) {
    redirect('/home');
  }

  return (
    <div className="flex-1 flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl px-4 h-13 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <BrandWordmark />
            <StatusBadge variant="warning" noIcon>
              Ops
            </StatusBadge>
            <nav className="text-sm flex items-center gap-4">
              <Link href="/ops" className="text-muted-foreground hover:text-foreground">
                Dashboard
              </Link>
              <Link
                href="/ops/queues"
                className="text-muted-foreground hover:text-foreground"
              >
                Queues
              </Link>
              <Link
                href="/ops/health"
                className="text-muted-foreground hover:text-foreground"
              >
                Health
              </Link>
              <Link
                href="/ops/audit"
                className="text-muted-foreground hover:text-foreground"
              >
                Audit
              </Link>
            </nav>
          </div>
          <Link
            href="/home"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← back to home
          </Link>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
