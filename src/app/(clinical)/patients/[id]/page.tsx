import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { PatientIdentityHeader } from '@/components/patients/patient-identity-header';
import { StartVisitButton } from './_components/start-visit-button';
import { EpisodesPanel } from './_components/episodes-panel';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Patient' };

export default async function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.orgId) return null;

  const patient = await prisma.patient.findFirst({
    where: { id, orgId: session.user.orgId, isDeleted: false },
    include: {
      addresses: true,
      coverages: true,
      // Unit 11: include DISCHARGED so the panel can offer Reopen + show
      // close history. CANCELLED still hidden.
      episodes: {
        where: { status: { in: ['ACTIVE', 'RECERT_DUE', 'DISCHARGED'] } },
        include: { department: true, goals: { orderBy: { createdAt: 'asc' } } },
        orderBy: [{ status: 'asc' }, { startedAt: 'desc' }],
      },
      encounters: { orderBy: { startedAt: 'desc' }, take: 5 },
    },
  });
  if (!patient) notFound();

  const episodesForPanel = patient.episodes.map((ep) => ({
    id: ep.id,
    diagnosis: ep.diagnosis,
    bodyPart: ep.bodyPart,
    division: ep.division,
    status: ep.status,
    recertDueAt: ep.recertDueAt?.toISOString() ?? null,
    recertIntervalDays: ep.recertIntervalDays,
    visitsAuthorized: ep.visitsAuthorized,
    visitsCompleted: ep.visitsCompleted,
    closeReason: ep.closeReason,
    reopenReason: ep.reopenReason,
    department: { name: ep.department.name },
    goals: ep.goals.map((g) => ({
      id: g.id,
      goalType: g.goalType,
      goalText: g.goalText,
      status: g.status,
      currentMeasure: g.currentMeasure,
      targetMeasure: g.targetMeasure,
    })),
  }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <PatientIdentityHeader patient={patient} />

      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Full patient detail (snapshot strip + visit history + reference cards) ships in Unit 12.
        </p>
        <StartVisitButton patientId={patient.id} />
      </div>

      <EpisodesPanel
        patientId={patient.id}
        patientDivision={patient.division}
        episodes={episodesForPanel}
      />

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-md">Recent visits</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {patient.encounters.length === 0 ? (
              <p className="text-sm text-muted-foreground">No visits yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {patient.encounters.map((e) => (
                  <li key={e.id} className="rounded-md border border-border p-2 flex items-center justify-between">
                    <span>{e.startedAt?.toLocaleDateString() ?? 'unscheduled'}</span>
                    <StatusBadge variant="neutral" noIcon>{e.status}</StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader><CardTitle className="text-md">Demographics + addresses + coverage</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-2">
              <div><p className="text-xs text-muted-foreground uppercase">Phone</p><p>{patient.phone ?? '—'}</p></div>
              <div><p className="text-xs text-muted-foreground uppercase">Email</p><p>{patient.email ?? '—'}</p></div>
              <div><p className="text-xs text-muted-foreground uppercase">Site</p><p>{patient.siteId ?? '—'}</p></div>
            </div>
            {patient.addresses.length === 0 ? (
              <p className="text-muted-foreground">No addresses on file.</p>
            ) : (
              <ul className="space-y-1">
                {patient.addresses.map((a) => (
                  <li key={a.id} className="text-muted-foreground">
                    <StatusBadge variant="neutral" noIcon className="mr-2">{a.kind}</StatusBadge>
                    {a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city}, {a.state} {a.postalCode}
                  </li>
                ))}
              </ul>
            )}
            {patient.coverages.length === 0 ? (
              <p className="text-muted-foreground">No coverage on file.</p>
            ) : (
              <ul className="space-y-1">
                {patient.coverages.map((c) => (
                  <li key={c.id} className="text-muted-foreground">
                    <StatusBadge
                      variant={c.status === 'ACTIVE' ? 'success' : c.status === 'TERMINATED' ? 'danger' : 'warning'}
                      noIcon
                      className="mr-2"
                    >
                      {c.status}
                    </StatusBadge>
                    {c.carrier} · member {c.memberId}{c.planName ? ` (${c.planName})` : ''}
                  </li>
                ))}
              </ul>
            )}
            <p className="pt-3 text-xs italic text-muted-foreground">
              Full inline-editable demographics + PatientEditSheet arrive in Unit 12.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
