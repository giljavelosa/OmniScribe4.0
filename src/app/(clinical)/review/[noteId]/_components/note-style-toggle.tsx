'use client';

import { useState, useTransition } from 'react';
import { AlignLeft, List } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBanner } from '@/components/ui/status-banner';
import { cn } from '@/lib/cn';

type Preset = 'concise' | 'verbose';

function styleToPreset(noteStyle: string): Preset {
  // STRUCTURED -> concise. Everything else (NARRATIVE / HYBRID / HYBRID_BULLET)
  // is presented as "verbose" since the existing default is HYBRID-leaning prose.
  return noteStyle === 'STRUCTURED' ? 'concise' : 'verbose';
}

type Props = {
  noteId: string;
  noteStyle: string;
  /** Hide entire toggle once SIGNED — note is immutable per rule 3. */
  isSigned?: boolean;
};

export function NoteStyleToggle({ noteId, noteStyle, isSigned }: Props) {
  const [current, setCurrent] = useState<Preset>(styleToPreset(noteStyle));
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  if (isSigned) return null;

  function setPreset(preset: Preset) {
    if (preset === current) return;
    setMessage(null);
    startTransition(async () => {
      const res = await fetch(`/api/notes/${noteId}/restyle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setMessage(body?.error?.message ?? `Restyle failed (${res.status}).`);
        return;
      }
      setCurrent(preset);
      setMessage(`Regenerating in ${preset === 'concise' ? 'STRUCTURED (concise)' : 'NARRATIVE (verbose)'} style — sections will refresh as they complete.`);
    });
  }

  return (
    <Card>
      <CardContent className="py-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Note format</span>
            <span className="text-xs text-muted-foreground">Switching regenerates all sections.</span>
          </div>
          <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
            <Button
              type="button"
              size="sm"
              variant={current === 'concise' ? 'default' : 'ghost'}
              disabled={pending}
              onClick={() => setPreset('concise')}
              className={cn('h-7 px-2 text-xs', pending && 'animate-pulse')}
            >
              <List className="size-3" aria-hidden="true" />
              Concise
            </Button>
            <Button
              type="button"
              size="sm"
              variant={current === 'verbose' ? 'default' : 'ghost'}
              disabled={pending}
              onClick={() => setPreset('verbose')}
              className={cn('h-7 px-2 text-xs', pending && 'animate-pulse')}
            >
              <AlignLeft className="size-3" aria-hidden="true" />
              Verbose
            </Button>
          </div>
        </div>
        {message && <StatusBanner variant="info">{message}</StatusBanner>}
      </CardContent>
    </Card>
  );
}
