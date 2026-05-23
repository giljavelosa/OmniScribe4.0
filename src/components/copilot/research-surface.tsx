'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import {
  BookOpen,
  CornerUpRight,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Send,
  User,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/cn';
import { ReasoningChain, type ReasoningStep } from './reasoning-chain';
import { COPILOT_DISPLAY_NAME, buildGreeting } from '@/services/copilot/persona';
import type { CopilotSurface } from './copilot-shell';

/** Unit 31 — same redirect prefix as AskSurface so the clinician sees
 *  one consistent system framing across both chart + research modes. */
const REDIRECT_PREFIX = 'Pivot from this answer: ';

type SourceKind =
  | 'note'
  | 'follow-up'
  | 'goal'
  | 'patient'
  | 'fhir'
  | 'literature'
  /** Phase 1B — research-mode LLM-knowledge fallback. The synthetic
   *  pill renders yellow and is paired with a yellow "LLM knowledge"
   *  badge above the bubble (two trust signals so the clinician can't
   *  miss the framing). */
  | 'llm-intrinsic';

type Source = {
  kind: SourceKind;
  id: string;
  label: string;
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  toolCalls?: number;
  isClarification?: boolean;
  stub?: boolean;
  /** Phase 1B — true when the agent emitted answer-from-knowledge
   *  after the vetted-literature corpus came up empty. UI must show
   *  both the bubble-top badge AND the source pill. */
  isLLMKnowledge?: boolean;
  /** Unit 31 — chain-of-thought steps; rendered as a collapsible
   *  chip under the bubble. Mirrors AskSurface. */
  reasoningSteps?: ReasoningStep[];
};

/**
 * ResearchSurface — Unit 29 research-mode chat. Parallel to Unit 27's
 * AskSurface but:
 *   - POSTs to /api/copilot/research (NOT /api/copilot/ask)
 *   - Body omits patientId/noteId — research is patient-agnostic
 *   - Renders 'literature' source kind specifically: PMC ids get an
 *     external link to ncbi.nlm.nih.gov; attested entries render
 *     as text chips
 *   - Background tint distinguishes research messages from chart
 *     messages so the clinician's eye picks up the mode at a glance
 *
 * Per-tab state — closed Sheet discards. The Tabs primitive in
 * CopilotShell preserves THIS tab's state independently of the Chart
 * tab, so switching back and forth keeps both conversations alive
 * within a single Sheet-open session.
 */
export function ResearchSurface({
  clinicianName,
  surface,
  greetedRef,
}: {
  /** Unit 42 — clinician display name for the persona greeting.
   *  Optional; falls back to "Hi there" when absent. */
  clinicianName?: string | null;
  /** Unit 42 — for typing parity with AskSurface. Research mode is
   *  patient-agnostic so the value only routes greeting copy. */
  surface?: CopilotSurface;
  /** Unit 42 — session-persistent guard owned by CopilotShell. */
  greetedRef?: React.MutableRefObject<boolean>;
} = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [resetMenuOpen, setResetMenuOpen] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const localGreetedRef = useRef(false);
  const greetedRefResolved = greetedRef ?? localGreetedRef;

  // Sprint 0.14 — hydrate the persistent RESEARCH conversation on mount.
  // One thread per (org × clinician); patient-agnostic by design.
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/copilot/conversations?mode=RESEARCH')
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as {
          data: {
            conversation: { id: string } | null;
            messages: Array<{
              role: string;
              content: string;
              sources: unknown;
              toolCalls: unknown;
            }>;
          };
        };
        if (cancelled) return;
        const hydratedMessages: ChatMessage[] = body.data.messages.map((m) => ({
          role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: m.content,
          sources: Array.isArray(m.sources) ? (m.sources as Source[]) : undefined,
        }));
        setMessages(hydratedMessages);
        setConversationId(body.data.conversation?.id ?? null);
        setHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (greetedRefResolved.current) return;
    if (messages.length > 0) return;
    greetedRefResolved.current = true;
    const greeting = buildGreeting({
      clinicianName: clinicianName ?? null,
      surface: surface ?? 'review',
      mode: 'research',
    });
    // Sprint 0.14 — greeting only on truly-fresh threads (post-hydrate).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages([{ role: 'assistant', content: greeting }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const resetConversation = useCallback(async () => {
    if (!conversationId || resetPending) return;
    setResetPending(true);
    try {
      const res = await fetch(`/api/copilot/conversations/${conversationId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        setError('Could not reset the conversation.');
        return;
      }
      setMessages([]);
      setConversationId(null);
      greetedRefResolved.current = false;
      setResetMenuOpen(false);
    } finally {
      setResetPending(false);
    }
  }, [conversationId, resetPending, greetedRefResolved]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || pending) return;
      setError(null);
      const userMsg: ChatMessage = { role: 'user', content: trimmed };
      setMessages((prev) => [...prev, userMsg]);
      setDraft('');
      startTransition(async () => {
        // Sprint 0.14 — server reads research-mode history from DB.
        const res = await fetch('/api/copilot/research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: trimmed }),
        });
        if (!res.ok) {
          setError(`Research failed (${res.status}).`);
          return;
        }
        const body = (await res.json()) as {
          data: {
            answer: {
              text: string;
              sources: Source[];
              isClarification: boolean;
              isLLMKnowledge?: boolean;
            };
            toolCalls: Array<{ tool: string; rowCount: number; resultOk: boolean }>;
            reasoningSteps?: ReasoningStep[];
            stub: boolean;
            conversationId?: string;
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
            isLLMKnowledge: a.isLLMKnowledge ?? false,
            stub: body.data.stub,
            reasoningSteps: body.data.reasoningSteps ?? [],
          },
        ]);
        if (body.data.conversationId) {
          setConversationId(body.data.conversationId);
        }
        setTimeout(() => scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      });
    },
    [pending],
  );

  const hasUserMessage = messages.some((m) => m.role === 'user');

  return (
    <div className="flex h-full flex-col">
      {/* Sprint 0.14 — persistent-conversation header (research mode). */}
      {conversationId && (
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-1.5 text-[11px] text-muted-foreground">
          <span className="italic">Research conversation saved.</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setResetMenuOpen(true)}
            disabled={resetPending}
            aria-label="Reset this conversation"
          >
            <MoreHorizontal className="size-3" aria-hidden />
            Reset
          </Button>
        </div>
      )}

      <AlertDialog open={resetMenuOpen} onOpenChange={setResetMenuOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset this research conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              Clears the literature-search thread. Doesn&apos;t affect any
              patient memory (research mode is patient-agnostic).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetPending}>Keep conversation</AlertDialogCancel>
            <AlertDialogAction
              onClick={resetConversation}
              disabled={resetPending}
              className="gap-1"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              {resetPending ? 'Resetting…' : 'Reset conversation'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((m, i) => (
          <MessageBubble
            key={i}
            message={m}
            onRedirect={(pivot) => send(pivot)}
            disabled={pending}
          />
        ))}
        {!hasUserMessage && (
          <EmptyState onPick={(q) => send(q)} disabled={pending} />
        )}
        {pending && (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5 mt-1" aria-hidden />
            <Loader2 className="h-3.5 w-3.5 mt-1 animate-spin" aria-hidden />
            <span>Searching the literature…</span>
          </div>
        )}
        {error && <StatusBanner variant="danger">{error}</StatusBanner>}
        <div ref={scrollAnchorRef} />
      </div>

      <div className="border-t border-border px-4 py-3 space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about evidence in the literature (e.g. 'recent evidence on NSAIDs in CKD')"
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
            Research mode — patient-agnostic; cites literature only
          </p>
          <Button
            type="button"
            size="sm"
            onClick={() => send(draft)}
            disabled={pending || draft.trim().length === 0}
            className="gap-1"
          >
            <Send className="h-3 w-3" aria-hidden />
            Search
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onRedirect,
  disabled,
}: {
  message: ChatMessage;
  /** Unit 31 — same contract as AskSurface: pivot becomes the next
   *  user message via the surface's send() so audit pipeline doesn't fork. */
  onRedirect: (pivot: string) => void;
  disabled: boolean;
}) {
  const isUser = message.role === 'user';
  const [redirectDraft, setRedirectDraft] = useState<string | null>(null);
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
    if (text.trim() === REDIRECT_PREFIX.trim()) return;
    onRedirect(text);
    setRedirectDraft(null);
  }

  return (
    <div className={cn('flex flex-col gap-2', isUser ? 'items-end' : 'items-start')}>
      <div className={cn('flex gap-2', isUser ? 'justify-end' : 'justify-start')}>
        {!isUser && (
          <BookOpen
            className="h-3.5 w-3.5 mt-2 text-[var(--status-warning-fg)] shrink-0"
            aria-hidden
          />
        )}
        <div
          className={cn(
            'rounded-lg px-3 py-2 max-w-[80%] text-sm',
            isUser
              ? 'bg-[var(--status-info-bg)] text-foreground'
              : // Research-tier background distinguishes evidence from chart data.
                'bg-[var(--status-warning-bg)] text-foreground',
          )}
        >
          {/* Phase 1B — first of two trust signals (the other is the
              llm-intrinsic source pill in the sources row). Renders
              ABOVE the bubble text so the framing is the first thing
              the clinician reads. */}
          {!isUser && message.isLLMKnowledge && (
            <div className="mb-1">
              <StatusBadge variant="warning" noIcon>
                LLM knowledge
              </StatusBadge>
            </div>
          )}
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
              Searched {message.toolCalls} corpus query{message.toolCalls === 1 ? '' : 's'}.
            </p>
          )}
          {message.sources && message.sources.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {message.sources.map((s, i) => (
                <SourceChip key={`${s.kind}-${s.id}-${i}`} source={s} />
              ))}
            </div>
          )}
          {!isUser && message.reasoningSteps && message.reasoningSteps.length > 0 && (
            <ReasoningChain steps={message.reasoningSteps} />
          )}
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
              disabled={disabled || redirectDraft.trim() === REDIRECT_PREFIX.trim()}
              className="gap-1"
            >
              <Send className="h-3 w-3" aria-hidden />
              Send pivot
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SourceChip({ source }: { source: Source }) {
  if (source.kind === 'literature' && source.id.startsWith('PMC')) {
    return (
      <a
        href={`https://www.ncbi.nlm.nih.gov/pmc/articles/${source.id}/`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground hover:underline"
      >
        <ExternalLink className="h-2.5 w-2.5" aria-hidden />
        <span>{source.label}</span>
      </a>
    );
  }
  // Phase 1B — yellow tint matches the bubble-top "LLM knowledge"
  // badge; the duplication is intentional so the clinician sees the
  // trust framing twice.
  if (source.kind === 'llm-intrinsic') {
    return (
      <StatusBadge variant="warning" noIcon>
        {source.label}
      </StatusBadge>
    );
  }
  return <StatusBadge variant="neutral" noIcon>{source.label}</StatusBadge>;
}

function EmptyState({ onPick, disabled }: { onPick: (q: string) => void; disabled: boolean }) {
  // Unit 42 — the persona greeting bubble carries the intro; the
  // empty-state below the bubble keeps the example chips. One-line
  // persona intro above the chips per the spec.
  const examples = [
    'Recent evidence on NSAIDs in chronic kidney disease',
    'USPSTF guidelines for colorectal cancer screening',
    'Trials comparing GLP-1 agonists for weight loss',
  ];
  return (
    <div className="space-y-3 py-2">
      <p className="text-xs text-muted-foreground italic">
        Try asking {COPILOT_DISPLAY_NAME}:
      </p>
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
