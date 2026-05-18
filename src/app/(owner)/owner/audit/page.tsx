import type { Metadata } from 'next';

import { prisma } from '@/lib/prisma';
import { PlatformAuditTable } from './_components/platform-audit-table';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Owner — audit' };

const KNOWN_ACTIONS_LIMIT = 400;

export default async function OwnerAuditPage() {
  // Hydrate the dropdowns from DISTINCT values across all orgs (vs the full
  // AuditAction union) so the picker shows what's actually been written.
  const [distinctActions, orgs] = await Promise.all([
    prisma.auditLog.findMany({
      select: { action: true },
      distinct: ['action'],
      orderBy: { action: 'asc' },
      take: KNOWN_ACTIONS_LIMIT,
    }),
    prisma.organization.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  const knownActions = distinctActions.map((r) => r.action);

  return (
    <div className="space-y-4">
      <h1 className="text-2lg font-semibold">Audit</h1>
      <PlatformAuditTable knownActions={knownActions} knownOrgs={orgs} />
    </div>
  );
}
