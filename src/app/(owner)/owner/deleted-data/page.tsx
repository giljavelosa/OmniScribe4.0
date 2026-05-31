import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { writePlatformAuditLog } from '@/lib/audit/log';
import { DeletedDataClient } from './_components/deleted-data-client';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Owner — deleted data' };

export default async function OwnerDeletedDataPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const [deletedOrgs, deletedUsers] = await Promise.all([
    prisma.organization.findMany({
      where: { isDeleted: true },
      orderBy: { deletedAt: 'desc' },
      select: {
        id: true,
        name: true,
        deletedAt: true,
        deletedByUserId: true,
        _count: { select: { orgUsers: true, patients: true, seats: true } },
      },
    }),
    prisma.user.findMany({
      where: { isDeleted: true },
      orderBy: { deletedAt: 'desc' },
      select: {
        id: true,
        email: true,
        deletedAt: true,
        deletedByUserId: true,
        _count: { select: { orgUsers: true } },
      },
    }),
  ]);

  // Original identity for deleted users lives only in the owner-only recovery
  // ledger — the live User row is anonymized.
  const userLedgers = deletedUsers.length
    ? await prisma.deletedRecordLedger.findMany({
        where: {
          recordType: 'USER',
          recordId: { in: deletedUsers.map((u) => u.id) },
          restoredAt: null,
        },
        select: {
          recordId: true,
          originalEmail: true,
          originalName: true,
          deactivatedOrgUserIds: true,
        },
      })
    : [];
  const ledgerByUser = new Map(userLedgers.map((l) => [l.recordId, l]));

  // Resolve who performed each delete (best-effort; falls back to the raw id).
  const actorIds = Array.from(
    new Set(
      [...deletedOrgs, ...deletedUsers]
        .map((r) => r.deletedByUserId)
        .filter((v): v is string => Boolean(v)),
    ),
  );
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, email: true, name: true },
      })
    : [];
  const actorById = new Map(actors.map((a) => [a.id, a]));
  const deletedByLabel = (uid: string | null) => {
    if (!uid) return null;
    const a = actorById.get(uid);
    return a ? (a.name ?? a.email) : uid;
  };

  // Viewing this screen surfaces recovery-ledger PII — record the access.
  await writePlatformAuditLog({
    actingUserId: session.user.id,
    action: 'PLATFORM_DELETED_DATA_VIEWED',
    metadata: { orgCount: deletedOrgs.length, userCount: deletedUsers.length },
  });

  const orgRows = deletedOrgs.map((o) => ({
    id: o.id,
    name: o.name,
    deletedAt: o.deletedAt ? o.deletedAt.toISOString() : null,
    deletedBy: deletedByLabel(o.deletedByUserId),
    members: o._count.orgUsers,
    patients: o._count.patients,
    seats: o._count.seats,
  }));

  const userRows = deletedUsers.map((u) => {
    const ledger = ledgerByUser.get(u.id);
    return {
      id: u.id,
      anonymizedEmail: u.email,
      originalEmail: ledger?.originalEmail ?? null,
      originalName: ledger?.originalName ?? null,
      deletedAt: u.deletedAt ? u.deletedAt.toISOString() : null,
      deletedBy: deletedByLabel(u.deletedByUserId),
      membershipCount: u._count.orgUsers,
      recoverable: Boolean(ledger?.originalEmail),
    };
  });

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      <div className="shrink-0">
        <h1 className="text-2lg font-semibold">Deleted data</h1>
        <p className="text-sm text-muted-foreground">
          Owner-only archive of soft-deleted organizations and users. Clinical
          records and audit history stay retained; restoring returns a record to
          normal owner and app surfaces. Every view is audited.
        </p>
      </div>
      <DeletedDataClient orgs={orgRows} users={userRows} />
    </div>
  );
}
