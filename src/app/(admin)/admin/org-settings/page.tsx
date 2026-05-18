import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { OrgSettingsForm } from './_components/org-settings-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Organization settings' };

export default async function AdminOrgSettingsPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect('/home');

  const org = await prisma.organization.findUnique({
    where: { id: session.user.orgId },
  });
  if (!org) notFound();

  return (
    <div className="space-y-4">
      <h1 className="text-2lg font-semibold">Org settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Organization</CardTitle>
          <CardDescription>
            Settings that apply org-wide. BAA execution lives in the owner console (
            <code>/owner/orgs/[id]</code>) — owner-only by design.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrgSettingsForm
            initial={{
              name: org.name,
              division: org.division,
              defaultDivision: org.defaultDivision,
              forceMfa: org.forceMfa,
              complianceProfile: org.complianceProfile,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">BAA snapshot</CardTitle>
          <CardDescription>Read-only here. Owner console manages execution.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {org.baaExecutedAt ? (
            <p className="flex items-center gap-2">
              <StatusBadge variant="success">✓ on file</StatusBadge>
              <span>
                Version <code>{org.baaVersion ?? '—'}</code> executed{' '}
                {org.baaExecutedAt.toLocaleDateString()}.
              </span>
            </p>
          ) : (
            <p className="flex items-center gap-2">
              <StatusBadge variant="warning">⚠ pending</StatusBadge>
              <span>No BAA on file — owner must execute before production deploy.</span>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
