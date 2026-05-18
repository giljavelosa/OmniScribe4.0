import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { PatientIdentityHeader } from '@/components/patients/patient-identity-header';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Prepare visit' };

export default async function PreparePage({ params }: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await params;
  const session = await auth();
  if (!session?.user?.orgId) return null;

  const note = await prisma.note.findFirst({
    where: { id: noteId, orgId: session.user.orgId },
    include: {
      patient: true,
      encounter: { include: { schedule: true } },
    },
  });
  if (!note) notFound();

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
      <PatientIdentityHeader patient={note.patient} />
      <Card>
        <CardHeader>
          <CardTitle>Prepare for visit</CardTitle>
          <CardDescription>
            Real prior-context brief + setup form + Start Recording land in Unit 03 (Capture)
            and Unit 06 (Prior-context brief).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <StatusBadge variant="info" noIcon>note · {note.status}</StatusBadge>
            <StatusBadge variant="neutral" noIcon>{note.division}</StatusBadge>
            {note.encounter?.status && (
              <StatusBadge variant="neutral" noIcon>encounter · {note.encounter.status}</StatusBadge>
            )}
          </div>
          {note.encounter?.schedule && (
            <p className="text-muted-foreground">
              Scheduled {note.encounter.schedule.scheduledStart.toLocaleString()} ·{' '}
              {note.encounter.schedule.visitType}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
