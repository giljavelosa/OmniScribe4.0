'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StatusBanner } from '@/components/ui/status-banner';

export function PasteTranscriptForm({ noteId, disabled }: { noteId: string; disabled?: boolean }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!text.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/notes/${noteId}/paste-transcript`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Paste failed (${res.status}).`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <Textarea
        rows={5}
        placeholder="Paste the visit transcript here…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled || pending}
      />
      {error && <StatusBanner variant="danger">{error}</StatusBanner>}
      <Button onClick={submit} disabled={disabled || pending || !text.trim()} className="w-full">
        {pending ? 'Submitting…' : 'Save transcript'}
      </Button>
    </div>
  );
}
