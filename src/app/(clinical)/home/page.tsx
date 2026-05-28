import type { Metadata } from 'next';
import Link from 'next/link';
import type { OrgRole } from '@prisma/client';
import {
  FileEdit,
  FileText,
  Mic,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Wrench,
} from 'lucide-react';

import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getClinicianSiteIds } from '@/lib/authz/site-scope';
import { divisionForProfession } from '@/lib/professions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { UserAvatar } from '@/components/ui/user-avatar';
import { SchedulingCard } from '@/components/clinical/scheduling-card';
import { TodayStatusTiles } from '@/components/home/today-status-tiles';
import { AiCommandPanel } from '@/components/home/ai-command-panel';
import { DraftUsagePill } from '@/components/billing/draft-usage-pill';
import { VisitCapacityPill } from '@/components/billing/visit-capacity-pill';
import { TrialStatusBanner } from '@/components/billing/trial-status-banner';
import { countOrgDraftsLast30Days } from '@/lib/billing/draft-counter';
import { loadClinicianCapacitySummary } from '@/lib/billing/commercial-mode';
import { HomeSearchForm } from './_components/home-search-form';

const ADMIN_ROLES: OrgRole[] = ['ORG_ADMIN', 'SITE_ADMIN'];

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Home' };

type HomeSearchParams = Promise<{ siteId?: string }>;

export default async function HomePage({
  searchParams,
}: {
  searchParams: HomeSearchParams;
}) {
  const session = await auth();
  if (!session?.user?.orgId || !session.user.orgUserId) redirect('/login');
  const orgId = session.user.orgId;
  const clinicianOrgUserId = session.user.orgUserId;
  const { siteId: selectedSiteParam } = await searchParams;

  // Unit 49 §E — viewer-division filter for any case sub-selects below.
  // The clinician sees only same-division (or MULTI) cases on the home
  // dashboard's per-patient case roll-up.
  const viewerDivisionForHome = divisionForProfession(
    session.user.professionType ?? null,
  );

  const siteScope = await getClinicianSiteIds(clinicianOrgUserId, orgId);
  const mySites =
    siteScope.siteIds.length > 0
      ? await prisma.site.findMany({
          where: { id: { in: siteScope.siteIds }, isArchived: false },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        })
      : [];
  const showSitePillRow = mySites.length >= 2;
  const selectedSiteId =
    selectedSiteParam && mySites.some((s) => s.id === selectedSiteParam)
      ? selectedSiteParam
      : null;

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const [schedules, drafts, followups, org] = await Promise.all([
    prisma.schedule.findMany({
      where: {
        orgId,
        clinicianOrgUserId,
        scheduledStart: { gte: dayStart, lt: dayEnd },
        ...(selectedSiteId ? { siteId: selectedSiteId } : {}),
      },
      orderBy: { scheduledStart: 'asc' },
      include: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            mrn: true,
            caseManagements: {
              where: {
                status: 'ACTIVE',
                ...(viewerDivisionForHome
                  ? { division: { in: [viewerDivisionForHome, 'MULTI'] } }
                  : {}),
              },
              include: {
                episodes: {
                  where: { status: { in: ['ACTIVE', 'RECERT_DUE'] } },
                  select: {
                    id: true,
                    diagnosis: true,
                    bodyPart: true,
                    visitsCompleted: true,
                  },
                },
              },
            },
          },
        },
        encounter: {
          select: {
            id: true,
            notes: { orderBy: { createdAt: 'asc' }, take: 1, select: { id: true } },
          },
        },
      },
    }),
    prisma.note.findMany({
      where: {
        orgId,
        clinicianOrgUserId,
        status: { in: ['DRAFT', 'REVIEWING', 'PENDING_REVIEW'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        status: true,
        updatedAt: true,
        patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
      },
    }),
    prisma.followUp.findMany({
      where: {
        orgId,
        status: 'OPEN',
        originNote: { clinicianOrgUserId },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        text: true,
        createdAt: true,
        patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
      },
    }),
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true, billingPlan: true },
    }),
  ]);

  const orgName = org?.name ?? null;
  const billingPlan = org?.billingPlan ?? null;

  // Live draft counter for the home cockpit pill — last-30-days
  // distinct NOTE_GENERATION_COMPLETED count + the org's active seat
  // count (per-seat plans need it for bundle math). Two cheap queries
  // in parallel; the pill renders muted/warning/danger based on
  // proportion-of-bundle.
  const [draftsThisPeriod, activeSeatCount, capacitySummary] = await Promise.all([
    countOrgDraftsLast30Days(orgId),
    prisma.orgUser.count({ where: { orgId, isActive: true } }),
    loadClinicianCapacitySummary(orgId, clinicianOrgUserId),
  ]);
  const role = session.user.role;
  const platformRole = session.user.platformRole;
  const isAdmin = role && ADMIN_ROLES.includes(role);
  const isOwner = platformRole === 'PLATFORM_OWNER';
  const isOps = platformRole === 'PLATFORM_OPS' || isOwner;

  const dateLabel = dayStart.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  // Derive first name for greeting: prefer session.user.name, fall back
  // to the part of the email before '@'.
  const displayFirst =
    session.user.name?.split(' ')[0] ||
    (session.user.email.split('@')[0] ?? 'there');

  const hour = new Date().getUTCHours();
  const timeGreeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // Shared schedule card factory (used in both mobile + desktop branches)
  const scheduleCards = schedules.map((s) => (
    <SchedulingCard
      key={s.id}
      visit={{
        scheduleId: s.id,
        patientId: s.patient.id,
        patientName: `${s.patient.lastName}, ${s.patient.firstName}`,
        mrn: s.patient.mrn,
        scheduledStart: s.scheduledStart.toISOString(),
        scheduledEnd: s.scheduledEnd.toISOString(),
        visitType: s.visitType,
        status: s.status,
        hasEncounter: !!s.encounter,
        encounterNoteId: s.encounter?.notes[0]?.id ?? null,
        scheduleEpisodeOfCareId: s.episodeOfCareId,
        viewerDivision: divisionForProfession(session.user.professionType ?? null),
        activeCases: s.patient.caseManagements.map((c) => ({
          id: c.id,
          primaryIcd: c.primaryIcd,
          primaryIcdLabel: c.primaryIcdLabel,
          secondaryIcd: c.secondaryIcd,
          lastActivityAt: null,
          // The home/schedule path doesn't precompute viewer-recency signals.
          // The StartVisitDialog falls back to overall + 1-case auto-post here
          // (sort is stable when all three signals are null).
          viewerLastActivityAt: null,
          viewerDivisionLastActivityAt: null,
          episodes: c.episodes.map((ep) => ({
            id: ep.id,
            diagnosis: ep.diagnosis,
            bodyPart: ep.bodyPart,
            division: 'REHAB' as const,
            lastVisitAt: null,
            visitCount: ep.visitsCompleted,
          })),
        })),
      }}
    />
  ));

  // Shared draft rows (used in both branches)
  const draftRows = drafts.map((d) => (
    <Link
      key={d.id}
      href={`/review/${d.id}`}
      className="flex items-center justify-between rounded-md border border-border px-3 py-2 hover:bg-muted/40 min-h-[var(--touch-min)]"
    >
      <div className="flex items-center gap-2 text-sm">
        <UserAvatar
          firstName={d.patient.firstName}
          lastName={d.patient.lastName}
          size="sm"
        />
        <span className="font-medium">
          {d.patient.lastName}, {d.patient.firstName}
        </span>
        <span className="text-muted-foreground text-xs">{d.patient.mrn}</span>
      </div>
      <div className="flex items-center gap-2">
        <StatusBadge variant="neutral" noIcon className="text-[10px]">
          {d.status}
        </StatusBadge>
        <span className="text-[11px] text-muted-foreground">
          {d.updatedAt.toLocaleDateString()}
        </span>
      </div>
    </Link>
  ));

  // Shared follow-up rows
  const followupRows = followups.map((f) => (
    <Link
      key={f.id}
      href={`/patients/${f.patient.id}`}
      className="flex items-start gap-3 rounded-md border border-border px-3 py-2 hover:bg-muted/40 min-h-[var(--touch-min)]"
    >
      <UserAvatar
        firstName={f.patient.firstName}
        lastName={f.patient.lastName}
        size="sm"
        className="mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">
            {f.patient.lastName}, {f.patient.firstName}
          </span>
          <span className="text-[11px] text-muted-foreground shrink-0">{f.patient.mrn}</span>
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2">{f.text}</p>
      </div>
    </Link>
  ));

  // Shared site pill row
  const sitePillRow = showSitePillRow ? (
    <div className="flex flex-wrap items-center gap-2 overflow-x-auto" role="tablist" aria-label="Filter by site">
      <Link
        href="/home"
        role="tab"
        aria-selected={selectedSiteId === null}
        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors min-h-[var(--touch-min)] whitespace-nowrap ${
          selectedSiteId === null
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border text-muted-foreground hover:bg-muted/40'
        }`}
      >
        All my sites
      </Link>
      {mySites.map((site) => (
        <Link
          key={site.id}
          href={`/home?siteId=${encodeURIComponent(site.id)}`}
          role="tab"
          aria-selected={selectedSiteId === site.id}
          className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors min-h-[var(--touch-min)] whitespace-nowrap ${
            selectedSiteId === site.id
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:bg-muted/40'
          }`}
        >
          {site.name}
        </Link>
      ))}
    </div>
  ) : null;

  return (
    <>
      {/* ── MOBILE COCKPIT ──────────────────────────────────────────── */}
      {/* Shown at < lg. Patient search and primary CTAs are above the
          fold so clinicians can act immediately without scrolling. */}
      <div className="lg:hidden flex flex-col min-h-[calc(100dvh-52px)]">

        {/* 0. Greeting strip — flows visually from the teal header above */}
        <div className="bg-gradient-to-b from-primary/90 to-primary/75 px-4 py-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-primary-foreground font-semibold text-base leading-tight">
              {timeGreeting}, {displayFirst}
            </p>
            {orgName && (
              <p className="text-primary-foreground/80 text-xs mt-0.5">{orgName}</p>
            )}
          </div>
          <p className="text-primary-foreground/70 text-xs shrink-0 text-right">{dateLabel}</p>
        </div>

        {/* 0.25 Trial / capacity warning */}
        {capacitySummary?.trialExpiry && (
          <div className="px-4 pt-2 bg-card">
            <TrialStatusBanner
              trialEndsAt={capacitySummary.trialEndsAt}
              isOrgAdmin={!!isAdmin}
              expired={capacitySummary.trialExpiry.expired}
              daysLeft={capacitySummary.trialExpiry.daysLeft}
              urgent={capacitySummary.trialExpiry.urgent}
            />
          </div>
        )}

        {/* 0.5. Live draft-usage pill — clinician sees their plan
            consumption above the fold like a battery icon. Click →
            /account/usage for the breakdown. */}
        {(capacitySummary || billingPlan) && (
          <div className="px-4 pt-3 pb-1 bg-card flex justify-end">
            {capacitySummary ? (
              <VisitCapacityPill
                availableVisits={capacitySummary.availableVisits}
                compact
              />
            ) : (
              billingPlan && (
                <DraftUsagePill
                  draftsUsed={draftsThisPeriod}
                  billingPlan={billingPlan}
                  seatCount={activeSeatCount}
                  compact
                />
              )
            )}
          </div>
        )}

        {/* 1. Patient search — ABOVE FOLD */}
        <section className="px-4 pt-4 pb-3 border-b border-border bg-card">
          <HomeSearchForm />
        </section>

        {/* 2. Primary action CTAs — ABOVE FOLD */}
        <section className="px-4 py-3 flex gap-2 border-b border-border bg-card">
          <Button asChild className="flex-1 gap-2" size="sm">
            <Link href="/patients">
              <Mic className="h-4 w-4" aria-hidden />
              Start Encounter
            </Link>
          </Button>
          {drafts.length > 0 && drafts[0] && (
            <Button asChild variant="outline" className="flex-1 gap-2" size="sm">
              <Link href={`/review/${drafts[0].id}`}>
                <FileEdit className="h-4 w-4" aria-hidden />
                Resume Draft
              </Link>
            </Button>
          )}
          {drafts.length === 0 && (
            <Button asChild variant="outline" className="flex-1 gap-2" size="sm">
              <Link href="/patients">
                <Stethoscope className="h-4 w-4" aria-hidden />
                All Patients
              </Link>
            </Button>
          )}
        </section>

        {/* 3. Status tiles — ABOVE FOLD */}
        <section className="px-4 py-3 border-b border-border">
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <TodayStatusTiles
              visits={schedules.length}
              drafts={drafts.length}
              followups={followups.length}
            />
          </div>
        </section>

        {/* 4. Site filter pills (only when multi-site) */}
        {showSitePillRow && (
          <section className="px-4 py-2 border-b border-border overflow-x-auto">
            {sitePillRow}
          </section>
        )}

        {/* 5. Today's queue */}
        <section id="schedule" className="px-4 py-4 space-y-3">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            Today&apos;s queue
          </h2>
          {schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No visits scheduled for today.</p>
          ) : (
            <div className="space-y-3">{scheduleCards}</div>
          )}
        </section>

        {/* 6. Drafts */}
        {drafts.length > 0 && (
          <section id="drafts" className="px-4 pb-4 space-y-2">
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-2">
              Drafts
              <StatusBadge variant="info" noIcon className="text-[10px]">{drafts.length}</StatusBadge>
            </h2>
            <div
              className="space-y-1 max-h-[280px] overflow-y-auto pr-1"
              role="list"
              aria-label={`Drafts, ${drafts.length} total`}
            >
              {draftRows}
            </div>
          </section>
        )}

        {/* 7. Open follow-ups */}
        {followups.length > 0 && (
          <section id="followups" className="px-4 pb-4 space-y-2">
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-2">
              Open follow-ups
              <StatusBadge variant="info" noIcon className="text-[10px]">{followups.length}</StatusBadge>
            </h2>
            <div
              className="space-y-1 max-h-[320px] overflow-y-auto pr-1"
              role="list"
              aria-label={`Open follow-ups, ${followups.length} total`}
            >
              {followupRows}
            </div>
          </section>
        )}

        {/* 8. AI command strip */}
        <div className="mt-auto">
          <AiCommandPanel variant="mobile" />
        </div>
      </div>

      {/* ── DESKTOP COMMAND CENTER ──────────────────────────────────── */}
      {/* Three-column grid: left sidebar | center workspace | right AI panel */}
      <div className="hidden lg:grid lg:grid-cols-[240px_1fr_320px] min-h-[calc(100dvh-52px)]">

        {/* LEFT SIDEBAR — navigation + primary CTA */}
        <aside className="border-r border-border flex flex-col gap-1 px-3 py-5 overflow-y-auto">
          <Button asChild className="w-full justify-start gap-2 mb-3">
            <Link href="/patients">
              <Mic className="h-4 w-4" aria-hidden />
              Start Encounter
            </Link>
          </Button>

          <SidebarLink href="/home" Icon={Sparkles} label="Home" active />
          <SidebarLink href="/patients" Icon={Stethoscope} label="Patients" />
          {/* Personal templates (Option A — clinician-authored). Admins
              see the richer "Templates" link under Console below and skip
              this one to avoid two side-by-side templates entries. */}
          {!isAdmin && (
            <SidebarLink href="/templates" Icon={FileText} label="My templates" />
          )}

          {(isAdmin || isOwner || isOps) && (
            <div className="mt-3 mb-1">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-2 pb-1">
                Console
              </p>
              {isAdmin && (
                <>
                  <SidebarLink href="/admin/users" Icon={ShieldCheck} label="Team members" />
                  <SidebarLink href="/admin/templates" Icon={FileText} label="Templates" />
                </>
              )}
              {isOwner && (
                <SidebarLink href="/owner/orgs" Icon={Sparkles} label="Owner console" />
              )}
              {isOps && (
                <SidebarLink href="/ops" Icon={Wrench} label="Ops dashboard" />
              )}
            </div>
          )}

          {/* Spacer pushes org/date block to the bottom */}
          <div className="flex-1" />
          <div className="px-2 py-2 text-xs text-muted-foreground space-y-0.5 border-t border-border mt-2 pt-3">
            {orgName && (
              <p className="font-semibold text-foreground text-[11px] truncate">{orgName}</p>
            )}
            <p className="font-medium text-[11px]">
              {dayStart.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
            </p>
            {mySites[0] && (
              <p className="truncate">{mySites[0].name}</p>
            )}
          </div>
        </aside>

        {/* CENTER WORKSPACE */}
        <main className="px-6 py-6 overflow-y-auto space-y-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex flex-col gap-0.5 min-w-0">
              <h1 className="text-2lg font-semibold">
                {timeGreeting}, {displayFirst}
              </h1>
              <p className="text-sm text-muted-foreground">
                {dateLabel}
                {orgName && <> · <span className="font-medium text-foreground">{orgName}</span></>}
              </p>
              <p className="text-xs text-muted-foreground">{session.user.email}</p>
            </div>
            {/* Live draft-usage pill — proportion of bundle, color-coded.
                Click → /account/usage. Hidden when billingPlan is null
                (legacy seed orgs where the column hasn't been backfilled). */}
            {(capacitySummary || billingPlan) && (
              capacitySummary ? (
                <VisitCapacityPill
                  availableVisits={capacitySummary.availableVisits}
                  className="shrink-0"
                />
              ) : (
                billingPlan && (
                  <DraftUsagePill
                    draftsUsed={draftsThisPeriod}
                    billingPlan={billingPlan}
                    seatCount={activeSeatCount}
                    className="shrink-0"
                  />
                )
              )
            )}
          </div>

          {capacitySummary?.trialExpiry && (
            <TrialStatusBanner
              trialEndsAt={capacitySummary.trialEndsAt}
              isOrgAdmin={!!isAdmin}
              expired={capacitySummary.trialExpiry.expired}
              daysLeft={capacitySummary.trialExpiry.daysLeft}
              urgent={capacitySummary.trialExpiry.urgent}
            />
          )}

          {/* Patient search */}
          <HomeSearchForm />

          {/* Status tiles */}
          <TodayStatusTiles
            visits={schedules.length}
            drafts={drafts.length}
            followups={followups.length}
          />

          {/* Site filter pills */}
          {showSitePillRow && sitePillRow}

          {/* Schedule */}
          <Card id="schedule">
            <CardHeader>
              <CardTitle className="text-md">Schedule</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {schedules.length === 0 ? (
                <p className="text-sm text-muted-foreground">No visits scheduled for today.</p>
              ) : (
                scheduleCards
              )}
            </CardContent>
          </Card>

          {/* Drafts */}
          <Card id="drafts">
            <CardHeader>
              <CardTitle className="text-md flex items-center gap-2">
                <FileEdit className="h-4 w-4 text-muted-foreground" aria-hidden />
                Drafts
                {drafts.length > 0 && (
                  <StatusBadge variant="info" noIcon className="text-[10px]">
                    {drafts.length}
                  </StatusBadge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {drafts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No drafts waiting — finalize a recording on{' '}
                  <Link href="/patients" className="underline hover:text-foreground">
                    a patient
                  </Link>{' '}
                  to start one.
                </p>
              ) : (
                <div
                  className="max-h-[320px] overflow-y-auto pr-1 space-y-2"
                  role="list"
                  aria-label={`Drafts, ${drafts.length} total`}
                >
                  {draftRows}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Open follow-ups */}
          <Card id="followups">
            <CardHeader>
              <CardTitle className="text-md flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-muted-foreground" aria-hidden />
                Open follow-ups
                {followups.length > 0 && (
                  <StatusBadge variant="info" noIcon className="text-[10px]">
                    {followups.length}
                  </StatusBadge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {followups.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No open follow-ups assigned to you.
                </p>
              ) : (
                <div
                  className="max-h-[360px] overflow-y-auto pr-1 space-y-2"
                  role="list"
                  aria-label={`Open follow-ups, ${followups.length} total`}
                >
                  {followupRows}
                </div>
              )}
            </CardContent>
          </Card>
        </main>

        {/* RIGHT AI PANEL */}
        <aside className="border-l border-border px-4 py-6 overflow-y-auto">
          <AiCommandPanel variant="desktop" />
        </aside>
      </div>
    </>
  );
}

function SidebarLink({
  href,
  Icon,
  label,
  active = false,
}: {
  href: string;
  Icon: typeof Stethoscope;
  label: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors min-h-[var(--touch-min)] ${
        active
          ? 'bg-muted text-foreground font-medium'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {label}
    </Link>
  );
}
