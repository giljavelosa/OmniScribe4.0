'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function HomeSearchForm() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    startTransition(() => {
      router.push(`/patients?query=${encodeURIComponent(query.trim())}`);
    });
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <div className="flex-1 space-y-1">
        <label htmlFor="home-search" className="text-xs uppercase tracking-wide text-muted-foreground">
          Find a patient
        </label>
        <Input
          id="home-search"
          placeholder="Last name, first name, or MRN"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={pending}
        />
      </div>
      <Button type="submit" disabled={pending || !query.trim()}>
        {pending ? 'Searching…' : 'Search'}
      </Button>
    </form>
  );
}
