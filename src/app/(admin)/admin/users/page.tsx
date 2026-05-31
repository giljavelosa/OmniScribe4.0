import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getClinicianSiteIds } from '@/lib/authz/site-scope';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { UsersToolbar } from './_components/users-toolbar';
import { RowActions } from './_components/row-actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Users' };

type StatusFilter = 'all' | 'active' | 'deactivated';

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.orgId || !session.user.orgUserId) redirect('/home');

  const { status } = await searchParams;
  const statusFilter: StatusFilter =
    status === 'active' || status === 'deactivated' ? status : 'all';

  // SITE_ADMIN scope — limit listing to users enrolled at any of the
  // caller's sites. ORG_ADMIN+ get scope 'all' and see everyone, plus
  // org-wide-role users always remain visible regardless of enrollment
  // (otherwise a site admin could "lose" the org admins from their view).
  const siteScope = await getClinicianSiteIds(
    session.user.orgUserId,
    session.user.orgId,
  );

  const siteScopeWhere =
    siteScope.scope === 'enrolled'
      ? {
          OR: [
            { role: { in: ['ORG_ADMIN' as const] } },
            { siteEnrollments: { some: { siteId: { in: siteScope.siteIds } } } },
          ],
        }
      : {};
  const statusWhere =
    statusFilter === 'active'
      ? { isActive: true }
      : statusFilter === 'deactivated'
        ? { isActive: false }
        : {};

  const [orgUsers, orgSites, statusCounts] = await Promise.all([
    prisma.orgUser.findMany({
      where: {
        orgId: session.user.orgId,
        ...statusWhere,
        ...siteScopeWhere,
      },
      include: {
        user: true,
        seat: true,
        siteEnrollments: { include: { site: { select: { id: true, name: true } } } },
      },
      // Active members first, then deactivated, oldest-first within each group.
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    }),
    prisma.site.findMany({
      where: {
        orgId: session.user.orgId,
        isArchived: false,
        ...(siteScope.scope === 'enrolled' ? { id: { in: siteScope.siteIds } } : {}),
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.orgUser.groupBy({
      by: ['isActive'],
      where: { orgId: session.user.orgId, ...siteScopeWhere },
      _count: { _all: true },
    }),
  ]);

  const activeCount = statusCounts.find((c) => c.isActive)?._count._all ?? 0;
  const deactivatedCount = statusCounts.find((c) => !c.isActive)?._count._all ?? 0;
  const filters: Array<{ key: StatusFilter; label: string; count: number }> = [
    { key: 'all', label: 'All', count: activeCount + deactivatedCount },
    { key: 'active', label: 'Active', count: activeCount },
    { key: 'deactivated', label: 'Deactivated', count: deactivatedCount },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2lg font-semibold">Users</h1>
        <UsersToolbar />
      </div>

      <Card>
        <CardHeader>
          <nav className="flex items-center gap-1" data-testid="admin-users-status-filter">
            {filters.map((f) => {
              const isCurrent = statusFilter === f.key;
              return (
                <Link
                  key={f.key}
                  href={f.key === 'all' ? '/admin/users' : `/admin/users?status=${f.key}`}
                  data-testid={`admin-users-filter-${f.key}`}
                  aria-current={isCurrent ? 'page' : undefined}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    isCurrent
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {f.label} ({f.count})
                </Link>
              );
            })}
          </nav>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="text-left px-4 py-2 font-medium">Email</th>
                <th className="text-left px-4 py-2 font-medium">Role</th>
                <th className="text-left px-4 py-2 font-medium">Division</th>
                <th className="text-left px-4 py-2 font-medium">Sites</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Seat</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {orgUsers.map((ou) => {
                const isAllSitesRole = ou.role === 'ORG_ADMIN';
                const enrolled = ou.siteEnrollments;
                return (
                  <tr
                    key={ou.id}
                    data-testid={`admin-user-row-${ou.user.id}`}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="px-4 py-3 font-mono">{ou.user.email}</td>
                    <td className="px-4 py-3">{ou.role}</td>
                    <td className="px-4 py-3">{ou.division}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {isAllSitesRole ? (
                        <span className="text-xs">All sites</span>
                      ) : enrolled.length === 0 ? (
                        <span className="text-xs italic">None</span>
                      ) : (
                        <span className="text-xs">
                          {enrolled
                            .slice(0, 2)
                            .map((e) => e.site.name)
                            .join(', ')}
                          {enrolled.length > 2 ? ` +${enrolled.length - 2}` : ''}
                        </span>
                      )}
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
                        role={ou.role}
                        orgSites={orgSites}
                        currentEnrollments={enrolled.map((e) => ({
                          siteId: e.siteId,
                          isPrimary: e.isPrimary,
                        }))}
                      />
                    </td>
                  </tr>
                );
              })}
              {orgUsers.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                    {statusFilter === 'deactivated'
                      ? 'No deactivated members.'
                      : statusFilter === 'active'
                        ? 'No active members.'
                        : 'No team members yet. Invite someone with the button above.'}
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
