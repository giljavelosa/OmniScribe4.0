import type { Metadata } from 'next';

import { prisma } from '@/lib/prisma';
import { PlatformAuditTable } from '@/app/(owner)/owner/audit/_components/platform-audit-table';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Ops — audit' };

const KNOWN_ACTIONS_LIMIT = 400;

/**
 * /ops/audit — Unit 33.
 *
 * Reuses the existing PlatformAuditTable with overridden search +
 * export paths so PLATFORM_OPS can use the same UI shape as the owner
 * console without granting OWNER. Filter dropdowns hydrate from the
 * full set of distinct actions + orgs (same query as /owner/audit).
 *
 * Read audit fires server-side via /api/ops/audit-search →
 * OPS_AUDIT_SEARCHED; export fires via /api/ops/audit-search/export →
 * OPS_AUDIT_EXPORTED. Distinct action names from the owner's
 * PLATFORM_AUDIT_VIEWED / EXPORTED so the auditor can split owner vs
 * ops activity at the row level.
 */
export default async function OpsAuditPage() {
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
      <h1 className="text-2lg font-semibold">Ops Audit</h1>
      <p className="text-sm text-muted-foreground">
        Cross-org audit search for ops triage. CSV export capped at 5,000 rows.
        Reads + exports audit as <code>OPS_AUDIT_SEARCHED</code> /{' '}
        <code>OPS_AUDIT_EXPORTED</code> — distinct from owner reads so the
        meta-audit shows who looked.
      </p>
      <PlatformAuditTable
        knownActions={knownActions}
        knownOrgs={orgs}
        searchPath="/api/ops/audit-search"
        exportPath="/api/ops/audit-search/export"
        title="Cross-org audit (ops view)"
        description="Same filter shape as /owner/audit. PHI-free by the writeAuditLog denylist; reads themselves audit to PlatformAuditLog as OPS_AUDIT_SEARCHED."
      />
    </div>
  );
}
