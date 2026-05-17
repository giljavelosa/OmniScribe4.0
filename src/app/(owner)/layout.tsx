import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { BrandWordmark } from '@/components/brand-wordmark';
import { StatusBadge } from '@/components/ui/status-badge';

export const dynamic = 'force-dynamic';

export default async function OwnerLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!session.user.mfaEnabled) redirect('/mfa-setup');
  if (!session.user.mfaVerified) redirect('/mfa-challenge');
  if (session.user.platformRole !== 'PLATFORM_OWNER') redirect('/home');

  return (
    <div className="flex-1 flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl px-4 h-13 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <BrandWordmark />
            <StatusBadge variant="violet" noIcon>Owner</StatusBadge>
            <nav className="text-sm flex items-center gap-4">
              <Link href="/owner/orgs" className="text-muted-foreground hover:text-foreground">Orgs</Link>
              <span className="text-muted-foreground/40">Users · Unit 09</span>
              <span className="text-muted-foreground/40">Audit · Unit 09</span>
              <span className="text-muted-foreground/40">Announcements · Unit 09</span>
              <span className="text-muted-foreground/40">Health · Unit 09</span>
            </nav>
          </div>
          <Link href="/home" className="text-xs text-muted-foreground hover:text-foreground">
            ← back to home
          </Link>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
