'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Copy, Check, ArrowLeft } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBanner } from '@/components/ui/status-banner';
import { PatientIdentityHeader } from '@/components/patients/patient-identity-header';
import { SectionProgressStrip } from '@/components/notes/section-progress-strip';
import { OpenFollowUpsCard, type CopilotFollowUp } from '@/components/copilot/cards/open-followups-card';
import { SseStatusChip } from '@/components/ui/sse-status-chip';
import { useSseStream } from '@/lib/sse/use-sse-stream';
import { SectionAccordion } from './section-accordion';
import { ReadinessPanel } from './readiness-panel';
import { FailureRecoveryBanner } from './failure-recovery-banner';
import { FlagReviewPanel } from './flag-review-panel';
import { NoteStyleToggle } from './note-style-toggle';
import { TranscriptSheet } from './transcript-sheet';
import {
  deriveProgressStrip,
  isReadyForSign,
  type ProgressStripCell,
} from '@/lib/notes/derive-progress-strip';
import type { NoteSectionDef } from '@/lib/notes/build-prompt';
import type { SectionStatusEntry } from '@/lib/notes/section-status';

type ReviewSnapshot = {
  id: string;
  status: string;
  division: string;
  noteStyle: string;
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    mrn: string;
    dob: string;
    sex: string;
    division: string;
    preferredLanguage: string | null;
    isDeleted: boolean;
  };
  sections: NoteSectionDef[];
  sectionStatus: Record<string, SectionStatusEntry>;
  /** Per-section flag — see /api/notes/[id] route. Drives the
   *  "Show what changed" link visibility in SectionAccordion. */
  sectionHasRegenHistory: Record<string, boolean>;
  draftJson: Record<string, { content: string; updatedAt: string }> | null;
  finalJson: Record<string, { content: string; updatedAt: string }> | null;
  lastWorkerError: string | null;
  interruptedAt: string | null;
};

type Props = {
  noteId: string;
  initial: ReviewSnapshot;
  /** Live open follow-ups for this patient (server-fetched once per request).
   *  Rendered in the sticky sidebar below ReadinessPanel as a Watch v0
   *  surface. Optimistic chip mutations stay local to the card; the next
   *  navigation re-fetches authoritative state. */
  copilotFollowUps: CopilotFollowUp[];
};

/**
 * /review client. Subscribes to GET /api/notes/[id]/stream?include=sections
 * so the section status + draft content stay live while the worker fills in
 * sections, while the clinician edits inline, while regenerate happens.
 *
 * Re-fetches /api/notes/[id] on every SECTIONS event so the SectionAccordion's
 * content stays current with what the worker wrote.
 */
export function ReviewClient({ noteId, initial, copilotFollowUps }: Props) {
  const router = useRouter();
  const [snap, setSnap] = useState<ReviewSnapshot>(initial);

  // Live section + status updates from SSE — uses useSseStream so transient
  // disconnects don't silently freeze the surface (Unit 10).
  const inFlightRef = useRef(false);
  async function refetch() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch(`/api/notes/${noteId}`);
      if (!res.ok) return;
      const body = await res.json();
      if (body?.data) setSnap((s) => mergeSnapshot(s, body.data));
    } finally {
      inFlightRef.current = false;
    }
  }
  const { status: sseStatus } = useSseStream(`/api/notes/${noteId}/stream?include=sections`, {
    enabled: snap.status !== 'SIGNED',
    handlers: {
      STATUS: () => void refetch(),
      SECTIONS: () => void refetch(),
    },
  });

  // If status flips to SIGNED while we're on review, route the clinician to
  // /sign (or back to /review of the signed note depending on flow).
  useEffect(() => {
    if (snap.status === 'SIGNED') router.refresh();
  }, [snap.status, router]);

  const progress: ProgressStripCell[] = deriveProgressStrip(snap.sections, snap.sectionStatus);
  const readyForSign = isReadyForSign(progress);
  const isSigned = snap.status === 'SIGNED';
  // finalJson is the canonical wrapper { sections: [{id,label,content}], signedAt, schemaVersion },
  // NOT the flat {[id]: {content}} map draftJson uses. Normalize so SectionAccordion's
  // [section.id] lookup works the same for both DRAFT and SIGNED notes.
  const draftMap: Record<string, { content: string; updatedAt?: string }> = (() => {
    if (isSigned && snap.finalJson) {
      const raw = snap.finalJson as unknown as {
        sections?: Array<{ id: string; content: string }>;
      };
      if (Array.isArray(raw.sections)) {
        return Object.fromEntries(raw.sections.map((s) => [s.id, { content: s.content }]));
      }
    }
    return (isSigned ? snap.finalJson : snap.draftJson) ?? {};
  })();

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <Link
        href={`/patients/${snap.patient.id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" aria-hidden />
        Back to patient chart
      </Link>
      <PatientIdentityHeader
        patient={{
          firstName: snap.patient.firstName,
          lastName: snap.patient.lastName,
          mrn: snap.patient.mrn,
          dob: new Date(snap.patient.dob),
          sex: snap.patient.sex as never,
          division: snap.patient.division as never,
          preferredLanguage: snap.patient.preferredLanguage,
          isDeleted: snap.patient.isDeleted,
        }}
      />

      {snap.interruptedAt && (
        <StatusBanner variant="danger" title="Generation was interrupted">
          {snap.lastWorkerError ?? 'A worker failure stopped the pipeline.'} You can write or paste
          content into each section manually, or tap Regenerate to retry.
        </StatusBanner>
      )}

      {!isSigned && (() => {
        const failed = snap.sections
          .map((s) => ({
            sectionId: s.id,
            label: s.label,
            status: snap.sectionStatus[s.id]?.status,
            errorMessage: snap.sectionStatus[s.id]?.error?.message,
          }))
          .filter((s) => s.status === 'failed');
        return failed.length > 0 ? (
          <FailureRecoveryBanner noteId={noteId} failedSections={failed} />
        ) : null;
      })()}

      <FlagReviewPanel
        noteId={noteId}
        sections={snap.sections.map((s) => ({ id: s.id, label: s.label }))}
        isSigned={isSigned}
      />

      <NoteStyleToggle
        noteId={noteId}
        noteStyle={snap.noteStyle}
        isSigned={isSigned}
      />

      <Card>
        <CardContent className="py-3 flex items-center justify-between gap-3">
          <SectionProgressStrip cells={progress} />
          <div className="flex items-center gap-2">
            <TranscriptSheet noteId={noteId} />
            <CopyEntireNoteButton snap={snap} />
            <SseStatusChip status={sseStatus} />
          </div>
        </CardContent>
      </Card>

      {sseStatus === 'offline' && (
        <StatusBanner variant="warning" title="Live updates offline">
          Reconnect attempts failed. Refresh the page to reconnect — saved edits aren&apos;t lost.
        </StatusBanner>
      )}

      <div className="grid lg:grid-cols-[1fr_18rem] gap-4">
        <div className="space-y-3">
          {snap.sections.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-sm text-muted-foreground">
                No template selected yet — sections will appear once the worker assigns one.
              </CardContent>
            </Card>
          ) : (
            snap.sections.map((section) => (
              <SectionAccordion
                key={section.id}
                noteId={noteId}
                sectionId={section.id}
                label={section.label}
                isRequired={!!section.required}
                initialContent={draftMap[section.id]?.content ?? ''}
                initialStatus={snap.sectionStatus[section.id]?.status ?? 'empty'}
                hasRegenHistory={snap.sectionHasRegenHistory?.[section.id] ?? false}
                readOnly={isSigned}
              />
            ))
          )}
        </div>
        <aside className="lg:sticky lg:top-4 self-start space-y-3">
          <ReadinessPanel
            noteId={noteId}
            cells={progress}
            readyForSign={readyForSign}
            noteStatus={snap.status}
          />
          <OpenFollowUpsCard
            followUps={copilotFollowUps}
            surface="review"
            noteId={noteId}
          />
        </aside>
      </div>
    </div>
  );
}

function mergeSnapshot(prev: ReviewSnapshot, next: Partial<ReviewSnapshot>): ReviewSnapshot {
  return { ...prev, ...next, patient: next.patient ?? prev.patient, sections: next.sections ?? prev.sections };
}

function CopyEntireNoteButton({ snap }: { snap: ReviewSnapshot }) {
  const [copied, setCopied] = useState(false);

  // Normalize signed finalJson (canonical wrapper) into the same {id: {content}}
  // shape draftJson uses, so the loop below works for both states.
  const sourceMap: Record<string, { content: string }> = (() => {
    if (snap.status === 'SIGNED' && snap.finalJson) {
      const raw = snap.finalJson as unknown as {
        sections?: Array<{ id: string; content: string }>;
      };
      if (Array.isArray(raw.sections)) {
        return Object.fromEntries(raw.sections.map((s) => [s.id, { content: s.content }]));
      }
    }
    return (snap.draftJson ?? {}) as Record<string, { content: string }>;
  })();

  function copy() {
    const lines: string[] = [];
    const header = `${snap.patient.lastName}, ${snap.patient.firstName} — MRN ${snap.patient.mrn}`;
    lines.push(header);
    lines.push('='.repeat(header.length));
    lines.push('');
    for (const s of snap.sections) {
      const body = sourceMap[s.id]?.content?.trim();
      if (!body) continue;
      lines.push(s.label);
      lines.push('-'.repeat(s.label.length));
      lines.push(body);
      lines.push('');
    }
    const text = lines.join('\n').trimEnd() + '\n';
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const filled = Object.keys(sourceMap).length > 0;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copy}
      disabled={!filled}
      className="gap-1"
      aria-label="Copy entire note to clipboard"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-[var(--status-success-fg)]" aria-hidden />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" aria-hidden />
          Copy entire note
        </>
      )}
    </Button>
  );
}
