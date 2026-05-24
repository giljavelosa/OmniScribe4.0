'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Mic } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  StartVisitDialog,
  type StartVisitDialogCase,
  type StartVisitDialogSite,
} from './start-visit-dialog';
import type { Division } from '@prisma/client';
import { useProposedIntent } from '@/hooks/use-proposed-intent';

type Props = {
  patientId: string;
  activeCases: StartVisitDialogCase[];
  viewerDivision: Division | null;
  /** Sites the clinician can pick from for THIS visit's site-of-record.
   * Server-filtered by site scope (ORG_ADMIN sees all; site-scoped sees
   * their enrollments). */
  sites: StartVisitDialogSite[];
  /** Pre-selected site: patient's default if still in scope, else the
   * clinician's primary enrolled site, else the first available. May be
   * null only when the caller has zero pickable sites (rare). */
  defaultSiteId: string | null;
};

/**
 * Patient-chart "Start visit (ad-hoc)" button — button-with-dropdown layout.
 *
 * Primary tap = "Start visit" (default today's date, one-click for the
 * everyday case). The chevron opens a dropdown that surfaces "Start late
 * entry…" which forces the date-picker UI on regardless of episode count
 * (spec design amendment — the picker would otherwise be unreachable for
 * 0/1-episode patients).
 *
 * Behavior of the primary action:
 *   - 0 active episodes  → dialog auto-POSTs without UI (source=auto-none).
 *   - 1 active episode   → dialog auto-POSTs with episodeOfCareId (source=auto-single).
 *   - 2+ active episodes → dialog opens for the clinician to pick.
 *
 * The "Start late entry…" entry path always opens the dialog with the date
 * picker visible.
 *
 * Routes to /prepare/[noteId] on success.
 */
export function StartVisitButton({
  patientId,
  activeCases,
  viewerDivision,
  sites,
  defaultSiteId,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [forceDatePicker, setForceDatePicker] = useState(false);
  // Unit 48 PR2 — Miss Cleo's deterministic visit-type proposal. Fetches
  // on mount so the chip renders immediately when the dialog opens.
  // Stays undefined on error → dialog gracefully omits the chip (Decision 7).
  const proposedIntent = useProposedIntent(patientId);

  function onStarted({ noteId }: { encounterId: string; noteId: string }) {
    // /prepare/[noteId] is the unit-03 prepare surface; the encounter id is
    // discoverable from the note on the server.
    router.push(`/prepare/${noteId}`);
  }

  function openNormal() {
    setForceDatePicker(false);
    setOpen(true);
  }

  function openLateEntry() {
    setForceDatePicker(true);
    setOpen(true);
  }

  return (
    <>
      <div className="inline-flex items-stretch rounded-md shadow-sm">
        <Button
          onClick={openNormal}
          className="rounded-r-none gap-2"
          aria-label="Start visit"
        >
          <Mic className="h-3.5 w-3.5" aria-hidden />
          Start visit
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="default"
              aria-label="More visit options"
              className="rounded-l-none border-l border-l-[color-mix(in_oklab,var(--primary-foreground)_25%,transparent)] px-2"
            >
              <ChevronDown className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={openLateEntry}>
              Start late entry…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <StartVisitDialog
        patientId={patientId}
        activeCases={activeCases}
        viewerDivision={viewerDivision}
        sites={sites}
        defaultSiteId={defaultSiteId}
        open={open}
        onOpenChange={setOpen}
        onStarted={onStarted}
        forceDatePicker={forceDatePicker}
        proposedIntent={proposedIntent}
      />
    </>
  );
}
