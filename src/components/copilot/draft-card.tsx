'use client';

import { useState, useTransition } from 'react';
import { Calendar, Check, ClipboardCopy, FileText, MessageSquare, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/ui/status-badge';

type DraftKind = 'patient-message' | 'followup-cadence' | 'referral-letter';

export type DraftCardProps = {
  draftId: string;
  kind: DraftKind;
  initialContent: string;
  meta: Record<string, unknown>;
  /** Required for kind === 'followup-cadence' (sideEffect = followup-create). */
  patientId?: string;
  noteId?: string;
};

/**
 * DraftCard — Unit 30 / Phase 55 surface.
 *
 * The agent SUGGESTED this draft; the clinician DECIDES. State
 * machine:
 *   - 'pending'    — initial; textarea editable; Accept / Edit /
 *                    Discard visible
 *   - 'confirmed'  — terminal; card grays out + shows "Confirmed" +
 *                    actionTaken summary
 *   - 'discarded'  — terminal; card grays out + shows "Discarded"
 *   - 'error'      — confirm/discard request failed; user can retry
 *
 * Side-effect dispatch on Accept:
 *   - patient-message     → clipboard write + POST confirm with
 *                           sideEffect: 'clipboard'
 *   - referral-letter     → clipboard write + POST confirm with
 *                           sideEffect: 'clipboard'
 *   - followup-cadence    → POST confirm with sideEffect:
 *                           'followup-create' (server creates the
 *                           FollowUp row)
 *
 * Edit tracking: any keystroke in the textarea flips `wasEdited`
 * true. The confirm POST carries this flag so the audit reflects
 * the clinician's actual contribution.
 */
export function DraftCard({
  draftId,
  kind,
  initialContent,
  meta,
  patientId,
  noteId,
}: DraftCardProps) {
  const [content, setContent] = useState(initialContent);
  const [wasEdited, setWasEdited] = useState(false);
  const [state, setState] = useState<
    'pending' | 'confirmed' | 'discarded' | 'error'
  >('pending');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sideEffect = kind === 'followup-cadence' ? 'followup-create' : 'clipboard';
  const isTerminal = state === 'confirmed' || state === 'discarded';

  function confirmDraft() {
    if (isTerminal || pending) return;
    setErrorMsg(null);
    startTransition(async () => {
      // Clipboard side-effect: write client-side BEFORE the POST so
      // the audit row reflects the user's actual paste-ready state.
      // Best-effort: a clipboard write failure (restricted context)
      // doesn't block the confirm; the user can copy manually.
      if (sideEffect === 'clipboard' && typeof navigator !== 'undefined') {
        try {
          await navigator.clipboard.writeText(content);
        } catch {
          /* ignore */
        }
      }

      const res = await fetch('/api/copilot/draft-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftId,
          kind,
          content,
          wasEdited,
          sideEffect,
          ...(sideEffect === 'followup-create'
            ? { patientId, noteId }
            : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { code?: string; message?: string } }
          | null;
        setErrorMsg(body?.error?.message ?? body?.error?.code ?? `confirm failed (${res.status})`);
        setState('error');
        return;
      }
      setState('confirmed');
    });
  }

  function discardDraft() {
    if (isTerminal || pending) return;
    setErrorMsg(null);
    startTransition(async () => {
      const res = await fetch('/api/copilot/draft-discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId, kind }),
      });
      if (!res.ok) {
        setErrorMsg(`discard failed (${res.status})`);
        setState('error');
        return;
      }
      setState('discarded');
    });
  }

  const KindIcon =
    kind === 'patient-message'
      ? MessageSquare
      : kind === 'followup-cadence'
        ? Calendar
        : FileText;
  const kindLabel =
    kind === 'patient-message'
      ? 'Patient message'
      : kind === 'followup-cadence'
        ? 'Follow-up cadence'
        : 'Referral letter';

  return (
    <div
      className={
        'mt-2 rounded-lg border border-border bg-card p-3 space-y-2 text-sm ' +
        (isTerminal ? 'opacity-70' : '')
      }
    >
      <div className="flex items-center gap-2">
        <KindIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="font-medium">{kindLabel}</span>
        <StatusBadge variant="info" noIcon className="text-[10px]">
          Draft
        </StatusBadge>
        {state === 'confirmed' && (
          <StatusBadge variant="success" noIcon className="text-[10px]">
            Confirmed
          </StatusBadge>
        )}
        {state === 'discarded' && (
          <StatusBadge variant="neutral" noIcon className="text-[10px]">
            Discarded
          </StatusBadge>
        )}
        {wasEdited && !isTerminal && (
          <StatusBadge variant="warning" noIcon className="text-[10px]">
            Edited
          </StatusBadge>
        )}
      </div>

      <Textarea
        value={content}
        onChange={(e) => {
          if (isTerminal) return;
          setContent(e.target.value);
          if (!wasEdited) setWasEdited(true);
        }}
        rows={kind === 'followup-cadence' ? 2 : 6}
        maxLength={10_000}
        disabled={isTerminal || pending}
        className="font-mono text-xs"
      />

      <DraftMeta kind={kind} meta={meta} />

      {errorMsg && (
        <p className="text-xs text-[var(--status-danger-fg)]">⚠ {errorMsg}</p>
      )}

      {!isTerminal && (
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={discardDraft}
            disabled={pending}
            className="gap-1"
          >
            <Trash2 className="h-3 w-3" aria-hidden />
            Discard
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={confirmDraft}
            disabled={pending || content.trim().length === 0}
            className="gap-1"
          >
            {sideEffect === 'clipboard' ? (
              <ClipboardCopy className="h-3 w-3" aria-hidden />
            ) : (
              <Check className="h-3 w-3" aria-hidden />
            )}
            {pending
              ? 'Saving…'
              : sideEffect === 'clipboard'
                ? 'Copy + confirm'
                : 'Create follow-up'}
          </Button>
        </div>
      )}

      {state === 'confirmed' && (
        <p className="text-[11px] text-muted-foreground italic flex items-center gap-1">
          <Check className="h-3 w-3" aria-hidden />
          {sideEffect === 'clipboard'
            ? 'Copied to clipboard. Audit recorded.'
            : 'Follow-up created. Audit recorded.'}
        </p>
      )}
      {state === 'discarded' && (
        <p className="text-[11px] text-muted-foreground italic flex items-center gap-1">
          <X className="h-3 w-3" aria-hidden />
          Discarded. Audit recorded.
        </p>
      )}
    </div>
  );
}

function DraftMeta({ kind, meta }: { kind: DraftKind; meta: Record<string, unknown> }) {
  if (kind === 'patient-message') {
    const topic = typeof meta.topic === 'string' ? meta.topic : null;
    const tone = typeof meta.tone === 'string' ? meta.tone : null;
    if (!topic && !tone) return null;
    return (
      <p className="text-[11px] text-muted-foreground">
        {topic && <span>Topic: {topic}</span>}
        {topic && tone && <span> · </span>}
        {tone && <span>Tone: {tone}</span>}
      </p>
    );
  }
  if (kind === 'followup-cadence') {
    const basis = typeof meta.basis === 'string' ? meta.basis : null;
    const intervals = Array.isArray(meta.suggestedIntervals)
      ? (meta.suggestedIntervals as Array<{ label?: string; days?: number }>)
      : [];
    return (
      <div className="text-[11px] text-muted-foreground space-y-0.5">
        {basis && <p>Basis: {basis}</p>}
        {intervals.length > 0 && (
          <p>
            Suggested:{' '}
            {intervals
              .map((i) => (i.label && typeof i.days === 'number' ? `${i.label} in ${i.days}d` : null))
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </div>
    );
  }
  // referral-letter
  const specialty = typeof meta.specialty === 'string' ? meta.specialty : null;
  const reason = typeof meta.reason === 'string' ? meta.reason : null;
  const receiver =
    typeof meta.recommendedReceiver === 'string' ? meta.recommendedReceiver : null;
  if (!specialty && !reason && !receiver) return null;
  return (
    <p className="text-[11px] text-muted-foreground">
      {specialty && <span>To: {specialty}</span>}
      {specialty && reason && <span> · </span>}
      {reason && <span>Reason: {reason}</span>}
      {receiver && <span> · Receiver: {receiver}</span>}
    </p>
  );
}
