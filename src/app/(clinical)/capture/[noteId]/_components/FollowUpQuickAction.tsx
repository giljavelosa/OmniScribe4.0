'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { SourcePill } from '@/components/brief/source-pill';
import { cn } from '@/lib/cn';

type FollowUp = {
  id: string;
  text: string;
  status: 'OPEN' | 'MET' | 'CARRIED' | 'DROPPED' | 'CLOSED_BY_DISCHARGE';
  source: { noteId: string; date: string };
};

type ChipState =
  | { kind: 'idle' }
  | { kind: 'met-input'; closingNoteText: string; error?: string }
  | { kind: 'drop-input'; dropReason: string; error?: string }
  | { kind: 'saving' }
  | { kind: 'saved'; newStatus: 'MET' | 'DROPPED' | 'CARRIED' }
  | { kind: 'error'; message: string };

/**
 * FollowUpQuickAction — inline chip group (Met / Drop / Carry) with optimistic
 * UI + rollback on error (UI spec §3.3 state machine). One row per open
 * follow-up; the row swaps the chip group for a status pill once saved.
 *
 * Validation rules per spec §3.4:
 *   Met → closingNoteText required (≥5 chars, ≤280)
 *   Drop → dropReason required (≥5 chars, ≤280)
 *   Carry → no input; tap immediately persists
 *
 * Rule 22: no native confirm(); destructive flows live in inline expansion
 * with Cancel + Save buttons.
 */
export function FollowUpQuickAction({
  followUp,
  onUpdated,
}: {
  followUp: FollowUp;
  onUpdated?: (newStatus: 'MET' | 'DROPPED' | 'CARRIED') => void;
}) {
  const [state, setState] = useState<ChipState>({ kind: 'idle' });
  const [pending, startTransition] = useTransition();

  function commit(payload: { status: 'MET' | 'DROPPED' | 'CARRIED'; closingNoteText?: string; dropReason?: string }) {
    setState({ kind: 'saving' });
    startTransition(async () => {
      try {
        const res = await fetch(`/api/follow-ups/${followUp.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.code ?? `http_${res.status}`);
        }
        setState({ kind: 'saved', newStatus: payload.status });
        onUpdated?.(payload.status);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown';
        setState({ kind: 'error', message });
      }
    });
  }

  if (state.kind === 'saved') {
    return (
      <FollowUpRow followUp={followUp}>
        <StatusPill status={state.newStatus} />
      </FollowUpRow>
    );
  }

  return (
    <FollowUpRow followUp={followUp}>
      {state.kind === 'met-input' && (
        <InlineInput
          label="Closing note (required, 1–2 lines)"
          placeholder="e.g., Started Apr 25, tolerating, no GI symptoms."
          value={state.closingNoteText}
          error={state.error}
          onChange={(v) => setState({ kind: 'met-input', closingNoteText: v })}
          onCancel={() => setState({ kind: 'idle' })}
          onSave={() => {
            const v = state.closingNoteText.trim();
            if (v.length < 5) {
              setState({ kind: 'met-input', closingNoteText: state.closingNoteText, error: 'Min 5 characters.' });
              return;
            }
            commit({ status: 'MET', closingNoteText: v });
          }}
          disabled={pending}
        />
      )}
      {state.kind === 'drop-input' && (
        <InlineInput
          label="Why is this being dropped? (required)"
          placeholder="e.g., Patient deferred; revisit in 3 months."
          value={state.dropReason}
          error={state.error}
          onChange={(v) => setState({ kind: 'drop-input', dropReason: v })}
          onCancel={() => setState({ kind: 'idle' })}
          onSave={() => {
            const v = state.dropReason.trim();
            if (v.length < 5) {
              setState({ kind: 'drop-input', dropReason: state.dropReason, error: 'Min 5 characters.' });
              return;
            }
            commit({ status: 'DROPPED', dropReason: v });
          }}
          disabled={pending}
        />
      )}
      {state.kind === 'idle' && (
        <ChipGroup
          onMet={() => setState({ kind: 'met-input', closingNoteText: '' })}
          onDrop={() => setState({ kind: 'drop-input', dropReason: '' })}
          onCarry={() => commit({ status: 'CARRIED' })}
        />
      )}
      {state.kind === 'saving' && (
        <p className="text-xs text-muted-foreground italic">Saving…</p>
      )}
      {state.kind === 'error' && (
        <div className="space-y-2">
          <StatusBadge variant="danger" noIcon>Couldn&apos;t save — try again. (no data lost)</StatusBadge>
          <ChipGroup
            onMet={() => setState({ kind: 'met-input', closingNoteText: '' })}
            onDrop={() => setState({ kind: 'drop-input', dropReason: '' })}
            onCarry={() => commit({ status: 'CARRIED' })}
          />
        </div>
      )}
    </FollowUpRow>
  );
}

function FollowUpRow({ followUp, children }: { followUp: FollowUp; children: React.ReactNode }) {
  return (
    <div className="space-y-2 border-l-2 border-border pl-3">
      <p className="text-sm">{followUp.text}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">from</span>
        <SourcePill noteId={followUp.source.noteId} date={followUp.source.date} />
      </div>
      {children}
    </div>
  );
}

function ChipGroup({
  onMet,
  onDrop,
  onCarry,
}: {
  onMet: () => void;
  onDrop: () => void;
  onCarry: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Chip variant="success" onClick={onMet} icon="✓" label="Met" aria-label="Mark follow-up as met" />
      <Chip variant="danger" onClick={onDrop} icon="⊘" label="Drop" aria-label="Drop follow-up" />
      <Chip variant="neutral" onClick={onCarry} icon="→" label="Carry" aria-label="Carry follow-up to next visit" />
    </div>
  );
}

function Chip({
  variant,
  icon,
  label,
  onClick,
  'aria-label': ariaLabel,
}: {
  variant: 'success' | 'danger' | 'neutral';
  icon: string;
  label: string;
  onClick: () => void;
  'aria-label': string;
}) {
  const colorClasses = {
    success: 'border-[var(--status-success-border)] text-[var(--status-success-fg)] hover:bg-[var(--status-success-bg)]',
    danger: 'border-[var(--status-danger-border)] text-[var(--status-danger-fg)] hover:bg-[var(--status-danger-bg)]',
    neutral: 'border-border text-foreground hover:bg-muted',
  }[variant];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors min-h-[36px] focus-visible:outline-2 focus-visible:outline-offset-2',
        colorClasses,
      )}
    >
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function StatusPill({ status }: { status: 'MET' | 'DROPPED' | 'CARRIED' }) {
  const cfg = {
    MET: { variant: 'success' as const, label: '✓ Met · just now' },
    DROPPED: { variant: 'danger' as const, label: '⊘ Dropped' },
    CARRIED: { variant: 'info' as const, label: '→ Carried to next visit' },
  }[status];
  return (
    <StatusBadge variant={cfg.variant} noIcon aria-live="polite">
      {cfg.label}
    </StatusBadge>
  );
}

function InlineInput({
  label,
  placeholder,
  value,
  error,
  onChange,
  onCancel,
  onSave,
  disabled,
}: {
  label: string;
  placeholder: string;
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
        placeholder={placeholder}
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
