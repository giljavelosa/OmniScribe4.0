import type { Metadata } from 'next';
import Link from 'next/link';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getClinicianSiteIds } from '@/lib/authz/site-scope';
import { UserAvatar } from '@/components/ui/user-avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { PatientsSearchForm } from './_components/patients-search-form';
import { AddPatientButton } from './_components/add-patient-button';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Patients' };

const PAGE_SIZE = 20;

const ADMIN_ROLES = ['ORG_ADMIN'] as const;

type SearchParamsShape = Promise<{
  query?: string;
  page?: string;
  scope?: string;
}>;

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: SearchParamsShape;
}) {
  const { query, page, scope } = await searchParams;
  const session = await auth();
  if (!session?.user?.orgId || !session.user.orgUserId) return null;

  const rawQuery = (query ?? '').trim();
  const pageNum = Math.max(1, Number(page ?? '1') || 1);

  const role = session.user.role;
  const isAdmin = role && (ADMIN_ROLES as readonly string[]).includes(role);
  const mineDefault = !isAdmin;
  const mineActive =
    scope === 'mine' ? true : scope === 'all' ? false : mineDefault;

  const siteScope = await getClinicianSiteIds(
    session.user.orgUserId,
    session.user.orgId,
  );
  const siteFilter =
    mineActive && siteScope.scope === 'enrolled' && siteScope.siteIds.length > 0
      ? { siteId: { in: siteScope.siteIds } }
      : {};

  const where: Prisma.PatientWhereInput = {
    orgId: session.user.orgId,
    isDeleted: false,
    ...siteFilter,
    ...(rawQuery
      ? {
          OR: [
            { lastName: { contains: rawQuery, mode: 'insensitive' } },
            { firstName: { contains: rawQuery, mode: 'insensitive' } },
            { mrn: { contains: rawQuery, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, patients, addPatientSites] = await Promise.all([
    prisma.patient.count({ where }),
    prisma.patient.findMany({
      where,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      skip: (pageNum - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        encounters: { orderBy: { startedAt: 'desc' }, take: 1 },
        // Sprint 0.4: surface site name + active-episode status on cards
        site: { select: { name: true } },
        episodes: {
          where: { status: { in: ['ACTIVE', 'RECERT_DUE'] } },
          take: 1,
          select: { id: true },
        },
      },
    }),
    prisma.site.findMany({
      where: {
        orgId: session.user.orgId,
        isArchived: false,
        ...(siteScope.scope === 'enrolled' && siteScope.siteIds.length > 0
          ? { id: { in: siteScope.siteIds } }
          : {}),
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  const defaultSiteId =
    siteScope.scope === 'enrolled' && siteScope.siteIds.length > 0
      ? siteScope.siteIds[0]!
      : addPatientSites[0]?.id ?? null;

  return (
    <>
      {/* ── Sticky search anchor ─────────────────────────────────────────
          Stays pinned at the top as the patient list scrolls. The clinician
          can always search or add a patient without scrolling back up. */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b shadow-sm">
        <div className="mx-auto max-w-5xl px-4 pt-4 pb-3 space-y-3">
          {/* Title + add */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2lg font-semibold">Patients</h1>
              <p className="text-sm text-muted-foreground">Search and open records</p>
            </div>
            <AddPatientButton sites={addPatientSites} defaultSiteId={defaultSiteId} />
          </div>

          <PatientsSearchForm initialQuery={rawQuery} />

          {/* Filter pills */}
          <div className="flex items-center gap-2 flex-wrap">
            {siteScope.scope === 'enrolled' && siteScope.siteIds.length > 0 && (
              <>
                <Link
                  href={pageHref({ query: rawQuery, page: 1, scope: mineActive ? undefined : 'mine' })}
                  aria-pressed={mineActive}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors min-h-[var(--touch-min)] ${
                    mineActive
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border text-muted-foreground hover:bg-muted/40'
                  }`}
                >
                  My sites
                </Link>
                {mineActive && (
                  <Link
                    href={pageHref({ query: rawQuery, page: 1, scope: 'all' })}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs transition-colors min-h-[var(--touch-min)] text-muted-foreground hover:bg-muted/40"
                  >
                    All
                  </Link>
                )}
              </>
            )}
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground/50 cursor-not-allowed select-none" title="Coming soon">
              Recent
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground/50 cursor-not-allowed select-none" title="Coming soon">
              Active
            </span>
          </div>
        </div>
      </div>

      {/* ── Scrollable content ───────────────────────────────────────── */}
      <div className="mx-auto max-w-5xl px-4 py-4 space-y-4">
        {/* Result count */}
        <p className="text-xs text-muted-foreground">
          {total} patient{total === 1 ? '' : 's'}
        </p>

        {/* ── MOBILE: card list (hidden on lg+) ────────────────────────── */}
        <div className="lg:hidden space-y-3">
          {patients.length === 0 ? (
            <EmptyState query={rawQuery} />
          ) : (
            patients.map((p) => {
              const age = ageInYears(p.dob);
              const isActive = p.episodes.length > 0;
              const lastVisit = p.encounters[0]?.startedAt
                ? p.encounters[0].startedAt.toLocaleDateString()
                : '—';
              return (
                <div
                  key={p.id}
                  className="rounded-xl border border-border bg-card shadow-sm p-4 space-y-3"
                >
                  {/* Identity row */}
                  <div className="flex items-center gap-3">
                    <UserAvatar firstName={p.firstName} lastName={p.lastName} size="md" className="shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm leading-tight">
                        {p.lastName}, {p.firstName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {age}y {p.sex} · MRN {p.mrn}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Last visit: {lastVisit}
                      </p>
                    </div>
                  </div>

                  {/* Site + status row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {p.site && (
                      <span className="text-xs text-muted-foreground">{p.site.name}</span>
                    )}
                    {isActive ? (
                      <StatusBadge variant="success" noIcon className="text-[10px]">Active</StatusBadge>
                    ) : (
                      <span className="text-xs text-muted-foreground">No active care</span>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    <Button asChild variant="outline" size="sm" className="flex-1">
                      <Link href={`/patients/${p.id}`}>Open chart</Link>
                    </Button>
                    <Button asChild size="sm" className="flex-1">
                      <Link href={`/patients/${p.id}`}>Start note</Link>
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── DESKTOP: registry table (hidden below lg) ────────────────── */}
        <div className="hidden lg:block">
          {patients.length === 0 ? (
            <EmptyState query={rawQuery} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-md">Patient registry</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="text-left px-4 py-2 font-medium">Patient</th>
                      <th className="text-left px-4 py-2 font-medium">Age / Sex</th>
                      <th className="text-left px-4 py-2 font-medium">MRN</th>
                      <th className="text-left px-4 py-2 font-medium">Last visit</th>
                      <th className="text-left px-4 py-2 font-medium">Site</th>
                      <th className="text-left px-4 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patients.map((p) => {
                      const age = ageInYears(p.dob);
                      const isActive = p.episodes.length > 0;
                      const lastVisit = p.encounters[0]?.startedAt
                        ? p.encounters[0].startedAt.toLocaleDateString()
                        : '—';
                      return (
                        <tr key={p.id} className="border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <UserAvatar firstName={p.firstName} lastName={p.lastName} size="sm" />
                              <Link href={`/patients/${p.id}`} className="font-medium hover:underline">
                                {p.lastName}, {p.firstName}
                              </Link>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{age}y · {p.sex}</td>
                          <td className="px-4 py-3 font-mono text-muted-foreground">{p.mrn}</td>
                          <td className="px-4 py-3 text-muted-foreground">{lastVisit}</td>
                          <td className="px-4 py-3 text-muted-foreground">{p.site?.name ?? '—'}</td>
                          <td className="px-4 py-3">
                            {isActive ? (
                              <StatusBadge variant="success" noIcon className="text-[10px]">Active</StatusBadge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <nav className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Page {pageNum} of {Math.ceil(total / PAGE_SIZE)}
            </span>
            <div className="flex gap-2">
              {pageNum > 1 && (
                <Link
                  href={pageHref({ query: rawQuery, page: pageNum - 1, scope: mineActive ? 'mine' : undefined })}
                  className="underline"
                >
                  ← Prev
                </Link>
              )}
              {pageNum * PAGE_SIZE < total && (
                <Link
                  href={pageHref({ query: rawQuery, page: pageNum + 1, scope: mineActive ? 'mine' : undefined })}
                  className="underline"
                >
                  Next →
                </Link>
              )}
            </div>
          </nav>
        )}
      </div>
    </>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm px-6 py-10 text-center space-y-2">
      <p className="text-sm font-medium text-muted-foreground">
        {query ? `No patients matching "${query}"` : 'No patients found'}
      </p>
      {query && (
        <p className="text-xs text-muted-foreground">
          Try a different name or MRN, or{' '}
          <Link href="/patients" className="underline hover:text-foreground">clear the search</Link>.
        </p>
      )}
    </div>
  );
}

function ageInYears(dob: Date): number {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

function pageHref(args: {
  query: string;
  page: number;
  scope?: 'mine' | 'all' | undefined;
}) {
  const u = new URLSearchParams();
  if (args.query) u.set('query', args.query);
  u.set('page', String(args.page));
  if (args.scope) u.set('scope', args.scope);
  return `/patients?${u.toString()}`;
}
