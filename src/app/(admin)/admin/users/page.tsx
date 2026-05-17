import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { UsersToolbar } from './_components/users-toolbar';
import { RowActions } from './_components/row-actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Users' };

export default async function AdminUsersPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect('/home');

  const orgUsers = await prisma.orgUser.findMany({
    where: { orgId: session.user.orgId },
    include: { user: true, seat: true },
    orderBy: { createdAt: 'asc' },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2lg font-semibold">Users</h1>
        <UsersToolbar />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">{orgUsers.length} member{orgUsers.length === 1 ? '' : 's'}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="text-left px-4 py-2 font-medium">Email</th>
                <th className="text-left px-4 py-2 font-medium">Role</th>
                <th className="text-left px-4 py-2 font-medium">Division</th>
                <th className="text-left px-4 py-2 font-medium">MFA</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Seat</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {orgUsers.map((ou) => (
                <tr key={ou.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 font-mono">{ou.user.email}</td>
                  <td className="px-4 py-3">{ou.role}</td>
                  <td className="px-4 py-3">{ou.division}</td>
                  <td className="px-4 py-3">
                    <StatusBadge variant={ou.user.mfaEnabled ? 'success' : 'warning'}>
                      {ou.user.mfaEnabled ? 'enrolled' : 'not enrolled'}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge variant={ou.isActive ? 'success' : 'neutral'}>
                      {ou.isActive ? 'active' : 'deactivated'}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{ou.seat?.tier ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <RowActions
                      userId={ou.user.id}
                      orgUserId={ou.id}
                      email={ou.user.email}
                      isActive={ou.isActive}
                    />
                  </td>
                </tr>
              ))}
              {orgUsers.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                    No team members yet. Invite someone with the button above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
