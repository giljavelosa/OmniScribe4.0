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
  // Sprint 0.20 — MFA + login-verified gates removed; only platform-role check.
  if (session.user.platformRole !== 'PLATFORM_OWNER') redirect('/home');

  return (
    <div className="flex flex-col h-[100dvh] max-h-[100dvh] overflow-hidden">
      <header className="shrink-0 border-b border-border bg-card">
        <div className="mx-auto max-w-6xl px-4 h-13 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <BrandWordmark />
            <StatusBadge variant="violet" noIcon>Owner</StatusBadge>
            <nav className="text-sm flex items-center gap-4">
              <Link href="/owner/orgs" className="text-muted-foreground hover:text-foreground">Orgs</Link>
              <Link href="/owner/users" className="text-muted-foreground hover:text-foreground">Users</Link>
              <Link href="/owner/audit" className="text-muted-foreground hover:text-foreground">Audit</Link>
              <Link href="/owner/announcements" className="text-muted-foreground hover:text-foreground">Announcements</Link>
              <Link href="/owner/health" className="text-muted-foreground hover:text-foreground">Health</Link>
              <Link href="/owner/pricing-insights" className="text-muted-foreground hover:text-foreground">Pricing</Link>
              <Link href="/owner/commercial/catalog" className="text-muted-foreground hover:text-foreground">Catalog</Link>
            </nav>
          </div>
          <Link href="/home" className="text-xs text-muted-foreground hover:text-foreground">
            ← back to home
          </Link>
        </div>
      </header>
      <main className="flex-1 min-h-0 overflow-hidden flex flex-col mx-auto w-full max-w-6xl px-4 py-6">
        {children}
      </main>
    </div>
  );
}
