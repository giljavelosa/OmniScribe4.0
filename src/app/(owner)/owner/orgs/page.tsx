import type { Metadata } from 'next';
import Link from 'next/link';

import { prisma } from '@/lib/prisma';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { OrgsTable } from './_components/orgs-table';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Organizations' };

export default async function OwnerOrgsPage() {
  const orgs = await prisma.organization.findMany({
    where: { isDeleted: false },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { orgUsers: true, seats: true } },
    },
  });

  const rows = orgs.map((org) => ({
    id: org.id,
    name: org.name,
    division: org.division,
    complianceProfile: org.complianceProfile,
    hasBaa: org.baaExecutedAt != null,
    baaVersion: org.baaVersion,
    users: org._count.orgUsers,
    seats: org._count.seats,
  }));

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
          <CardTitle className="text-md">{rows.length} org{rows.length === 1 ? '' : 's'}</CardTitle>
        </CardHeader>
        <OrgsTable orgs={rows} />
      </Card>
    </div>
  );
}
