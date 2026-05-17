import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AuditTable } from './_components/audit-table';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Audit log' };

const KNOWN_ACTIONS_LIMIT = 200;

/**
 * /admin/audit — read-only audit log surface with filters + CSV export.
 *
 * Hydrates the picker dropdowns server-side with the actions + actors that
 * actually appear in THIS org's log (rather than the full AuditAction union)
 * so the dropdowns stay short and the relevant choices surface first.
 */
export default async function AdminAuditPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect('/home');

  const distinctActions = await prisma.auditLog.findMany({
    where: { orgId: session.user.orgId },
    select: { action: true },
    distinct: ['action'],
    orderBy: { action: 'asc' },
    take: KNOWN_ACTIONS_LIMIT,
  });
  const knownActions = distinctActions.map((r) => r.action);

  const orgUsers = await prisma.orgUser.findMany({
    where: { orgId: session.user.orgId },
    include: { user: { select: { id: true, email: true } } },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
  });
  const knownUsers = orgUsers.map((ou) => ({ id: ou.user.id, email: ou.user.email }));

  return (
    <div className="space-y-4">
      <h1 className="text-2lg font-semibold">Audit log</h1>
      <AuditTable knownActions={knownActions} knownUsers={knownUsers} />
    </div>
  );
}
