import type { Metadata } from 'next';

import { prisma } from '@/lib/prisma';
import { AnnouncementsClient } from './_components/announcements-client';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Owner — announcements' };

export default async function OwnerAnnouncementsPage() {
  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2lg font-semibold">Announcements</h1>
      <AnnouncementsClient orgs={orgs} />
    </div>
  );
}
