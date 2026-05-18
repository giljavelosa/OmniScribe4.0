'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const DIVISIONS = ['', 'MEDICAL', 'REHAB', 'BEHAVIORAL_HEALTH', 'MULTI'] as const;

export function PatientsSearchForm({
  initialQuery,
  initialDivision,
}: {
  initialQuery: string;
  initialDivision: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [division, setDivision] = useState(initialDivision);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(() => {
      const u = new URLSearchParams();
      if (query.trim()) u.set('query', query.trim());
      if (division) u.set('division', division);
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
      <div className="space-y-1">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">Division</label>
        <Select value={division} onValueChange={(v) => setDivision(v === '__all' ? '' : v)} disabled={pending}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All</SelectItem>
            {DIVISIONS.filter(Boolean).map((d) => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={pending}>{pending ? 'Searching…' : 'Search'}</Button>
    </form>
  );
}
