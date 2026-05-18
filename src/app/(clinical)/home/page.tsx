import type { Metadata } from 'next';
import Link from 'next/link';
import type { OrgRole } from '@prisma/client';
import {
  FileEdit,
  FileText,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  UserPlus,
  Wrench,
} from 'lucide-react';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { SchedulingCard } from '@/components/clinical/scheduling-card';
import { HomeSearchForm } from './_components/home-search-form';

const ADMIN_ROLES: OrgRole[] = ['SUPER_ADMIN', 'ORG_ADMIN', 'SITE_ADMIN'];

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Home' };

/**
 * /home — clinician dashboard.
 *
 * Polish (post-Wave 6) — replaced the Unit 01 placeholder "Drafts queue
 * arrives in Unit 05" copy with real data. Now surfaces:
 *   - today's schedule (already existed; unchanged)
 *   - patient search (already existed; unchanged)
 *   - drafts: notes assigned to this clinician in DRAFT / REVIEWING /
 *     PENDING_REVIEW state, capped at 10 (clinician can drill into
 *     /drafts for the full list when that surface lands)
 *   - open follow-ups: assigned to this clinician, status=OPEN, capped
 *     at 10
 *
 * The drafts list links to /review/[noteId] (Unit 05 finalization
 * surface). Follow-ups link to the patient page where the follow-up
 * surface lives.
 */
export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.orgId || !session.user.orgUserId) return null;
  const orgId = session.user.orgId;
  const clinicianOrgUserId = session.user.orgUserId;

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const [schedules, drafts, followups] = await Promise.all([
    prisma.schedule.findMany({
      where: {
        orgId,
        clinicianOrgUserId,
        scheduledStart: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { scheduledStart: 'asc' },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
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
      take: 10,
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
      take: 10,
      select: {
        id: true,
        text: true,
        createdAt: true,
        patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
      },
    }),
  ]);

  const role = session.user.role;
  const platformRole = session.user.platformRole;
  const isAdmin = role && ADMIN_ROLES.includes(role);
  const isOwner = platformRole === 'PLATFORM_OWNER';
  const isOps = platformRole === 'PLATFORM_OPS' || isOwner;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2lg font-semibold">Today</h1>
        <p className="text-sm text-muted-foreground">
          {dayStart.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} ·{' '}
          {session.user.email}
        </p>
      </div>

      {/* Quick Actions — direct links to the most-used surfaces.
          Role-gated: admin/owner/ops only render their group when the
          user has the matching role. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-md">Quick actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            <QuickActionLink
              href="/patients"
              Icon={Stethoscope}
              label="All patients"
              hint="Search, filter, manage"
            />
            <QuickActionLink
              // Lands on the patient list — the "New patient" button is
              // visible at the top of that page. Hint reflects the actual
              // destination so the label + hint stop contradicting each other.
              href="/patients"
              Icon={UserPlus}
              label="Add patient"
              hint="Open list + tap New"
            />
            {isAdmin && (
              <>
                <QuickActionLink
                  href="/admin/templates"
                  Icon={FileText}
                  label="Templates"
                  hint="Note templates"
                />
                <QuickActionLink
                  href="/admin/users"
                  Icon={ShieldCheck}
                  label="Team members"
                  hint="Invite, manage, audit"
                />
                <QuickActionLink
                  href="/admin/audit"
                  Icon={FileEdit}
                  label="Audit log"
                  hint="Per-org events"
                />
              </>
            )}
            {isOwner && (
              <QuickActionLink
                href="/owner/orgs"
                Icon={Sparkles}
                label="Owner console"
                hint="Orgs, BAA, billing"
              />
            )}
            {isOps && (
              <QuickActionLink
                href="/ops"
                Icon={Wrench}
                label="Ops dashboard"
                hint="Platform health"
              />
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No visits scheduled for today.</p>
          ) : (
            schedules.map((s) => (
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
                }}
              />
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Find a patient</CardTitle>
        </CardHeader>
        <CardContent>
          <HomeSearchForm />
        </CardContent>
      </Card>

      <Card>
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
        <CardContent className="space-y-2">
          {drafts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No drafts waiting — finalize a recording on{' '}
              <Link href="/patients" className="underline hover:text-foreground">
                a patient
              </Link>{' '}
              to start one.
            </p>
          ) : (
            drafts.map((d) => (
              <Link
                key={d.id}
                href={`/review/${d.id}`}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 hover:bg-muted/40"
              >
                <div className="flex items-center gap-2 text-sm">
                  <Sparkles className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
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
            ))
          )}
        </CardContent>
      </Card>

      <Card>
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
        <CardContent className="space-y-2">
          {followups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No open follow-ups assigned to you.
            </p>
          ) : (
            followups.map((f) => (
              <Link
                key={f.id}
                href={`/patients/${f.patient.id}`}
                className="flex flex-col gap-1 rounded-md border border-border px-3 py-2 hover:bg-muted/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {f.patient.lastName}, {f.patient.firstName}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {f.patient.mrn}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{f.text}</p>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function QuickActionLink({
  href,
  Icon,
  label,
  hint,
}: {
  href: string;
  Icon: typeof Stethoscope;
  label: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-md border border-border bg-card p-3 hover:bg-muted/40 hover:border-foreground/30 transition-colors min-h-[var(--touch-min)]"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="h-3.5 w-3.5 text-primary" aria-hidden />
        {label}
      </div>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </Link>
  );
}
