'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Clock, Eye, EyeOff } from 'lucide-react';

import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';

type Transaction = {
  id: string;
  occurredAt: string;
  source: 'audit' | 'platform-audit';
  action: string;
  actingUserId: string | null;
  actingUserEmail: string | null;
  onBehalfOfUserId: string | null;
  onBehalfOfUserEmail: string | null;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
};

function relativeTime(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  const seconds = Math.max(1, Math.floor((now - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function actionTone(action: string): 'info' | 'success' | 'warning' | 'danger' | 'neutral' {
  if (action.startsWith('IMPERSONATION_BLOCKED')) return 'danger';
  if (action.startsWith('IMPERSONATION_')) return 'warning';
  if (action === 'USER_DEACTIVATED' || action.endsWith('_DELETED')) return 'danger';
  if (action.endsWith('_CREATED') || action.endsWith('_CONSUMED')) return 'success';
  if (action.startsWith('ORG_BAA_') || action.startsWith('PLATFORM_BAA_')) return 'info';
  if (action.startsWith('ORG_SUBSCRIPTION_')) return 'info';
  return 'neutral';
}

/**
 * TransactionsTimeline — Unit 32 owner console.
 *
 * Fetches /api/owner/orgs/[id]/transactions and renders the curated
 * org-level event feed. Each row shows the action chip + actor email +
 * relative time + an expandable metadata panel.
 *
 * Hidden by default; click "Show metadata" to expand the per-row JSON
 * for forensic inspection. Default collapsed because the metadata is
 * mostly useful to debug-track a specific event.
 */
export function TransactionsTimeline({ orgId }: { orgId: string }) {
  const [data, setData] = useState<Transaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/owner/orgs/${orgId}/transactions`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          if (!cancelled) setError(`Transactions load failed (${res.status})`);
          return;
        }
        const body = (await res.json()) as {
          data: { transactions: Transaction[]; capReached: boolean };
        };
        if (!cancelled) {
          setData(body.data.transactions);
          setNowMs(Date.now());
        }
      } catch {
        if (!cancelled) setError('Transactions load failed.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return <p className="text-xs text-muted-foreground italic">Loading timeline…</p>;
  }
  if (error) {
    return <StatusBanner variant="danger">{error}</StatusBanner>;
  }
  if (!data || data.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No governance events for this org yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {data.map((t) => {
        const isOpen = expanded.has(t.id);
        const tone = actionTone(t.action);
        return (
          <div key={t.id} className="rounded-md border border-border p-2 text-sm space-y-1">
            <div className="flex items-start gap-2 flex-wrap">
              <StatusBadge variant={tone} noIcon className="text-[10px]">
                {t.action}
              </StatusBadge>
              {t.source === 'platform-audit' && (
                <StatusBadge variant="neutral" noIcon className="text-[10px]">
                  platform
                </StatusBadge>
              )}
              <span className="text-muted-foreground text-xs flex items-center gap-1">
                <Clock className="h-3 w-3" aria-hidden />
                {relativeTime(t.occurredAt, nowMs)}
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs text-foreground/80">
              <span>{t.actingUserEmail ?? t.actingUserId ?? 'system'}</span>
              {t.onBehalfOfUserId && t.onBehalfOfUserId !== t.actingUserId && (
                <>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden />
                  <span className="text-muted-foreground">
                    {t.onBehalfOfUserEmail ?? t.onBehalfOfUserId}
                  </span>
                </>
              )}
            </div>
            {t.metadata && Object.keys(t.metadata).length > 0 && (
              <button
                type="button"
                onClick={() => toggle(t.id)}
                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground hover:underline"
              >
                {isOpen ? (
                  <EyeOff className="h-2.5 w-2.5" aria-hidden />
                ) : (
                  <Eye className="h-2.5 w-2.5" aria-hidden />
                )}
                {isOpen ? 'Hide' : 'Show'} metadata
              </button>
            )}
            {isOpen && t.metadata && (
              <pre className="bg-muted rounded p-2 text-[10px] text-foreground/80 overflow-x-auto">
                {JSON.stringify(t.metadata, null, 2)}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
