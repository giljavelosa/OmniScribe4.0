'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { ChevronDown, RotateCw, Loader2, AlertCircle, Check, Pencil, Circle } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { SectionRegenerateConfirmDialog } from './section-regenerate-confirm-dialog';

type Status = 'empty' | 'generating' | 'populated' | 'edited' | 'failed';

type Props = {
  noteId: string;
  sectionId: string;
  label: string;
  isRequired: boolean;
  initialContent: string;
  initialStatus: Status;
  /** Disable editing + regenerate (e.g. SIGNED note). */
  readOnly?: boolean;
  onLocalEdit?: () => void;
};

/**
 * Single section accordion. Owns:
 *   - expand/collapse state
 *   - debounced auto-save (1s after last keystroke) → PATCH /sections/[id]
 *   - regenerate button → POST /regenerate-section (with confirm dialog if
 *     the section was already 'edited')
 *   - section status badge driven by SSE updates from the parent
 *
 * Section content shown via Textarea — TipTap rich editor lands in Unit 14
 * (review screen polish); textarea is a deliberate scope cut for Unit 05.
 */
export function SectionAccordion({
  noteId,
  sectionId,
  label,
  isRequired,
  initialContent,
  initialStatus,
  readOnly,
  onLocalEdit,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  const [content, setContent] = useState(initialContent);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRegenOpen, setConfirmRegenOpen] = useState(false);
  const [regenPending, startRegen] = useTransition();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasUserEditedRef = useRef(false);

  // Status is fully prop-driven. After a local regenerate the SSE round-trip
  // (~2s) flips the parent's initialStatus to 'generating' → 'populated';
  // no local mirror needed. Keeps the React 19 set-state-in-effect rule happy.
  const status: Status = initialStatus;

  // Sync content from external updates (SSE-driven regeneration completed +
  // parent rehydrated initialContent). Only overwrite if the user hasn't
  // typed since the last sync.
  useEffect(() => {
    if (hasUserEditedRef.current) return;
    setContent(initialContent);
  }, [initialContent]);

  function onContentChange(next: string) {
    setContent(next);
    hasUserEditedRef.current = true;
    setError(null);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => doSave(next), 1000);
  }

  async function doSave(latest: string) {
    if (readOnly) return;
    try {
      const res = await fetch(`/api/notes/${noteId}/sections/${sectionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: latest }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.code ?? `save failed (${res.status})`);
        return;
      }
      setSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      onLocalEdit?.();
      hasUserEditedRef.current = false;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function regenerate(overwriteEdited: boolean) {
    startRegen(async () => {
      setError(null);
      const res = await fetch(`/api/notes/${noteId}/regenerate-section`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionId, overwriteEdited }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const code = body?.error?.code as string | undefined;
        if (code === 'overwrite_requires_confirm') {
          setConfirmRegenOpen(true);
          return;
        }
        setError(code ?? `regenerate failed (${res.status})`);
        return;
      }
      // SSE delivers the 'generating' → 'populated' transition (~2s round
      // trip from worker → DB → SSE poll). No local override needed.
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <header
        className="flex items-center justify-between px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded((x) => !x)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <StatusGlyph status={status} />
          <p className="font-medium text-md truncate">
            {label}
            {isRequired && <span className="text-[var(--status-danger-fg)] ml-1">*</span>}
          </p>
          {savedAt && <span className="text-xs text-muted-foreground">saved {savedAt}</span>}
        </div>
        <ChevronDown
          className={cn('h-4 w-4 text-muted-foreground transition-transform', expanded && 'rotate-180')}
          aria-hidden
        />
      </header>
      {expanded && (
        <div className="border-t border-border p-4 space-y-3">
          {status === 'generating' ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Generating…
            </div>
          ) : (
            <Textarea
              rows={Math.max(4, Math.min(20, content.split('\n').length + 2))}
              value={content}
              onChange={(e) => onContentChange(e.target.value)}
              placeholder={status === 'failed' ? '(generation failed — write manually or retry)' : 'Section content…'}
              disabled={readOnly}
              className="font-mono text-sm"
            />
          )}
          {error && (
            <p className="text-xs text-[var(--status-danger-fg)]">⚠ {error}</p>
          )}
          {!readOnly && (
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={regenPending || status === 'generating'}
                onClick={() => regenerate(false)}
                className="gap-1"
              >
                <RotateCw className="h-3 w-3" aria-hidden />
                {status === 'failed' ? 'Retry generate' : 'Regenerate'}
              </Button>
            </div>
          )}
        </div>
      )}
      <SectionRegenerateConfirmDialog
        open={confirmRegenOpen}
        sectionLabel={label}
        onOpenChange={setConfirmRegenOpen}
        onConfirm={() => {
          setConfirmRegenOpen(false);
          regenerate(true);
        }}
      />
    </div>
  );
}

function StatusGlyph({ status }: { status: Status }) {
  const Icon = status === 'populated'
    ? Check
    : status === 'edited'
      ? Pencil
      : status === 'failed'
        ? AlertCircle
        : status === 'generating'
          ? Loader2
          : Circle;
  const color =
    status === 'populated'
      ? 'text-[var(--status-success-fg)]'
      : status === 'edited'
        ? 'text-[var(--status-warning-fg)]'
        : status === 'failed'
          ? 'text-[var(--status-danger-fg)]'
          : status === 'generating'
            ? 'text-[var(--status-info-fg)] animate-spin'
            : 'text-muted-foreground/40';
  return <Icon className={cn('h-4 w-4', color)} aria-hidden />;
}
