import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { PatientIdentityHeader } from '@/components/patients/patient-identity-header';
import { PasteTranscriptForm } from './_components/paste-transcript-form';
import { UploadAudioForm } from './_components/upload-audio-form';

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

  const isPreparing = note.status === 'PREPARING';

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
      <PatientIdentityHeader patient={note.patient} />

      <Card>
        <CardHeader>
          <CardTitle>Prepare for visit</CardTitle>
          <CardDescription>
            Prior-context brief lands in Unit 06; the setup form (template + style) lands in Unit 05.
            For Unit 03 you can record live, upload an existing audio file, or paste a transcript.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <StatusBadge variant="info" noIcon>note · {note.status}</StatusBadge>
            <StatusBadge variant="neutral" noIcon>{note.division}</StatusBadge>
            <StatusBadge variant="neutral" noIcon>{note.captureMode}</StatusBadge>
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

      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-md">Live</CardTitle>
            <CardDescription>Record audio in-room with diarized live transcript.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild disabled={!isPreparing} className="w-full">
              <Link href={`/capture/${note.id}`}>
                {isPreparing ? 'Start recording →' : `Status: ${note.status}`}
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-md">Upload audio</CardTitle>
            <CardDescription>WAV / MP3 / M4A / WebM / OGG up to 200 MB.</CardDescription>
          </CardHeader>
          <CardContent>
            <UploadAudioForm noteId={note.id} disabled={!isPreparing} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-md">Paste transcript</CardTitle>
            <CardDescription>Skip transcription; AI drafts directly from your text.</CardDescription>
          </CardHeader>
          <CardContent>
            <PasteTranscriptForm noteId={note.id} disabled={!isPreparing} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
