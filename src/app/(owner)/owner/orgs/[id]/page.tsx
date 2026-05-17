import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { BaaForm } from './_components/baa-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Organization' };

export default async function OwnerOrgPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await prisma.organization.findUnique({
    where: { id },
    include: {
      _count: { select: { orgUsers: true, seats: true, sites: true } },
    },
  });
  if (!org) notFound();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2lg font-semibold">{org.name}</h1>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <StatusBadge variant="neutral">{org.division}</StatusBadge>
          <StatusBadge variant="neutral">{org.complianceProfile}</StatusBadge>
          {org.baaExecutedAt ? (
            <StatusBadge variant="success">BAA {org.baaVersion ?? '—'}</StatusBadge>
          ) : (
            <StatusBadge variant="danger">BAA missing</StatusBadge>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-md">BAA</CardTitle></CardHeader>
          <CardContent>
            <BaaForm
              orgId={org.id}
              initial={{
                baaExecutedAt: org.baaExecutedAt ? org.baaExecutedAt.toISOString().slice(0, 10) : null,
                baaVersion: org.baaVersion,
                complianceProfile: org.complianceProfile,
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-md">Snapshot</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2 text-muted-foreground">
            <p>Sites: {org._count.sites}</p>
            <p>Seats: {org._count.seats}</p>
            <p>Users: {org._count.orgUsers}</p>
            <p>Created: {org.createdAt.toLocaleDateString()}</p>
            <p className="pt-2 text-xs italic">
              Seat allocation, subscription view, and impersonation arrive in Unit 09.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
