import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBanner } from '@/components/ui/status-banner';

import { NewEpisodeForm } from './_components/new-episode-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New rehab episode' };

/**
 * /patients/[id]/episodes/new?caseManagementId=… — rehab EpisodeOfCare under a case.
 */
export default async function NewEpisodePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ caseManagementId?: string }>;
}) {
  const { id } = await params;
  const { caseManagementId } = await searchParams;
  const session = await auth();
  if (!session?.user?.orgId) return null;

  const [patient, departments, parentCase] = await Promise.all([
    prisma.patient.findFirst({
      where: { id, orgId: session.user.orgId, isDeleted: false },
      select: { id: true, firstName: true, lastName: true, mrn: true },
    }),
    prisma.department.findMany({
      where: { orgId: session.user.orgId },
      orderBy: [{ division: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, division: true },
    }),
    caseManagementId
      ? prisma.caseManagement.findFirst({
          where: {
            id: caseManagementId,
            patientId: id,
            orgId: session.user.orgId,
            status: 'ACTIVE',
          },
          select: {
            id: true,
            primaryIcd: true,
            primaryIcdLabel: true,
            secondaryIcd: true,
          },
        })
      : Promise.resolve(null),
  ]);

  if (!patient) notFound();

  const caseLabel = parentCase
    ? [
        parentCase.primaryIcd,
        parentCase.primaryIcdLabel,
      ]
        .filter(Boolean)
        .join(' · ') || parentCase.primaryIcdLabel
    : '';

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
          <CardTitle>New rehab episode of care</CardTitle>
          <CardDescription>
            Rehab plan of care for {patient.lastName}, {patient.firstName} (MRN {patient.mrn}).
            Episodes are REHAB-only and must link to an active case management.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!caseManagementId || !parentCase ? (
            <StatusBanner variant="warning">
              Open this form from a patient case (Cases tab or start-visit flow) so the rehab
              episode links to the right case management.
            </StatusBanner>
          ) : (
            <NewEpisodeForm
              patientId={patient.id}
              caseManagementId={parentCase.id}
              caseLabel={caseLabel}
              departments={departments}
              caseHasFlipPair={!!(parentCase.primaryIcd && parentCase.secondaryIcd)}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
