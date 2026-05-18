'use client';

import { useCallback, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { CornerUpRight, Loader2, Send, Sparkles, User, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import { cn } from '@/lib/cn';
import { DraftCard } from './draft-card';
import { ReasoningChain, type ReasoningStep } from './reasoning-chain';

/** Unit 31 — prefix the inline Redirect composer pre-fills with so the
 *  clinician sees the system's framing before typing their pivot. */
const REDIRECT_PREFIX = 'Pivot from this answer: ';

type SourceKind = 'note' | 'follow-up' | 'goal' | 'patient' | 'fhir' | 'literature';

type Source = {
  kind: SourceKind;
  id: string;
  label: string;
};

type DraftKind = 'patient-message' | 'followup-cadence' | 'referral-letter';

type Draft = {
  draftId: string;
  kind: DraftKind;
  content: string;
  meta: Record<string, unknown>;
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  /** Assistant-only: per-message source pills + tool-call count. */
  sources?: Source[];
  toolCalls?: number;
  /** Assistant-only: clarification answers (empty sources) get a
   *  distinct visual + a "this is a follow-up question" hint. */
  isClarification?: boolean;
  /** Assistant-only: stub-mode response gets a small banner. */
  stub?: boolean;
  /** Assistant-only: Unit 30 drafts to render as DraftCards beneath
   *  the bubble. Each card is self-contained (owns its own confirm/
   *  discard state). */
  drafts?: Draft[];
  /** Assistant-only: Unit 31 chain-of-thought steps. Empty when the
   *  model went straight to tools + answer. Rendered as a collapsible
   *  chip under the bubble. */
  reasoningSteps?: ReasoningStep[];
};

/**
 * AskSurface — Unit 27 / Ask mode v1 chat UI inside CopilotShell's Sheet.
 *
 * Per-session in-memory state (closed Sheet → discarded; spec defers
 * persistence to Wave 6). Sends user messages to /api/copilot/ask;
 * renders per-message source pills with kind-specific link behavior:
 *   - note → links to /review/[id]
 *   - follow-up / goal / patient → text-only chips (no destination
 *     route in v1; future polish can deep-link into a goal panel etc.)
 *
 * Empty-state UX: an introductory prompt below the header with three
 * example questions the clinician can tap to seed the composer.
 */
export function AskSurface({
  patientId,
  noteId,
}: {
  patientId: string;
  noteId: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || pending) return;
      setError(null);
      const userMsg: ChatMessage = { role: 'user', content: trimmed };
      setMessages((prev) => [...prev, userMsg]);
      setDraft('');
      startTransition(async () => {
        const history = [...messages, userMsg].map((m) => ({
          role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: m.content,
        }));
        const res = await fetch('/api/copilot/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patientId,
            noteId,
            question: trimmed,
            // Server adds the current question itself; we send PRIOR
            // turns only.
            history: history.slice(0, -1),
          }),
        });
        if (!res.ok) {
          setError(`Ask failed (${res.status}).`);
          return;
        }
        const body = (await res.json()) as {
          data: {
            answer: { text: string; sources: Source[]; isClarification: boolean };
            toolCalls: Array<{ tool: string; rowCount: number; resultOk: boolean }>;
            drafts?: Draft[];
            reasoningSteps?: ReasoningStep[];
            stub: boolean;
          };
        };
        const a = body.data.answer;
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: a.text,
            sources: a.sources,
            toolCalls: body.data.toolCalls.length,
            isClarification: a.isClarification,
            stub: body.data.stub,
            drafts: body.data.drafts,
            reasoningSteps: body.data.reasoningSteps ?? [],
          },
        ]);
        // Defer scroll so the new message is in the DOM.
        setTimeout(() => scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      });
    },
    [messages, noteId, patientId, pending],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <EmptyState onPick={(q) => send(q)} disabled={pending} />
        )}
        {messages.map((m, i) => (
          <MessageBubble
            key={i}
            message={m}
            patientId={patientId}
            noteId={noteId}
            onRedirect={(pivot) => send(pivot)}
            disabled={pending}
          />
        ))}
        {pending && (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 mt-1" aria-hidden />
            <Loader2 className="h-3.5 w-3.5 mt-1 animate-spin" aria-hidden />
            <span>Thinking…</span>
          </div>
        )}
        {error && <StatusBanner variant="danger">{error}</StatusBanner>}
        <div ref={scrollAnchorRef} />
      </div>

      <div className="border-t border-border px-4 py-3 space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about this patient (e.g. 'what was the plan from her last visit?')"
          rows={2}
          maxLength={2000}
          disabled={pending}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground italic">
            ⏎ to send · ⇧⏎ for new line · answers are source-grounded
          </p>
          <Button
            type="button"
            size="sm"
            onClick={() => send(draft)}
            disabled={pending || draft.trim().length === 0}
            className="gap-1"
          >
            <Send className="h-3 w-3" aria-hidden />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  patientId,
  noteId,
  onRedirect,
  disabled,
}: {
  message: ChatMessage;
  patientId: string;
  noteId: string;
  /** Unit 31 — Redirect button delegates back to the parent's send()
   *  so audit + history pipeline doesn't fork. The clinician's pivot
   *  enters the conversation as a normal user message. */
  onRedirect: (pivot: string) => void;
  disabled: boolean;
}) {
  const isUser = message.role === 'user';
  const [redirectDraft, setRedirectDraft] = useState<string | null>(null);
  // Hide Redirect on error messages (no assistant content), the user's
  // own messages, and clarifications (the clinician should answer
  // those directly, not pivot — clarification IS the pivot point).
  const canRedirect =
    !isUser && !message.isClarification && !message.stub && message.content.length > 0;

  function openRedirect() {
    setRedirectDraft(REDIRECT_PREFIX);
  }
  function cancelRedirect() {
    setRedirectDraft(null);
  }
  function submitRedirect() {
    const text = redirectDraft ?? '';
    const trimmed = text.trim();
    // Guard: must include the prefix AND have actual content past it.
    if (!trimmed.startsWith(REDIRECT_PREFIX.trim())) return;
    if (trimmed === REDIRECT_PREFIX.trim()) return;
    onRedirect(text);
    setRedirectDraft(null);
  }

  return (
    <div className={cn('flex flex-col gap-2', isUser ? 'items-end' : 'items-start')}>
      <div className={cn('flex gap-2', isUser ? 'justify-end' : 'justify-start')}>
        {!isUser && <Sparkles className="h-3.5 w-3.5 mt-2 text-muted-foreground shrink-0" aria-hidden />}
        <div
          className={cn(
            'rounded-lg px-3 py-2 max-w-[80%] text-sm',
            isUser
              ? 'bg-[var(--status-info-bg)] text-foreground'
              : 'bg-muted/40 text-foreground',
          )}
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
          {message.stub && (
            <p className="mt-1 text-[10px] uppercase tracking-wide text-[var(--status-warning-fg)]">
              Stub mode
            </p>
          )}
          {message.isClarification && !isUser && !message.stub && (
            <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Clarification question
            </p>
          )}
          {message.toolCalls && message.toolCalls > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground italic">
              Looked up {message.toolCalls} source{message.toolCalls === 1 ? '' : 's'}.
            </p>
          )}
          {message.sources && message.sources.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {message.sources.map((s, i) => (
                <SourceChip key={`${s.kind}-${s.id}-${i}`} source={s} />
              ))}
            </div>
          )}
          {/* Unit 31 — reasoning chain rides under sources + tool count.
              Collapsed by default; renders nothing when steps is empty. */}
          {!isUser && message.reasoningSteps && message.reasoningSteps.length > 0 && (
            <ReasoningChain steps={message.reasoningSteps} />
          )}
          {/* Unit 31 — Redirect entry point. Sits inside the bubble next
              to source pills so the affordance is discoverable but not
              loud. */}
          {canRedirect && redirectDraft === null && (
            <button
              type="button"
              onClick={openRedirect}
              disabled={disabled}
              className={cn(
                'mt-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide',
                'text-muted-foreground hover:text-foreground hover:underline',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <CornerUpRight className="h-2.5 w-2.5" aria-hidden />
              Redirect
            </button>
          )}
        </div>
        {isUser && <User className="h-3.5 w-3.5 mt-2 text-muted-foreground shrink-0" aria-hidden />}
      </div>
      {/* Unit 31 — inline composer for the Redirect pivot. Scoped to
          THIS message so multiple in-flight pivots don't collide. */}
      {!isUser && redirectDraft !== null && (
        <div className="w-full max-w-[95%] rounded-lg border border-border bg-card p-2 space-y-2">
          <p className="text-[11px] text-muted-foreground italic flex items-center gap-1">
            <CornerUpRight className="h-3 w-3" aria-hidden />
            Redirect — your pivot becomes the next message.
          </p>
          <Textarea
            value={redirectDraft}
            onChange={(e) => setRedirectDraft(e.target.value)}
            rows={2}
            maxLength={2000}
            disabled={disabled}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitRedirect();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                cancelRedirect();
              }
            }}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={cancelRedirect}
              disabled={disabled}
              className="gap-1"
            >
              <X className="h-3 w-3" aria-hidden />
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={submitRedirect}
              disabled={
                disabled ||
                !redirectDraft.trim().startsWith(REDIRECT_PREFIX.trim()) ||
                redirectDraft.trim() === REDIRECT_PREFIX.trim()
              }
              className="gap-1"
            >
              <Send className="h-3 w-3" aria-hidden />
              Send pivot
            </Button>
          </div>
        </div>
      )}
      {/* Unit 30 — drafts ride beneath the assistant bubble. Each card is
          self-contained (owns its own pending/confirmed/discarded state). */}
      {!isUser && message.drafts && message.drafts.length > 0 && (
        <div className="w-full max-w-[95%] space-y-2">
          {message.drafts.map((d) => (
            <DraftCard
              key={d.draftId}
              draftId={d.draftId}
              kind={d.kind}
              initialContent={d.content}
              meta={d.meta}
              patientId={patientId}
              noteId={noteId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceChip({ source }: { source: Source }) {
  const label = `${source.kind} · ${source.label}`;
  if (source.kind === 'note') {
    return (
      <Link
        href={`/review/${source.id}`}
        className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground hover:underline"
      >
        <span aria-hidden>↗</span>
        <span>{label}</span>
      </Link>
    );
  }
  return (
    <StatusBadge variant="neutral" noIcon>
      {label}
    </StatusBadge>
  );
}

function EmptyState({ onPick, disabled }: { onPick: (q: string) => void; disabled: boolean }) {
  const examples = [
    'What was the plan from her last visit?',
    'Are there any open follow-ups for this patient?',
    'What were her last blood pressure readings?',
  ];
  return (
    <div className="space-y-3 py-2">
      <p className="text-sm text-muted-foreground">
        Ask anything about this patient — I&apos;ll only answer from attested sources (signed
        notes, follow-ups, episode goals, demographics) and cite each fact.
      </p>
      <p className="text-xs text-muted-foreground italic">Try:</p>
      <div className="flex flex-col gap-1">
        {examples.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            disabled={disabled}
            className="text-left text-sm text-foreground/80 hover:text-foreground hover:bg-muted rounded-md px-2 py-1 border border-border"
          >
            &ldquo;{q}&rdquo;
          </button>
        ))}
      </div>
    </div>
  );
}
