'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Building2,
  FileSignature,
  Mic,
  Sparkles,
  UserCircle,
  Users,
} from 'lucide-react';

import { StatusBanner } from '@/components/ui/status-banner';

type PlatformMetrics = {
  computedAt: string;
  orgs: { total: number; activeLast30d: number };
  users: { activeLast30d: number };
  notes: {
    signedLast24h: number;
    signedLast7d: number;
    signedLast30d: number;
    interrupted: number;
  };
  workers: {
    transcriptionFailedLast24h: number;
    aiGenerationFailedLast24h: number;
  };
  errorRateLastHour: number;
};

const REFRESH_INTERVAL_MS = 30_000;

/**
 * OpsDashboardClient — Unit 33.
 *
 * Polls /api/ops/dashboard every 30 seconds (cache TTL on the backend
 * is 60 seconds so every other refresh is a cache hit). Renders 9 metric
 * tiles in a responsive grid; errors render a top banner without
 * blanking the existing data.
 */
export function OpsDashboardClient() {
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchOnce() {
      try {
        const res = await fetch('/api/ops/dashboard', { cache: 'no-store' });
        if (!res.ok) {
          if (!cancelled) setError(`Dashboard load failed (${res.status})`);
          return;
        }
        const body = (await res.json()) as { data: { metrics: PlatformMetrics } };
        if (!cancelled) {
          setMetrics(body.data.metrics);
          setError(null);
        }
      } catch {
        if (!cancelled) setError('Dashboard load failed.');
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

  if (loading && !metrics) {
    return <p className="text-xs text-muted-foreground italic">Loading dashboard…</p>;
  }

  return (
    <div className="space-y-3">
      {error && <StatusBanner variant="danger">{error}</StatusBanner>}
      {metrics && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <MetricTile
              Icon={Building2}
              label="Total orgs"
              value={metrics.orgs.total}
              hint={`${metrics.orgs.activeLast30d} active in last 30d`}
            />
            <MetricTile
              Icon={Users}
              label="Active users (30d)"
              value={metrics.users.activeLast30d}
            />
            <MetricTile
              Icon={UserCircle}
              label="Notes signed (24h)"
              value={metrics.notes.signedLast24h}
              hint={`${metrics.notes.signedLast7d} in 7d · ${metrics.notes.signedLast30d} in 30d`}
            />
            <MetricTile
              Icon={FileSignature}
              label="Notes signed (7d)"
              value={metrics.notes.signedLast7d}
            />
            <MetricTile
              Icon={FileSignature}
              label="Notes signed (30d)"
              value={metrics.notes.signedLast30d}
            />
            <MetricTile
              Icon={AlertTriangle}
              label="Interrupted notes"
              value={metrics.notes.interrupted}
              alert={metrics.notes.interrupted > 0}
            />
            <MetricTile
              Icon={Mic}
              label="Transcription failures (24h)"
              value={metrics.workers.transcriptionFailedLast24h}
              alert={metrics.workers.transcriptionFailedLast24h > 0}
            />
            <MetricTile
              Icon={Sparkles}
              label="AI generation failures (24h)"
              value={metrics.workers.aiGenerationFailedLast24h}
              alert={metrics.workers.aiGenerationFailedLast24h > 0}
            />
            <MetricTile
              Icon={Activity}
              label="Error rate (last hour)"
              value={metrics.errorRateLastHour}
              alert={metrics.errorRateLastHour > 5}
              hint="Count of *_FAILED audit rows"
            />
          </div>
          <p className="text-[11px] text-muted-foreground italic">
            Computed at {new Date(metrics.computedAt).toLocaleTimeString()} · auto-refreshes
            every {REFRESH_INTERVAL_MS / 1000}s
          </p>
        </>
      )}
    </div>
  );
}

function MetricTile({
  Icon,
  label,
  value,
  hint,
  alert,
}: {
  Icon: typeof Activity;
  label: string;
  value: number;
  hint?: string;
  alert?: boolean;
}) {
  return (
    <div
      className={
        'rounded-md border p-3 space-y-1 ' +
        (alert
          ? 'border-[var(--status-danger-fg)] bg-[var(--status-danger-bg)]'
          : 'border-border bg-card')
      }
    >
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Icon className="h-3 w-3" aria-hidden />
        <span>{label}</span>
      </div>
      <div className={'text-2xl font-semibold font-mono ' + (alert ? 'text-[var(--status-danger-fg)]' : 'text-foreground')}>
        {value}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
