import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';

export const metadata: Metadata = { title: 'Home' };
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const session = await auth();
  // Layout guarantees session.user exists; this is for the type-checker.
  if (!session?.user) return null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>You&apos;re signed in.</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            The real clinical home arrives in Unit 02 (Patient &amp; Schedule core).
            For Unit 01, this is a confirmation surface.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge variant="info">{session.user.email}</StatusBadge>
            {session.user.role && <StatusBadge variant="neutral">role: {session.user.role}</StatusBadge>}
            {session.user.division && (
              <StatusBadge variant="neutral">division: {session.user.division}</StatusBadge>
            )}
            {session.user.platformRole === 'PLATFORM_OWNER' && (
              <StatusBadge variant="violet">PLATFORM_OWNER</StatusBadge>
            )}
            <StatusBadge variant={session.user.mfaEnabled ? 'success' : 'warning'}>
              MFA {session.user.mfaEnabled ? 'enrolled' : 'not enrolled'}
            </StatusBadge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
