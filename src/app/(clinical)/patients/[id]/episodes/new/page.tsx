import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { NewEpisodeForm } from './_components/new-episode-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New episode' };

/**
 * /patients/[id]/episodes/new — minimal form to create a new episode for a
 * patient. Exists so the start-visit picker has a fast escape hatch when a
 * clinician realizes the patient needs a new episode mid-flow.
 *
 * v1 fields: diagnosis (required) / body part (optional) / division (required)
 * / department (required — Department row chooses division compatibility).
 *
 * Departments are pre-loaded server-side so the client form just renders.
 */
export default async function NewEpisodePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.orgId) return null;

  const [patient, departments] = await Promise.all([
    prisma.patient.findFirst({
      where: { id, orgId: session.user.orgId, isDeleted: false },
      select: { id: true, firstName: true, lastName: true, mrn: true },
    }),
    prisma.department.findMany({
      where: { orgId: session.user.orgId },
      orderBy: [{ division: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, division: true },
    }),
  ]);

  if (!patient) notFound();

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 space-y-4">
      <Link
        href={`/patients/${patient.id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Back to {patient.lastName}, {patient.firstName}
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>New episode of care</CardTitle>
          <CardDescription>
            Episode of care for {patient.lastName}, {patient.firstName} (MRN {patient.mrn}).
            Division is locked when the visit starts, so make sure this matches the care you
            plan to deliver.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewEpisodeForm patientId={patient.id} departments={departments} />
        </CardContent>
      </Card>
    </div>
  );
}
