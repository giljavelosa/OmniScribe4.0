'use client';

import { useEffect, useState, useTransition } from 'react';
import { RefreshCw } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';

type Check = {
  name: string;
  ok: boolean;
  latencyMs: number | null;
  detail: string;
  stub: boolean;
};

type Summary = { okCount: number; stubCount: number; failedCount: number };

export function HealthClient() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [loading, startLoading] = useTransition();

  function load() {
    startLoading(async () => {
      const res = await fetch('/api/owner/health');
      if (!res.ok) return;
      const json = (await res.json()) as { data: { checks: Check[]; summary: Summary } };
      setChecks(json.data.checks);
      setSummary(json.data.summary);
      setLastRun(new Date());
    });
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-md">System health</CardTitle>
          <CardDescription>
            Runs in parallel with a 5s per-check timeout. Auto-refreshes every 60s. Stub-mode
            providers count as healthy (configured) but are flagged so production deploys
            don&apos;t miss the gap.
          </CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {summary && (
          <div className="flex flex-wrap gap-2">
            <StatusBadge variant="success" noIcon>{summary.okCount} healthy</StatusBadge>
            {summary.stubCount > 0 && (
              <StatusBadge variant="warning" noIcon>{summary.stubCount} stub-mode</StatusBadge>
            )}
            {summary.failedCount > 0 && (
              <StatusBadge variant="danger" noIcon>{summary.failedCount} failing</StatusBadge>
            )}
            {lastRun && (
              <span className="text-xs text-muted-foreground self-center">
                last checked {lastRun.toLocaleTimeString()}
              </span>
            )}
          </div>
        )}

        <ul className="divide-y divide-border rounded-md border border-border">
          {checks.length === 0 ? (
            <li className="p-3 text-sm text-muted-foreground">
              {loading ? 'Running checks…' : 'No results yet.'}
            </li>
          ) : (
            checks.map((c) => (
              <li key={c.name} className="p-3 flex items-start gap-3">
                <CheckIndicator ok={c.ok} stub={c.stub} />
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground break-all">{c.detail}</p>
                </div>
                {c.latencyMs !== null && (
                  <StatusBadge variant="neutral" noIcon>{c.latencyMs} ms</StatusBadge>
                )}
              </li>
            ))
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

function CheckIndicator({ ok, stub }: { ok: boolean; stub: boolean }) {
  if (!ok) {
    return <span aria-label="failing" className="text-[var(--status-danger-fg)] text-lg">✗</span>;
  }
  if (stub) {
    return <span aria-label="stub mode" className="text-[var(--status-warning-fg)] text-lg">◐</span>;
  }
  return <span aria-label="healthy" className="text-[var(--status-success-fg)] text-lg">✓</span>;
}
