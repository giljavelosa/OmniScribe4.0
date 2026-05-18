import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Separator } from '@/components/ui/separator';
import { EditSiteForm } from './_components/edit-site-form';
import { RoomsSection } from './_components/rooms-section';
import { SiteRowActions } from '../_components/site-row-actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Site detail' };

export default async function AdminSiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.orgId) redirect('/home');

  const site = await prisma.site.findFirst({
    where: { id, orgId: session.user.orgId },
    include: {
      rooms: { orderBy: [{ isArchived: 'asc' }, { name: 'asc' }] },
      _count: { select: { patients: true, departments: true } },
    },
  });
  if (!site) notFound();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <Link href="/admin/sites" className="text-xs text-muted-foreground hover:underline">
            ← All sites
          </Link>
          <div className="flex items-center gap-2">
            <h1 className="text-2lg font-semibold">{site.name}</h1>
            <StatusBadge variant={site.isArchived ? 'neutral' : 'success'} noIcon>
              {site.isArchived ? 'archived' : 'active'}
            </StatusBadge>
          </div>
          <p className="text-xs text-muted-foreground">
            {site._count.patients} patient{site._count.patients === 1 ? '' : 's'} · {site._count.departments} department
            {site._count.departments === 1 ? '' : 's'} · {site.rooms.length} room
            {site.rooms.length === 1 ? '' : 's'}
          </p>
        </div>
        <SiteRowActions siteId={site.id} siteName={site.name} isArchived={site.isArchived} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Details</CardTitle>
          <CardDescription>
            Site name, contact info, and primary division. Changes audit-log every field that
            actually moved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EditSiteForm
            siteId={site.id}
            initial={{
              name: site.name,
              address: site.address,
              phone: site.phone,
              primaryDivision: site.primaryDivision,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Rooms</CardTitle>
          <CardDescription>
            Rooms group encounters within this site. Archiving a room hides it from new schedules
            but preserves all history.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Separator className="mb-3" />
          <RoomsSection
            siteId={site.id}
            siteIsArchived={site.isArchived}
            rooms={site.rooms}
          />
        </CardContent>
      </Card>
    </div>
  );
}
