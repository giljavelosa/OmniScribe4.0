'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Lock, AlertTriangle, FileText, Mic, MessageSquareText, Sparkles, Stethoscope } from 'lucide-react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { UserAvatar } from '@/components/ui/user-avatar';
import type { NoteSectionDef } from '@/lib/notes/build-prompt';
import { COPILOT_DISPLAY_NAME } from '@/services/copilot/persona';

type Patient = {
  id: string;
  firstName: string;
  lastName: string;
  mrn: string | null;
  dob: string;
  sex: string;
};

type NoteMeta = {
  status: string;
  division: string;
  signedAt: string | null;
  dateOfService: string;
  isLateEntry: boolean;
  lateEntryDaysGap: number | null;
  templateName: string | null;
};

type EpisodeMeta = {
  diagnosis: string;
  bodyPart: string | null;
  departmentName: string | null;
} | null;

type Artifact = {
  id: string;
  kind: string;
  content: unknown;
  generatedAt: string;
};

type Props = {
  noteId: string;
  patient: Patient;
  note: NoteMeta;
  episode: EpisodeMeta;
  documentingClinicianName: string;
  documentingProfession: string | null;
  signingClinicianName: string;
  sections: NoteSectionDef[];
  finalContent: Record<string, string>;
  artifacts: Artifact[];
};

const DIVISION_LABELS: Record<string, string> = {
  MEDICAL: 'Medical',
  REHAB: 'Rehab',
  BEHAVIORAL_HEALTH: 'Behavioral Health',
  MULTI: 'Multi',
};

/**
 * VisitViewerClient — read-only viewer for a signed visit. Four tabs:
 *   - Note: rendered sections from finalJson with signature block
 *   - Handout: NoteArtifact patient instructions + referral letter
 *   - Transcript: cleaned diarized transcript (lazy fetch on tab focus)
 *   - Recording: audio playback via presigned URL (lazy fetch on tab focus)
 *
 * Has no editing affordances. Cannot mutate the note by construction.
 */
export function VisitViewerClient({
  noteId,
  patient,
  note,
  episode,
  documentingClinicianName,
  documentingProfession,
  signingClinicianName,
  sections,
  finalContent,
  artifacts,
}: Props) {
  const ageYears = computeAge(patient.dob);
  const signedAtDisplay = note.signedAt
    ? new Date(note.signedAt).toLocaleString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'unsigned';
  const dateOfServiceDisplay = new Date(note.dateOfService).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const patientHandout = artifacts.find((a) => a.kind === 'PATIENT_INSTRUCTIONS');
  const referralLetter = artifacts.find((a) => a.kind === 'REFERRAL_LETTER');

  // Desktop (lg+): pin the page to the viewport minus the clinical nav header
  // (4rem — see (clinical)/layout.tsx) so a long note scrolls inside its card
  // instead of growing the whole page. Mobile keeps natural document scroll
  // (the fixed bottom nav owns that space there).
  return (
    <div className="mx-auto max-w-4xl w-full px-4 py-6 flex flex-col gap-4 lg:h-[calc(100dvh-4rem)] lg:overflow-hidden">
      {/* Back link */}
      <div className="shrink-0 flex items-center justify-between gap-3 flex-wrap">
        <Link
          href={`/patients/${patient.id}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to {patient.firstName} {patient.lastName}
        </Link>
        <div className="flex items-center gap-2">
          <StatusBadge variant="success" noIcon>
            <Lock className="h-3 w-3 inline mr-1" aria-hidden />
            Signed
          </StatusBadge>
          <span className="text-xs text-muted-foreground">{signedAtDisplay}</span>
        </div>
      </div>

      {/* Visit header card */}
      <Card className="shrink-0">
        <CardContent className="flex items-start gap-3 pt-6">
          <UserAvatar firstName={patient.firstName} lastName={patient.lastName} size="lg" className="shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-tight">
              {patient.firstName} {patient.lastName}
            </h1>
            <p className="text-sm text-muted-foreground">
              {ageYears}y {patient.sex}
              {patient.mrn && (
                <>
                  {' '}
                  · <span className="font-mono">MRN {patient.mrn}</span>
                </>
              )}
            </p>
            <p className="text-sm text-foreground mt-2">
              {episode?.diagnosis ?? 'Ad-hoc visit'}
              {episode?.bodyPart && <span className="text-muted-foreground"> · {episode.bodyPart}</span>}
              {' · '}
              <span className="text-muted-foreground">
                {DIVISION_LABELS[note.division] ?? note.division}
              </span>
              {note.templateName && (
                <span className="text-muted-foreground"> · {note.templateName}</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Seen by {documentingClinicianName}
              {documentingProfession && <span> · {documentingProfession}</span>}
            </p>
            {note.isLateEntry && note.lateEntryDaysGap !== null && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[oklch(0.85_0.10_75)] bg-[oklch(0.96_0.05_75)] px-2 py-1 text-xs text-[oklch(0.45_0.15_75)]">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                Late entry · documented {note.lateEntryDaysGap} day
                {note.lateEntryDaysGap === 1 ? '' : 's'} after visit
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="note" className="gap-3 lg:flex-1 lg:min-h-0">
        <TabsList className="grid grid-cols-4 w-full max-w-md shrink-0">
          <TabsTrigger value="note" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Note</span>
          </TabsTrigger>
          <TabsTrigger value="handout" className="gap-1.5">
            <Stethoscope className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Handout</span>
          </TabsTrigger>
          <TabsTrigger value="transcript" className="gap-1.5">
            <MessageSquareText className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Transcript</span>
          </TabsTrigger>
          <TabsTrigger value="recording" className="gap-1.5">
            <Mic className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Recording</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="note" className="lg:min-h-0 lg:overflow-hidden">
          <NoteTab
            sections={sections}
            finalContent={finalContent}
            signingClinicianName={signingClinicianName}
            signedAtDisplay={signedAtDisplay}
            dateOfServiceDisplay={dateOfServiceDisplay}
            isLateEntry={note.isLateEntry}
          />
        </TabsContent>

        <TabsContent value="handout" className="lg:min-h-0 lg:overflow-y-auto">
          <HandoutTab
            patientHandout={patientHandout}
            referralLetter={referralLetter}
          />
        </TabsContent>

        <TabsContent value="transcript" className="lg:min-h-0 lg:overflow-y-auto">
          <TranscriptTab noteId={noteId} />
        </TabsContent>

        <TabsContent value="recording" className="lg:min-h-0 lg:overflow-y-auto">
          <RecordingTab noteId={noteId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function NoteTab({
  sections,
  finalContent,
  signingClinicianName,
  signedAtDisplay,
  dateOfServiceDisplay,
  isLateEntry,
}: {
  sections: NoteSectionDef[];
  finalContent: Record<string, string>;
  signingClinicianName: string;
  signedAtDisplay: string;
  dateOfServiceDisplay: string;
  isLateEntry: boolean;
}) {
  if (sections.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          This note has no section template. The signed content cannot be displayed.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="lg:h-full lg:flex lg:flex-col lg:overflow-hidden">
      <CardContent className="pt-6 space-y-5 lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
        {sections.map((s) => {
          const content = finalContent[s.id] ?? '';
          return (
            <section key={s.id} className="space-y-1.5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {s.label}
              </h2>
              {content ? (
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{content}</p>
              ) : (
                <p className="text-sm text-muted-foreground italic">No content</p>
              )}
            </section>
          );
        })}

        {/* Signature block */}
        <div className="border-t border-border pt-4 mt-4 space-y-1">
          <p className="text-xs text-muted-foreground">
            Signed by <span className="font-medium text-foreground">{signingClinicianName}</span>
            {' · '}
            {signedAtDisplay}
          </p>
          {isLateEntry && (
            <p className="text-xs text-muted-foreground italic">
              Late entry note: documenting a visit from {dateOfServiceDisplay}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type PatientInstructionsContent = {
  plainLanguage?: string;
  bulletPoints?: string[];
  whatToWatchFor?: string[];
  whenToCallUs?: string[];
};

type ReferralLetterContent = {
  recipient?: string;
  subject?: string;
  body?: string;
};

function HandoutTab({
  patientHandout,
  referralLetter,
}: {
  patientHandout: Artifact | undefined;
  referralLetter: Artifact | undefined;
}) {
  if (!patientHandout && !referralLetter) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          No patient handout or referral letter was generated for this visit.
        </CardContent>
      </Card>
    );
  }

  const handout = patientHandout?.content as PatientInstructionsContent | null;
  const referral = referralLetter?.content as ReferralLetterContent | null;

  return (
    <div className="space-y-4">
      {handout && (
        <Card>
          <CardHeader>
            <CardTitle className="text-md flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary shrink-0" aria-hidden />
              {COPILOT_DISPLAY_NAME}&rsquo;s draft patient handout
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {handout.plainLanguage && (
              <p className="whitespace-pre-wrap leading-relaxed">{handout.plainLanguage}</p>
            )}
            {handout.bulletPoints && handout.bulletPoints.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Key points
                </p>
                <ul className="list-disc list-inside space-y-1">
                  {handout.bulletPoints.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            )}
            {handout.whatToWatchFor && handout.whatToWatchFor.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  What to watch for
                </p>
                <ul className="list-disc list-inside space-y-1">
                  {handout.whatToWatchFor.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            )}
            {handout.whenToCallUs && handout.whenToCallUs.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  When to call us
                </p>
                <ul className="list-disc list-inside space-y-1">
                  {handout.whenToCallUs.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {referral && (
        <Card>
          <CardHeader>
            <CardTitle className="text-md flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary shrink-0" aria-hidden />
              {COPILOT_DISPLAY_NAME}&rsquo;s draft referral letter
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {referral.recipient && (
              <p>
                <span className="text-muted-foreground">To: </span>
                <span className="font-medium">{referral.recipient}</span>
              </p>
            )}
            {referral.subject && (
              <p>
                <span className="text-muted-foreground">Re: </span>
                <span className="font-medium">{referral.subject}</span>
              </p>
            )}
            {referral.body && (
              <p className="whitespace-pre-wrap leading-relaxed">{referral.body}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type TranscriptCleanRow = {
  text: string;
  speaker: 'CLINICIAN' | 'PATIENT' | 'OTHER';
  startMs?: number;
};

type TranscriptCleanShape = {
  plaintext?: string;
  structured?: TranscriptCleanRow[];
};

function TranscriptTab({ noteId }: { noteId: string }) {
  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'loaded'; transcript: TranscriptCleanShape | null }
    | { phase: 'error'; message: string }
  >({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/notes/${noteId}/transcript`);
        if (!res.ok) {
          if (!cancelled) {
            setState({ phase: 'error', message: 'Could not load the transcript.' });
          }
          return;
        }
        const body = await res.json();
        if (!cancelled) {
          setState({
            phase: 'loaded',
            transcript: body?.data?.transcriptClean ?? null,
          });
        }
      } catch {
        if (!cancelled) {
          setState({ phase: 'error', message: 'Could not load the transcript.' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  if (state.phase === 'loading') {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">Loading transcript…</CardContent>
      </Card>
    );
  }
  if (state.phase === 'error') {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">{state.message}</CardContent>
      </Card>
    );
  }

  const rows = state.transcript?.structured ?? [];
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          No transcript on file for this visit.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-3">
            <span
              className={`text-[10px] uppercase tracking-wide font-semibold shrink-0 w-20 pt-0.5 ${
                row.speaker === 'CLINICIAN'
                  ? 'text-[var(--speaker-1)]'
                  : row.speaker === 'PATIENT'
                    ? 'text-[var(--speaker-2)]'
                    : 'text-muted-foreground'
              }`}
            >
              {row.speaker === 'CLINICIAN' ? 'Clinician' : row.speaker === 'PATIENT' ? 'Patient' : 'Other'}
            </span>
            <p className="text-sm flex-1 leading-relaxed">{row.text}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function RecordingTab({ noteId }: { noteId: string }) {
  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'ready'; url: string | null }
    | { phase: 'error'; message: string }
  >({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/notes/${noteId}/audio-url`);
        if (!res.ok) {
          if (!cancelled) {
            setState({ phase: 'error', message: 'Could not load the recording.' });
          }
          return;
        }
        const body = await res.json();
        if (!cancelled) {
          setState({ phase: 'ready', url: body?.data?.url ?? null });
        }
      } catch {
        if (!cancelled) {
          setState({ phase: 'error', message: 'Could not load the recording.' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  if (state.phase === 'loading') {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">Loading recording…</CardContent>
      </Card>
    );
  }
  if (state.phase === 'error') {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">{state.message}</CardContent>
      </Card>
    );
  }
  if (!state.url) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          No audio recording on file for this visit. This is normal for pasted-transcript notes.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <p className="text-xs text-muted-foreground">
          Audio playback link expires after 30 minutes. Refresh the page to generate a new link.
        </p>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio controls src={state.url} className="w-full" aria-label="Visit recording" />
      </CardContent>
    </Card>
  );
}

function computeAge(dobIso: string): number {
  const dob = new Date(dobIso);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}
