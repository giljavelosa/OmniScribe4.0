'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBanner } from '@/components/ui/status-banner';
import { PatientIdentityHeader } from '@/components/patients/patient-identity-header';
import { SectionProgressStrip } from '@/components/notes/section-progress-strip';
import { SectionAccordion } from './section-accordion';
import { ReadinessPanel } from './readiness-panel';
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
  draftJson: Record<string, { content: string; updatedAt: string }> | null;
  finalJson: Record<string, { content: string; updatedAt: string }> | null;
  lastWorkerError: string | null;
  interruptedAt: string | null;
};

type Props = {
  noteId: string;
  initial: ReviewSnapshot;
};

/**
 * /review client. Subscribes to GET /api/notes/[id]/stream?include=sections
 * so the section status + draft content stay live while the worker fills in
 * sections, while the clinician edits inline, while regenerate happens.
 *
 * Re-fetches /api/notes/[id] on every SECTIONS event so the SectionAccordion's
 * content stays current with what the worker wrote.
 */
export function ReviewClient({ noteId, initial }: Props) {
  const router = useRouter();
  const [snap, setSnap] = useState<ReviewSnapshot>(initial);

  // Live section + status updates from SSE (?include=sections — Unit 04's
  // SSE diffs Note.inferenceLog._sectionStatus → SECTIONS event).
  useEffect(() => {
    const src = new EventSource(`/api/notes/${noteId}/stream?include=sections`);
    let inFlight = false;
    async function refetch() {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/notes/${noteId}`);
        if (!res.ok) return;
        const body = await res.json();
        if (body?.data) setSnap((s) => mergeSnapshot(s, body.data));
      } finally {
        inFlight = false;
      }
    }
    src.addEventListener('STATUS', () => void refetch());
    src.addEventListener('SECTIONS', () => void refetch());
    return () => src.close();
  }, [noteId]);

  // If status flips to SIGNED while we're on review, route the clinician to
  // /sign (or back to /review of the signed note depending on flow).
  useEffect(() => {
    if (snap.status === 'SIGNED') router.refresh();
  }, [snap.status, router]);

  const progress: ProgressStripCell[] = deriveProgressStrip(snap.sections, snap.sectionStatus);
  const readyForSign = isReadyForSign(progress);
  const isSigned = snap.status === 'SIGNED';
  const draftMap = (isSigned ? snap.finalJson : snap.draftJson) ?? {};

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
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

      <Card>
        <CardContent className="py-3">
          <SectionProgressStrip cells={progress} />
        </CardContent>
      </Card>

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
                readOnly={isSigned}
              />
            ))
          )}
        </div>
        <aside className="lg:sticky lg:top-4 self-start">
          <ReadinessPanel
            noteId={noteId}
            cells={progress}
            readyForSign={readyForSign}
            noteStatus={snap.status}
          />
        </aside>
      </div>
    </div>
  );
}

function mergeSnapshot(prev: ReviewSnapshot, next: Partial<ReviewSnapshot>): ReviewSnapshot {
  return { ...prev, ...next, patient: next.patient ?? prev.patient, sections: next.sections ?? prev.sections };
}
