import type { Metadata } from 'next';
import Link from 'next/link';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getClinicianSiteIds } from '@/lib/authz/site-scope';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PatientsSearchForm } from './_components/patients-search-form';
import { AddPatientButton } from './_components/add-patient-button';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Patients' };

const PAGE_SIZE = 20;

const ADMIN_ROLES = ['SUPER_ADMIN', 'ORG_ADMIN'] as const;

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

  // "My sites only" filter chip. Defaults ON for clinicians, OFF for admins.
  // ?scope=all explicitly disables; ?scope=mine explicitly enables.
  const role = session.user.role;
  const isAdmin = role && (ADMIN_ROLES as readonly string[]).includes(role);
  const mineDefault = !isAdmin;
  const mineActive =
    scope === 'mine' ? true : scope === 'all' ? false : mineDefault;

  const siteScope = await getClinicianSiteIds(
    session.user.orgUserId,
    session.user.orgId,
  );
  // Only narrow by siteId when the caller actually has enrolled sites; an admin
  // with scope 'all' may still tick "My sites only" but their enrollment list
  // is the org's whole site list, which gives the same result either way.
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
      },
    }),
    // Sites the caller can assign a new patient to. Org-wide roles get every
    // non-archived site; site-scoped roles get just their enrollments. The
    // AddPatient sheet uses this to render a required Site picker so we
    // never create a patient with a null siteId (which breaks ad-hoc
    // Start Visit downstream — patient has no default site / siteId required).
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

  // Default the AddPatient site picker to the caller's primary enrolled
  // site if they have one; otherwise the first site in their pickable
  // list. Computed server-side so the sheet renders instantly.
  const defaultSiteId =
    siteScope.scope === 'enrolled' && siteScope.siteIds.length > 0
      ? siteScope.siteIds[0]!
      : addPatientSites[0]?.id ?? null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2lg font-semibold">Patients</h1>
        <AddPatientButton sites={addPatientSites} defaultSiteId={defaultSiteId} />
      </div>
      <PatientsSearchForm initialQuery={rawQuery} />

      {siteScope.scope === 'enrolled' && siteScope.siteIds.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <Link
            href={pageHref({
              query: rawQuery,
              page: 1,
              scope: mineActive ? undefined : 'mine',
            })}
            aria-pressed={mineActive}
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors min-h-[var(--touch-min)] ${
              mineActive
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:bg-muted/40'
            }`}
          >
            {mineActive ? '✓ My sites only' : 'My sites only'}
          </Link>
          {mineActive && (
            <Link
              href={pageHref({
                query: rawQuery,
                page: 1,
                scope: 'all',
              })}
              className="text-xs text-muted-foreground underline"
            >
              Show all
            </Link>
          )}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-md">{total} result{total === 1 ? '' : 's'}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">MRN</th>
                <th className="text-left px-4 py-2 font-medium">DOB</th>
                <th className="text-left px-4 py-2 font-medium">Sex</th>
                <th className="text-left px-4 py-2 font-medium">Last visit</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/patients/${p.id}`} className="hover:underline">
                      {p.lastName}, {p.firstName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono">{p.mrn}</td>
                  <td className="px-4 py-3">{p.dob.toLocaleDateString()}</td>
                  <td className="px-4 py-3">{p.sex}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {p.encounters[0]?.startedAt
                      ? p.encounters[0].startedAt.toLocaleDateString()
                      : '—'}
                  </td>
                </tr>
              ))}
              {patients.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No matches.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {total > PAGE_SIZE && (
        <nav className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {pageNum} of {Math.ceil(total / PAGE_SIZE)}
          </span>
          <div className="flex gap-2">
            {pageNum > 1 && (
              <Link
                href={pageHref({
                  query: rawQuery,
                  page: pageNum - 1,
                  scope: mineActive ? 'mine' : undefined,
                })}
                className="underline"
              >
                ← Prev
              </Link>
            )}
            {pageNum * PAGE_SIZE < total && (
              <Link
                href={pageHref({
                  query: rawQuery,
                  page: pageNum + 1,
                  scope: mineActive ? 'mine' : undefined,
                })}
                className="underline"
              >
                Next →
              </Link>
            )}
          </div>
        </nav>
      )}
    </div>
  );
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
