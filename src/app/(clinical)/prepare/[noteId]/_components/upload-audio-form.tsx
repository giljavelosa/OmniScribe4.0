'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBanner } from '@/components/ui/status-banner';

export function UploadAudioForm({ noteId, disabled }: { noteId: string; disabled?: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      const form = new FormData();
      form.append('audio', file);
      const res = await fetch(`/api/notes/${noteId}/upload-audio`, { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Upload failed (${res.status}).`);
        return;
      }
      // Route to /processing — the transcription worker (Unit 04) picks up
      // the upload + Soniox batch transcribes + ai-generation drafts.
      router.push(`/processing/${noteId}`);
    });
  }

  return (
    <div className="space-y-3">
      <Input
        type="file"
        accept="audio/*"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        disabled={disabled || pending}
      />
      {error && <StatusBanner variant="danger">{error}</StatusBanner>}
      <Button onClick={submit} disabled={disabled || pending || !file} className="w-full">
        {pending ? 'Uploading…' : 'Upload & transcribe'}
      </Button>
    </div>
  );
}
