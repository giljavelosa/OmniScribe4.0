import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { BaaForm } from './_components/baa-form';
import { OwnerSeatsCard } from './_components/owner-seats-card';
import { SubscriptionForm } from './_components/subscription-form';
import { UsageChart } from './_components/usage-chart';
import { TransactionsTimeline } from './_components/transactions-timeline';
import { ImpersonateControl } from './_components/impersonate-control';
import { AuditRetentionForm } from './_components/audit-retention-form';
import { LlmCostCard } from './_components/llm-cost-card';
import { CommercialContractCard } from './_components/commercial-contract-card';

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

  // Unit 32 — active OrgUsers feed the ImpersonateControl target picker.
  // Limited to active users; ordered by email for stable display.
  const targets = await prisma.orgUser.findMany({
    where: { orgId: id, isActive: true },
    include: { user: { select: { email: true } } },
    orderBy: { user: { email: 'asc' } },
    take: 50,
  });
  const targetOptions = targets.map((t) => ({
    userId: t.userId,
    email: t.user.email,
    role: t.role,
  }));

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2lg font-semibold">{org.name}</h1>
        <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
          <StatusBadge variant="neutral">{org.division}</StatusBadge>
          <StatusBadge variant="neutral">{org.complianceProfile}</StatusBadge>
          {org.baaExecutedAt ? (
            <StatusBadge variant="success">BAA {org.baaVersion ?? '—'}</StatusBadge>
          ) : (
            <StatusBadge variant="danger">BAA missing</StatusBadge>
          )}
          <StatusBadge variant="info">{org.subscriptionPlan}</StatusBadge>
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
          <CardHeader><CardTitle className="text-md">Subscription</CardTitle></CardHeader>
          <CardContent>
            <SubscriptionForm
              orgId={org.id}
              initial={{
                subscriptionPlan: org.subscriptionPlan,
                subscriptionOverrideNotes: org.subscriptionOverrideNotes,
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-md">Impersonation</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Browse the app as a target user. READ-ONLY in v1 — mutations
              return 403 during the session. Auto-expires after 60 minutes.
            </p>
            <ImpersonateControl
              orgId={org.id}
              orgName={org.name}
              targets={targetOptions}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-md">Audit retention</CardTitle></CardHeader>
          <CardContent>
            <AuditRetentionForm
              orgId={org.id}
              initial={{ auditRetentionDays: org.auditRetentionDays }}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-md">Commercial contract</CardTitle></CardHeader>
        <CardContent>
          <CommercialContractCard orgId={org.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-md">30-day usage</CardTitle></CardHeader>
        <CardContent>
          <UsageChart orgId={org.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-md">LLM cost</CardTitle></CardHeader>
        <CardContent>
          <LlmCostCard
            orgId={org.id}
            initial={{
              monthlyBudgetUsd: org.monthlyLlmBudgetUsd
                ? Number(org.monthlyLlmBudgetUsd)
                : null,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          <TransactionsTimeline orgId={org.id} />
        </CardContent>
      </Card>

      <OwnerSeatsCard orgId={org.id} />
    </div>
  );
}
