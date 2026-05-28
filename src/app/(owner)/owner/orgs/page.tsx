import type { Metadata } from 'next';
import Link from 'next/link';

import { prisma } from '@/lib/prisma';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { ScrollableTablePanel } from '@/components/ui/scrollable-table-panel';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Organizations' };

export default async function OwnerOrgsPage() {
  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { orgUsers: true, seats: true } },
    },
  });

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      <div className="shrink-0 flex items-center justify-between">
        <h1 className="text-2lg font-semibold">Organizations</h1>
        <Button asChild>
          <Link href="/owner/orgs/new">+ New Organization</Link>
        </Button>
      </div>

      <Card className="flex flex-col flex-1 min-h-0 gap-0 py-0 overflow-hidden">
        <CardHeader className="shrink-0 pb-4">
          <CardTitle className="text-md">{orgs.length} org{orgs.length === 1 ? '' : 's'}</CardTitle>
        </CardHeader>
        <ScrollableTablePanel className="flex-1 min-h-0 mx-6 mb-6 border-0 rounded-none">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground sticky top-0 z-10 bg-card backdrop-blur-sm">
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Division</th>
                <th className="text-left px-4 py-2 font-medium">Compliance</th>
                <th className="text-left px-4 py-2 font-medium">BAA</th>
                <th className="text-left px-4 py-2 font-medium">Users</th>
                <th className="text-left px-4 py-2 font-medium">Seats</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr key={org.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/owner/orgs/${org.id}`} className="hover:underline">
                      {org.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{org.division}</td>
                  <td className="px-4 py-3">{org.complianceProfile}</td>
                  <td className="px-4 py-3">
                    {org.baaExecutedAt ? (
                      <StatusBadge variant="success">on file ({org.baaVersion ?? '—'})</StatusBadge>
                    ) : (
                      <StatusBadge variant="danger">missing</StatusBadge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{org._count.orgUsers}</td>
                  <td className="px-4 py-3 text-muted-foreground">{org._count.seats}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/owner/orgs/${org.id}`} className="text-xs text-muted-foreground hover:underline">
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
              {orgs.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">No orgs yet.</td></tr>
              )}
            </tbody>
          </table>
        </ScrollableTablePanel>
      </Card>
    </div>
  );
}
