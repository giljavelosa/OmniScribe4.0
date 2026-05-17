import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { CreateSiteSheet } from './_components/create-site-sheet';
import { SiteRowActions } from './_components/site-row-actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sites' };

export default async function AdminSitesPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect('/home');

  const sites = await prisma.site.findMany({
    where: { orgId: session.user.orgId },
    orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { rooms: true } } },
  });

  const activeCount = sites.filter((s) => !s.isArchived).length;
  const archivedCount = sites.length - activeCount;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2lg font-semibold">Sites</h1>
        <CreateSiteSheet />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">
            {activeCount} active site{activeCount === 1 ? '' : 's'}
            {archivedCount > 0 ? ` · ${archivedCount} archived` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {sites.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              No sites yet — tap “Add site” to create your first.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-left px-4 py-2 font-medium">Division</th>
                  <th className="text-left px-4 py-2 font-medium">Address</th>
                  <th className="text-left px-4 py-2 font-medium">Phone</th>
                  <th className="text-left px-4 py-2 font-medium">Rooms</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/admin/sites/${s.id}`} className="hover:underline">
                        {s.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{s.primaryDivision ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{s.address ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{s.phone ?? '—'}</td>
                    <td className="px-4 py-3">{s._count.rooms}</td>
                    <td className="px-4 py-3">
                      <StatusBadge variant={s.isArchived ? 'neutral' : 'success'} noIcon>
                        {s.isArchived ? 'archived' : 'active'}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <SiteRowActions siteId={s.id} siteName={s.name} isArchived={s.isArchived} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
