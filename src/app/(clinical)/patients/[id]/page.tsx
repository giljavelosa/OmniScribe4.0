import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { PatientIdentityHeader } from '@/components/patients/patient-identity-header';
import { StartVisitButton } from './_components/start-visit-button';

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
      episodes: {
        where: { status: { in: ['ACTIVE', 'RECERT_DUE'] } },
        include: { department: true, goals: true },
      },
      encounters: { orderBy: { startedAt: 'desc' }, take: 5 },
    },
  });
  if (!patient) notFound();

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <PatientIdentityHeader patient={patient} />

      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Full patient detail (snapshot strip + visit history + reference cards) ships in Unit 12.
        </p>
        <StartVisitButton patientId={patient.id} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-md">Active episodes</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {patient.episodes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active episodes.</p>
            ) : (
              patient.episodes.map((ep) => (
                <div key={ep.id} className="rounded-md border border-border p-3 text-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{ep.department.name}</p>
                    <StatusBadge variant={ep.status === 'ACTIVE' ? 'success' : 'warning'}>
                      {ep.status}
                    </StatusBadge>
                  </div>
                  <p className="text-muted-foreground">{ep.diagnosis}</p>
                  {ep.goals.length > 0 && (
                    <ul className="list-disc pl-5 text-muted-foreground space-y-1">
                      {ep.goals.map((g) => <li key={g.id}>{g.goalText}</li>)}
                    </ul>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

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
