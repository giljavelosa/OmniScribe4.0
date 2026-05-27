import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { BrandWordmark } from '@/components/brand-wordmark';

export const dynamic = 'force-dynamic';

const ADMIN_ROLES = new Set(['ORG_ADMIN', 'SITE_ADMIN']);

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  // Sprint 0.20 — MFA + login-verified gates removed; only role authorization here.
  if (
    session.user.platformRole !== 'PLATFORM_OWNER' &&
    !(session.user.role && ADMIN_ROLES.has(session.user.role))
  ) {
    redirect('/home');
  }

  return (
    <div className="flex-1 flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl px-4 h-13 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <BrandWordmark />
            <nav className="text-sm flex items-center gap-4">
              <Link href="/admin/users" className="text-muted-foreground hover:text-foreground">
                Users
              </Link>
              <Link href="/admin/sites" className="text-muted-foreground hover:text-foreground">
                Sites
              </Link>
              <Link href="/admin/seats" className="text-muted-foreground hover:text-foreground">
                Seats
              </Link>
              <Link href="/admin/templates" className="text-muted-foreground hover:text-foreground">
                Templates
              </Link>
              <Link href="/admin/audit" className="text-muted-foreground hover:text-foreground">
                Audit
              </Link>
              <Link href="/admin/ai-queries" className="text-muted-foreground hover:text-foreground">
                AI queries
              </Link>
              <Link href="/admin/integrations/fhir" className="text-muted-foreground hover:text-foreground">
                Integrations
              </Link>
              <Link href="/admin/org-settings" className="text-muted-foreground hover:text-foreground">
                Org settings
              </Link>
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
