'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function PatientsSearchForm({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(() => {
      const u = new URLSearchParams();
      if (query.trim()) u.set('query', query.trim());
      router.push(`/patients?${u.toString()}`);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div className="flex-1 min-w-[12rem] space-y-1">
        <label htmlFor="patient-query" className="text-xs uppercase tracking-wide text-muted-foreground">
          Search
        </label>
        <Input
          id="patient-query"
          placeholder="Last name, first name, or MRN"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={pending}
        />
      </div>
      <Button type="submit" disabled={pending}>{pending ? 'Searching…' : 'Search'}</Button>
    </form>
  );
}
