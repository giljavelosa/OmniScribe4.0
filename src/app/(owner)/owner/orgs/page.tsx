import type { Metadata } from 'next';
import Link from 'next/link';

import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';

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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2lg font-semibold">Organizations</h1>
        <Button asChild>
          <Link href="/owner/orgs/new">+ New Organization</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">{orgs.length} org{orgs.length === 1 ? '' : 's'}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
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
        </CardContent>
      </Card>
    </div>
  );
}
