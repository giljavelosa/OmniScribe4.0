'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { StatusBanner } from '@/components/ui/status-banner';

type Site = { id: string; name: string; address: string | null };

export function OnboardingSitesForm({ sites }: { sites: Site[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(sites[0] ? [sites[0].id] : []);
  const [primary, setPrimary] = useState<string | null>(sites[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(siteId: string) {
    setSelected((prev) => {
      if (prev.includes(siteId)) {
        const next = prev.filter((s) => s !== siteId);
        if (primary === siteId) setPrimary(next[0] ?? null);
        return next;
      }
      const next = [...prev, siteId];
      if (!primary) setPrimary(siteId);
      return next;
    });
  }

  function save() {
    setError(null);
    if (selected.length === 0) {
      setError('Pick at least one site.');
      return;
    }
    startTransition(async () => {
      const res = await fetch('/api/onboarding-sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteIds: selected, primarySiteId: primary }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? 'Could not save your site enrollment.');
        return;
      }
      router.push('/home');
      router.refresh();
    });
  }

  if (sites.length === 0) {
    return (
      <div className="space-y-3">
        <StatusBanner variant="warning" title="No sites set up yet">
          Your organization hasn&apos;t created any sites. Ask your admin to add
          one, then come back here.
        </StatusBanner>
        <Button onClick={() => router.push('/home')} className="w-full" variant="ghost">
          Continue without enrollment
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {sites.map((site) => {
          const checked = selected.includes(site.id);
          return (
            <div
              key={site.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
            >
              <label className="flex flex-1 items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(site.id)}
                  disabled={pending}
                  className="h-4 w-4"
                />
                <div className="text-sm">
                  <div className="font-medium">{site.name}</div>
                  {site.address && (
                    <div className="text-xs text-muted-foreground">{site.address}</div>
                  )}
                </div>
              </label>
              <label
                className={`flex items-center gap-1 text-xs ${
                  checked ? 'text-muted-foreground cursor-pointer' : 'text-muted-foreground/40'
                }`}
              >
                <input
                  type="radio"
                  name="primary"
                  checked={primary === site.id}
                  onChange={() => setPrimary(site.id)}
                  disabled={!checked || pending}
                  className="h-3 w-3"
                />
                Primary
              </label>
            </div>
          );
        })}
      </div>
      {error && <StatusBanner variant="danger">{error}</StatusBanner>}
      <Button onClick={save} disabled={pending || selected.length === 0} className="w-full">
        {pending ? 'Saving…' : 'Continue'}
      </Button>
    </div>
  );
}
