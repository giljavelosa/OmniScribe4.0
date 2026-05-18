'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  StartVisitDialog,
  type StartVisitDialogEpisode,
} from './start-visit-dialog';

type Props = {
  patientId: string;
  /** Active episodes for the patient (status ∈ {ACTIVE, RECERT_DUE}). The
   * picker auto-skips when there are 0 or 1 — the button still POSTs through
   * the same code path so audit metadata records the source consistently. */
  activeEpisodes: StartVisitDialogEpisode[];
};

/**
 * Patient-chart "Start visit (ad-hoc)" button.
 *
 * Behavior:
 *   - 0 active episodes  → dialog auto-POSTs without UI (source=auto-none).
 *   - 1 active episode   → dialog auto-POSTs with episodeOfCareId (source=auto-single).
 *   - 2+ active episodes → dialog opens for the clinician to pick.
 *
 * Routes to /prepare/[noteId] on success.
 */
export function StartVisitButton({ patientId, activeEpisodes }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function onStarted({ noteId }: { encounterId: string; noteId: string }) {
    // /prepare/[noteId] is the unit-03 prepare surface; the encounter id is
    // discoverable from the note on the server.
    router.push(`/prepare/${noteId}`);
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Start visit (ad-hoc)</Button>
      <StartVisitDialog
        patientId={patientId}
        activeEpisodes={activeEpisodes}
        open={open}
        onOpenChange={setOpen}
        onStarted={onStarted}
      />
    </>
  );
}
