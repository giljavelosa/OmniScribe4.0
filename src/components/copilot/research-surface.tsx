'use client';

import { useCallback, useRef, useState, useTransition } from 'react';
import { BookOpen, ExternalLink, Loader2, Send, User } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';
import { cn } from '@/lib/cn';

type SourceKind = 'note' | 'follow-up' | 'goal' | 'patient' | 'fhir' | 'literature';

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
export function ResearchSurface() {
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
        const history = [...messages, userMsg]
          .slice(0, -1)
          .map((m) => ({
            role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
            content: m.content,
          }));
        const res = await fetch('/api/copilot/research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: trimmed, history }),
        });
        if (!res.ok) {
          setError(`Research failed (${res.status}).`);
          return;
        }
        const body = (await res.json()) as {
          data: {
            answer: { text: string; sources: Source[]; isClarification: boolean };
            toolCalls: Array<{ tool: string; rowCount: number; resultOk: boolean }>;
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
          },
        ]);
        setTimeout(() => scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      });
    },
    [messages, pending],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <EmptyState onPick={(q) => send(q)} disabled={pending} />
        )}
        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}
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

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
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
      </div>
      {isUser && <User className="h-3.5 w-3.5 mt-2 text-muted-foreground shrink-0" aria-hidden />}
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
  return <StatusBadge variant="neutral" noIcon>{source.label}</StatusBadge>;
}

function EmptyState({ onPick, disabled }: { onPick: (q: string) => void; disabled: boolean }) {
  const examples = [
    'Recent evidence on NSAIDs in chronic kidney disease',
    'USPSTF guidelines for colorectal cancer screening',
    'Trials comparing GLP-1 agonists for weight loss',
  ];
  return (
    <div className="space-y-3 py-2">
      <p className="text-sm text-muted-foreground">
        Research mode — ask about evidence in the medical literature. Answers cite published
        sources only and are NEVER tailored to a specific patient (use the Chart tab for that).
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
