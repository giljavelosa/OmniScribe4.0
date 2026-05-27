'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Props = {
  /** desktop — full panel with heading + suggestions; mobile — compact inline strip */
  variant?: 'desktop' | 'mobile';
};

const SUGGESTIONS = [
  { label: 'Find a patient', query: '' },
  { label: 'Show drafts', query: '' },
  { label: 'Start primary care note', query: '' },
  { label: 'Review unsigned notes', query: '' },
];

/**
 * AiCommandPanel — stub entry point for the OmniScribe AI copilot.
 *
 * Wave 8 (Unit 42+) will wire this to the real copilot/Miss Cleo
 * pipeline. For Sprint 0.2 it is a visible placeholder that:
 *   - Shows an input and suggestion chips
 *   - Routes simple queries to patient search (/patients?query=...)
 *   - Shows a "coming soon" note for commands it can't handle yet
 *
 * PHI rule: query text is never stored in localStorage or URL params
 * beyond the patients search — no PHI in the command input itself.
 *
 * Tier 2 telemetry (2026-05-25)
 * -----------------------------
 * Every submission posts to /api/ai-command/log so the server can
 * classify the SHAPE of the query and write a PHI-free audit row.
 * The post is fire-and-forget — its failure CANNOT block the
 * clinician's redirect. This data feeds the /admin/ai-queries
 * dashboard and informs Tier 3's command vocabulary design.
 */
export function AiCommandPanel({ variant = 'desktop' }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [pending, startTransition] = useTransition();
  const surface = variant === 'mobile' ? 'home-mobile' : 'home-desktop';

  function logQuery(q: string) {
    // Fire-and-forget. We deliberately do NOT await — telemetry must
    // never delay or block the user's navigation. Errors are
    // swallowed silently because (a) the audit failure is not
    // user-facing and (b) the caller has already moved on. If the
    // network is offline, we lose ONE row of telemetry; the
    // clinician's journey is unaffected.
    void fetch('/api/ai-command/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, surface }),
      // Use keepalive so the request still flies if the user
      // navigates immediately. Critical for a router.push that
      // tears down the page synchronously.
      keepalive: true,
    }).catch(() => {
      // Telemetry failure is intentionally silent.
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    logQuery(q);
    startTransition(() => {
      router.push(`/patients?query=${encodeURIComponent(q)}`);
    });
  }

  function applySuggestion(label: string) {
    setQuery(label);
    logQuery(label);
    startTransition(() => {
      router.push(`/patients?query=${encodeURIComponent(label)}`);
    });
  }

  if (variant === 'mobile') {
    return (
      <div className="px-4 py-3 border-t border-border">
        <form onSubmit={submit} className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
          <Input
            placeholder="Ask OmniScribe AI…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={pending}
            className="flex-1 text-sm h-9"
          />
          <Button type="submit" size="sm" disabled={pending || !query.trim()}>
            Ask
          </Button>
        </form>
        <p className="text-[10px] text-muted-foreground mt-1.5 pl-6">
          Full AI copilot arrives in a future update.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold">Ask OmniScribe AI</h2>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-2">
        <Input
          placeholder="Find patient, draft note…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={pending}
          className="text-sm"
        />
        <Button type="submit" size="sm" disabled={pending || !query.trim()} className="w-full">
          {pending ? 'Searching…' : 'Ask'}
        </Button>
      </form>

      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Suggestions</p>
        <div className="flex flex-col gap-1">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => applySuggestion(s.label)}
              disabled={pending}
              className="text-left text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-md px-2 py-1.5 transition-colors min-h-[var(--touch-min)] flex items-center"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground border-t border-border pt-3">
        Full AI copilot &amp; agentic features arrive in a future update.
      </p>
    </div>
  );
}
