import { OrgRole } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { StatusBadge, type StatusBadgeProps } from '@/components/ui/status-badge';
import {
  ScrollableTablePanel,
  SCROLLABLE_TABLE_HEAD_ROW,
} from '@/components/ui/scrollable-table-panel';

/**
 * People card — owner-side roster of an org, grouped by role.
 *
 * Why this exists separately from the Seats card: a Seat is a billing
 * unit (`SOLO | TEAM | ENTERPRISE`). A role is an authority assignment
 * (`ORG_ADMIN | SITE_ADMIN | CLINICIAN | VIEWER`). Owners triaging an
 * org need the latter — "who do I escalate to?" — which the seats list
 * cannot answer (and admins/viewers may not even hold a billable seat).
 */

const ROLE_ORDER: OrgRole[] = ['ORG_ADMIN', 'SITE_ADMIN', 'CLINICIAN', 'VIEWER'];

const ROLE_LABEL: Record<OrgRole, string> = {
  ORG_ADMIN: 'Org admin',
  SITE_ADMIN: 'Site admin',
  CLINICIAN: 'Clinician',
  VIEWER: 'Viewer',
};

const ROLE_VARIANT: Record<OrgRole, StatusBadgeProps['variant']> = {
  ORG_ADMIN: 'violet',
  SITE_ADMIN: 'info',
  CLINICIAN: 'neutral',
  VIEWER: 'neutral',
};

export async function PeopleCard({ orgId }: { orgId: string }) {
  const people = await prisma.orgUser.findMany({
    where: { orgId },
    include: {
      user: { select: { email: true } },
      seat: { select: { tier: true, expiresAt: true } },
      siteEnrollments: {
        include: { site: { select: { id: true, name: true } } },
      },
    },
  });

  const sorted = [...people].sort((a, b) => {
    const roleDiff = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
    if (roleDiff !== 0) return roleDiff;
    return a.user.email.localeCompare(b.user.email);
  });

  const counts = ROLE_ORDER.map((role) => ({
    role,
    count: sorted.filter((p) => p.role === role).length,
  })).filter((r) => r.count > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-md">People</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <span>
            {sorted.length} member{sorted.length === 1 ? '' : 's'}
          </span>
          {counts.map(({ role, count }) => (
            <StatusBadge key={role} variant={ROLE_VARIANT[role]} noIcon>
              {count} {ROLE_LABEL[role].toLowerCase()}
              {count === 1 ? '' : 's'}
            </StatusBadge>
          ))}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {sorted.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">
            No team members yet.
          </p>
        ) : (
          <ScrollableTablePanel className="max-h-[28rem] border-0 rounded-none">
            <table className="w-full text-sm">
              <thead>
                <tr className={SCROLLABLE_TABLE_HEAD_ROW}>
                  <th className="text-left px-4 py-2 font-medium">Role</th>
                  <th className="text-left px-4 py-2 font-medium">Email</th>
                  <th className="text-left px-4 py-2 font-medium">Division</th>
                  <th className="text-left px-4 py-2 font-medium">Sites</th>
                  <th className="text-left px-4 py-2 font-medium">Seat</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => {
                  const isOrgWideRole = p.role === 'ORG_ADMIN';
                  const enrolled = p.siteEnrollments;
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-border last:border-b-0"
                    >
                      <td className="px-4 py-3">
                        <StatusBadge variant={ROLE_VARIANT[p.role]} noIcon>
                          {ROLE_LABEL[p.role]}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {p.user.email}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {p.division}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {isOrgWideRole ? (
                          <span>All sites</span>
                        ) : enrolled.length === 0 ? (
                          <span className="italic">None</span>
                        ) : (
                          <span>
                            {enrolled
                              .slice(0, 2)
                              .map((e) => e.site.name)
                              .join(', ')}
                            {enrolled.length > 2
                              ? ` +${enrolled.length - 2}`
                              : ''}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {p.seat ? p.seat.tier : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          variant={p.isActive ? 'success' : 'neutral'}
                          noIcon
                        >
                          {p.isActive ? 'Active' : 'Deactivated'}
                        </StatusBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollableTablePanel>
        )}
      </CardContent>
    </Card>
  );
}
