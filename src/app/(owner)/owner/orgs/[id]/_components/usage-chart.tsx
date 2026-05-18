'use client';

import { useEffect, useState } from 'react';
import { Activity, BookOpen, FileSignature, Mic } from 'lucide-react';

import { StatusBanner } from '@/components/ui/status-banner';
import { cn } from '@/lib/cn';

type DailyUsage = {
  day: string; // YYYY-MM-DD
  notesSigned: number;
  transcriptionMinutes: number;
  copilotAsks: number;
  draftsAccepted: number;
};

const METRICS = [
  { key: 'notesSigned' as const, label: 'Notes signed', Icon: FileSignature },
  { key: 'transcriptionMinutes' as const, label: 'Transcription minutes', Icon: Mic },
  { key: 'copilotAsks' as const, label: 'Copilot asks', Icon: Activity },
  { key: 'draftsAccepted' as const, label: 'Drafts accepted', Icon: BookOpen },
];

/**
 * UsageChart — Unit 32 owner console.
 *
 * Fetches /api/owner/orgs/[id]/usage and renders a small bar-chart grid
 * (one sparkline per metric). Pure CSS bars — no chart library since
 * the per-metric variance + zero-baseline use case doesn't justify
 * pulling in recharts/chart.js.
 *
 * Read-only — no audit row on this client. The owner-page GET path is
 * gated by requirePlatformOwner; the audit row would balloon
 * cardinality on a page that's polled when an owner is comparing orgs.
 */
export function UsageChart({ orgId }: { orgId: string }) {
  const [data, setData] = useState<DailyUsage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/owner/orgs/${orgId}/usage?days=30`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          if (!cancelled) setError(`Usage load failed (${res.status})`);
          return;
        }
        const body = (await res.json()) as {
          data: { rollup: DailyUsage[] };
        };
        if (!cancelled) setData(body.data.rollup);
      } catch {
        if (!cancelled) setError('Usage load failed.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (loading) {
    return (
      <p className="text-xs text-muted-foreground italic">Loading usage…</p>
    );
  }
  if (error) {
    return <StatusBanner variant="danger">{error}</StatusBanner>;
  }
  if (!data || data.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No usage data in the last 30 days.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {METRICS.map(({ key, label, Icon }) => {
        const max = Math.max(...data.map((d) => d[key]), 1);
        const total = data.reduce((sum, d) => sum + d[key], 0);
        return (
          <div key={key} className="rounded-md border border-border p-2 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Icon className="h-3 w-3" aria-hidden />
                {label}
              </span>
              <span className="font-mono text-foreground">{total}</span>
            </div>
            <div
              className="flex items-end gap-px h-12"
              role="img"
              aria-label={`${label}: 30-day chart, total ${total}`}
            >
              {data.map((d) => {
                const v = d[key];
                const heightPct = Math.max((v / max) * 100, v > 0 ? 4 : 0);
                return (
                  <div
                    key={d.day}
                    className={cn(
                      'flex-1 min-w-[2px] rounded-t-sm',
                      v > 0
                        ? 'bg-[var(--status-info-fg)]'
                        : 'bg-muted',
                    )}
                    style={{ height: `${heightPct}%` }}
                    title={`${d.day}: ${v}`}
                  />
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground">
              30-day window · {data[0]?.day} → {data[data.length - 1]?.day}
            </p>
          </div>
        );
      })}
    </div>
  );
}
