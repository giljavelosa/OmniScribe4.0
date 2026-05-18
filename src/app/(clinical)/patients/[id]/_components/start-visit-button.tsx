'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function StartVisitButton({ patientId }: { patientId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function start() {
    startTransition(async () => {
      const res = await fetch('/api/encounters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId }),
      });
      if (!res.ok) return;
      const body = await res.json();
      // /prepare/[noteId] is a placeholder in Unit 02; Unit 03 builds it.
      if (body?.data?.noteId) router.push(`/prepare/${body.data.noteId}`);
    });
  }

  return (
    <Button onClick={start} disabled={pending}>
      {pending ? 'Starting…' : 'Start visit (ad-hoc)'}
    </Button>
  );
}
