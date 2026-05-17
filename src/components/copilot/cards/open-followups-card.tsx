'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { SourcePill } from '@/components/brief/source-pill';
import type { CopilotSurface } from '../copilot-shell';

export type CopilotFollowUp = {
  id: string;
  text: string;
  status: 'OPEN' | 'MET' | 'CARRIED' | 'DROPPED' | 'CLOSED_BY_DISCHARGE';
  source: { noteId: string; date: string };
};

/**
 * OpenFollowUpsCard — Watch v0 card listing open follow-ups for the patient.
 *
 * Rule 20 surface: rows derive from `FollowUp` table, which is only
 * populated by the note-brief worker from SIGNED notes' Plan sections
 * (Unit 06). No render path reads draft data.
 *
 * Rule 23 surface: every fact carries a SourcePill; cards never surface a
 * clinical recommendation. The Met / Drop / Carry actions hit
 * PATCH /api/follow-ups/[id] (Unit 06 endpoint) — no separate close
 * endpoint, no separate audit path.
 *
 * Audit: fires COPILOT_CARD_RENDERED once on mount via the shared
 * client-side ingress. Best-effort — a flaky audit POST never blocks
 * render.
 */
export function OpenFollowUpsCard({
  followUps: initialFollowUps,
  surface,
  noteId,
}: {
  followUps: CopilotFollowUp[];
  surface: CopilotSurface;
  noteId: string;
}) {
  const [followUps, setFollowUps] = useState(initialFollowUps);
  const auditedRef = useRef(false);

  useEffect(() => {
    if (auditedRef.current) return;
    auditedRef.current = true;
    void fetch('/api/audit/copilot-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'COPILOT_CARD_RENDERED',
        surface,
        noteId,
        cardType: 'open-followups',
        itemCount: initialFollowUps.length,
      }),
    }).catch(() => {});
  }, [surface, noteId, initialFollowUps.length]);

  function handleClosed(id: string, finalStatus: 'MET' | 'DROPPED' | 'CARRIED') {
    if (finalStatus === 'CARRIED') {
      // Carried stays alive — surface it as carried but keep visible.
      setFollowUps((curr) =>
        curr.map((fu) => (fu.id === id ? { ...fu, status: 'CARRIED' } : fu)),
      );
    } else {
      setFollowUps((curr) => curr.filter((fu) => fu.id !== id));
    }
  }

  if (followUps.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-md">Open follow-ups</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No open follow-ups from the last visit.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-md">Open follow-ups from last visit</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {followUps.map((fu) => (
          <FollowUpRow key={fu.id} item={fu} onClosed={handleClosed} />
        ))}
      </CardContent>
    </Card>
  );
}

type RowMode =
  | { kind: 'idle' }
  | { kind: 'met-input'; text: string; error?: string }
  | { kind: 'drop-input'; text: string; error?: string }
  | { kind: 'saving' }
  | { kind: 'error'; message: string };

function FollowUpRow({
  item,
  onClosed,
}: {
  item: CopilotFollowUp;
  onClosed: (id: string, final: 'MET' | 'DROPPED' | 'CARRIED') => void;
}) {
  const [mode, setMode] = useState<RowMode>({ kind: 'idle' });
  const [pending, startTransition] = useTransition();

  const isCarried = item.status === 'CARRIED';

  function commit(payload: { status: 'MET' | 'DROPPED' | 'CARRIED'; closingNoteText?: string; dropReason?: string }) {
    setMode({ kind: 'saving' });
    startTransition(async () => {
      try {
        const res = await fetch(`/api/follow-ups/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.code ?? `http_${res.status}`);
        }
        onClosed(item.id, payload.status);
      } catch (err) {
        setMode({ kind: 'error', message: err instanceof Error ? err.message : 'unknown' });
      }
    });
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className="mt-[2px] text-muted-foreground">
          {isCarried ? '→' : '○'}
        </span>
        <p className="flex-1 text-sm">{item.text}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>from</span>
        <SourcePill noteId={item.source.noteId} date={item.source.date} />
        {isCarried && (
          <StatusBadge variant="info" noIcon className="ml-1">
            → Carried
          </StatusBadge>
        )}
      </div>

      {mode.kind === 'idle' && !isCarried && (
        <div className="flex flex-wrap gap-2">
          <ActionButton
            variant="outline"
            onClick={() => setMode({ kind: 'met-input', text: '' })}
            disabled={pending}
            icon="✓"
            label="Met"
            ariaLabel="Mark follow-up as met"
          />
          <ActionButton
            variant="outline"
            onClick={() => setMode({ kind: 'drop-input', text: '' })}
            disabled={pending}
            icon="⊘"
            label="Drop"
            ariaLabel="Drop follow-up"
          />
          <ActionButton
            variant="outline"
            onClick={() => commit({ status: 'CARRIED' })}
            disabled={pending}
            icon="→"
            label="Carry"
            ariaLabel="Carry follow-up to next visit"
          />
        </div>
      )}

      {mode.kind === 'met-input' && (
        <InlineInput
          label="Closing note (required, ≥5 chars)"
          value={mode.text}
          error={mode.error}
          onChange={(v) => setMode({ kind: 'met-input', text: v })}
          onCancel={() => setMode({ kind: 'idle' })}
          onSave={() => {
            const v = mode.text.trim();
            if (v.length < 5) {
              setMode({ kind: 'met-input', text: mode.text, error: 'Min 5 characters.' });
              return;
            }
            commit({ status: 'MET', closingNoteText: v });
          }}
          disabled={pending}
        />
      )}

      {mode.kind === 'drop-input' && (
        <InlineInput
          label="Drop reason (required, ≥5 chars)"
          value={mode.text}
          error={mode.error}
          onChange={(v) => setMode({ kind: 'drop-input', text: v })}
          onCancel={() => setMode({ kind: 'idle' })}
          onSave={() => {
            const v = mode.text.trim();
            if (v.length < 5) {
              setMode({ kind: 'drop-input', text: mode.text, error: 'Min 5 characters.' });
              return;
            }
            commit({ status: 'DROPPED', dropReason: v });
          }}
          disabled={pending}
        />
      )}

      {mode.kind === 'saving' && (
        <p className="text-xs text-muted-foreground italic">Saving…</p>
      )}

      {mode.kind === 'error' && (
        <div className="space-y-2">
          <StatusBadge variant="danger" noIcon>
            Couldn&apos;t save — try again. (no data lost)
          </StatusBadge>
          <ActionButton
            variant="outline"
            onClick={() => setMode({ kind: 'idle' })}
            disabled={pending}
            icon="↻"
            label="Retry"
            ariaLabel="Retry"
          />
        </div>
      )}
    </div>
  );
}

function ActionButton({
  variant,
  onClick,
  disabled,
  icon,
  label,
  ariaLabel,
}: {
  variant: 'outline';
  onClick: () => void;
  disabled: boolean;
  icon: string;
  label: string;
  ariaLabel: string;
}) {
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="min-h-[36px] gap-1.5"
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </Button>
  );
}

function InlineInput({
  label,
  value,
  error,
  onChange,
  onCancel,
  onSave,
  disabled,
}: {
  label: string;
  value: string;
  error?: string;
  onChange: (next: string) => void;
  onCancel: () => void;
  onSave: () => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border p-2 bg-muted/30">
      <Label className="text-xs">{label}</Label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 280))}
        rows={2}
        maxLength={280}
        disabled={disabled}
        autoFocus
      />
      {error && <p className="text-xs text-[var(--status-danger-fg)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={disabled}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={disabled}>
          Save ✓
        </Button>
      </div>
    </div>
  );
}
