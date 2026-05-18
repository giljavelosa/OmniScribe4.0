'use client';

import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { StatusBadge } from '@/components/ui/status-badge';
import type { ExternalContextSource, ExternalContextStatus } from './external-context-section';

const SOURCE_LABEL: Record<ExternalContextSource, string> = {
  PATIENT_SUPPLIED: 'Patient-supplied',
  OUTSIDE_PROVIDER: 'Outside provider',
  EARLIER_UNDOCUMENTED: 'Earlier undocumented visit',
  CLINICIAN_NOTES: "Clinician's notes",
  OTHER: 'Other',
};

type ExternalContextDetail = {
  id: string;
  dateOfRecord: string;
  source: ExternalContextSource;
  sourceLabel: string | null;
  status: ExternalContextStatus;
  addedAt: string;
  episodeOfCareId: string | null;
  transcriptClean: string;
  hasAudio: boolean;
  audioUrl: string | null;
  addedBy: {
    orgUserId: string;
    email: string;
    name: string | null;
  };
};

/**
 * Side-sheet detail view for a single ExternalContext row. Lazy-fetches the
 * full transcript (the list view skips it for payload size). Audio player
 * appears when hasAudio && status === READY.
 *
 * Spec: context/specs/external-context-upload.md §UI.
 */
export function ExternalContextDetailSheet({
  patientId,
  externalContextId,
  open,
  onOpenChange,
}: {
  patientId: string;
  externalContextId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [detail, setDetail] = useState<ExternalContextDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      // setState calls live inside the async IIFE so React's
      // set-state-in-effect rule doesn't trip (avoids cascading renders
      // on mount).
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/patients/${patientId}/external-context/${externalContextId}`,
          { cache: 'no-store' },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: { message?: string };
          };
          throw new Error(body.error?.message ?? "Couldn't load.");
        }
        const body = (await res.json()) as { data: ExternalContextDetail };
        if (!cancelled) setDetail(body.data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, patientId, externalContextId]);

  async function copyTranscript() {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(detail.transcriptClean);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard refused (rare; permissions). Silent: the user can still
      // select-all the textarea below.
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col gap-0">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Prior context</SheetTitle>
          <SheetDescription>
            {detail ? (
              <>
                {detail.dateOfRecord.slice(0, 10)} · {SOURCE_LABEL[detail.source]}
                {detail.sourceLabel ? ` · ${detail.sourceLabel}` : ''}
              </>
            ) : (
              <>Loading…</>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading transcript…</p>
          ) : error ? (
            <p className="text-sm text-[var(--status-danger-fg)]">{error}</p>
          ) : detail ? (
            <>
              <div className="flex flex-wrap gap-2 items-center">
                {detail.status === 'READY' ? (
                  <StatusBadge variant="success" noIcon>
                    Ready
                  </StatusBadge>
                ) : detail.status === 'PENDING_TRANSCRIPTION' ? (
                  <StatusBadge variant="info" noIcon>
                    Transcribing…
                  </StatusBadge>
                ) : (
                  <StatusBadge variant="danger">Transcription failed</StatusBadge>
                )}
                <span className="text-xs text-muted-foreground">
                  added by {detail.addedBy.name ?? detail.addedBy.email} on{' '}
                  {detail.addedAt.slice(0, 10)}
                </span>
              </div>

              {detail.hasAudio && detail.audioUrl && detail.status === 'READY' ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Source audio</p>
                  <audio controls src={detail.audioUrl} className="w-full" />
                </div>
              ) : null}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">Transcript</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={copyTranscript}
                    disabled={!detail.transcriptClean}
                  >
                    <Copy className="size-3.5" aria-hidden />
                    {copied ? 'Copied' : 'Copy transcript'}
                  </Button>
                </div>
                {detail.transcriptClean ? (
                  <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-3 text-sm font-mono">
                    {detail.transcriptClean}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Transcript is empty.
                    {detail.status === 'PENDING_TRANSCRIPTION'
                      ? ' Soniox is still processing the audio.'
                      : ''}
                  </p>
                )}
              </div>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
