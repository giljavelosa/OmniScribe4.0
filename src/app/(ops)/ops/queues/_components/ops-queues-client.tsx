'use client';

import { useEffect, useState } from 'react';

import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';

type QueueDepth = {
  name: string;
  waiting: number | null;
  active: number | null;
  failed: number | null;
  completed: number | null;
  delayed: number | null;
  stub: boolean;
  detail: string | null;
};

const REFRESH_INTERVAL_MS = 30_000;

export function OpsQueuesClient() {
  const [queues, setQueues] = useState<QueueDepth[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchOnce() {
      try {
        const res = await fetch('/api/ops/queues', { cache: 'no-store' });
        if (!res.ok) {
          if (!cancelled) setError(`Queue load failed (${res.status})`);
          return;
        }
        const body = (await res.json()) as { data: { queues: QueueDepth[] } };
        if (!cancelled) {
          setQueues(body.data.queues);
          setError(null);
        }
      } catch {
        if (!cancelled) setError('Queue load failed.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchOnce();
    const interval = setInterval(fetchOnce, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (loading && !queues) {
    return <p className="text-xs text-muted-foreground italic">Loading queues…</p>;
  }

  return (
    <div className="space-y-3">
      {error && <StatusBanner variant="danger">{error}</StatusBanner>}
      {queues && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="py-2 pr-3 font-medium">Queue</th>
                <th className="py-2 px-3 font-medium text-right">Waiting</th>
                <th className="py-2 px-3 font-medium text-right">Active</th>
                <th className="py-2 px-3 font-medium text-right">Failed</th>
                <th className="py-2 px-3 font-medium text-right">Completed</th>
                <th className="py-2 px-3 font-medium text-right">Delayed</th>
                <th className="py-2 pl-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {queues.map((q) => (
                <tr key={q.name} className="border-b border-border/40">
                  <td className="py-2 pr-3 font-mono text-xs">{q.name}</td>
                  <NumberCell value={q.waiting} />
                  <NumberCell value={q.active} />
                  <NumberCell value={q.failed} alert={(q.failed ?? 0) > 0} />
                  <NumberCell value={q.completed} muted />
                  <NumberCell value={q.delayed} />
                  <td className="py-2 pl-3">
                    {q.stub ? (
                      <StatusBadge variant="danger" noIcon className="text-[10px]">
                        unreachable
                      </StatusBadge>
                    ) : (
                      <StatusBadge variant="success" noIcon className="text-[10px]">
                        ok
                      </StatusBadge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-muted-foreground italic">
            Refreshes every {REFRESH_INTERVAL_MS / 1000}s
          </p>
        </div>
      )}
    </div>
  );
}

function NumberCell({
  value,
  alert,
  muted,
}: {
  value: number | null;
  alert?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={
        'py-2 px-3 text-right font-mono text-xs tabular-nums ' +
        (alert
          ? 'text-[var(--status-danger-fg)] font-semibold'
          : muted
            ? 'text-muted-foreground'
            : 'text-foreground')
      }
    >
      {value ?? '—'}
    </td>
  );
}
