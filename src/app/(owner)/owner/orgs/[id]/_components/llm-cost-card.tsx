'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, DollarSign, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { StatusBanner } from '@/components/ui/status-banner';

type DailyCost = {
  day: string;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  callCount: number;
};

type PerModelCost = {
  model: string;
  totalCostUsd: number;
  callCount: number;
};

type LlmCostResponse = {
  windowDays: number;
  rollup: DailyCost[];
  perModel: PerModelCost[];
  totalCostUsd: number;
  notesSigned: number;
  costPerSignedNote: number | null;
  currentMonthSpend: number;
  monthlyBudgetUsd: number | null;
  isOverBudget: boolean;
};

/**
 * LlmCostCard — Unit 35.
 *
 * Owner-only. Fetches /llm-cost?days=30 + renders:
 *   - 30-day bar chart of cost
 *   - Per-model breakdown list
 *   - Cost-per-signed-note KPI
 *   - Current-month spend + budget input + over-budget warning
 *
 * Budget input writes via PATCH /llm-budget; audit row carries
 * before/after via singleFieldChange.
 */
export function LlmCostCard({
  orgId,
  initial,
}: {
  orgId: string;
  initial: { monthlyBudgetUsd: number | null };
}) {
  const router = useRouter();
  const [data, setData] = useState<LlmCostResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [budgetInput, setBudgetInput] = useState<string>(
    initial.monthlyBudgetUsd != null ? String(initial.monthlyBudgetUsd) : '',
  );
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/owner/orgs/${orgId}/llm-cost?days=30`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          if (!cancelled) setError(`LLM cost load failed (${res.status})`);
          return;
        }
        const body = (await res.json()) as { data: LlmCostResponse };
        if (!cancelled) setData(body.data);
      } catch {
        if (!cancelled) setError('LLM cost load failed.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  function saveBudget(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = budgetInput.trim();
    const parsed =
      trimmed === '' ? null : Number.parseFloat(trimmed);
    if (parsed != null && (Number.isNaN(parsed) || parsed < 0)) {
      setError('Budget must be a non-negative number, or blank to clear.');
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/owner/orgs/${orgId}/llm-budget`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthlyLlmBudgetUsd: parsed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { code?: string } }
          | null;
        setError(body?.error?.code ?? `Save failed (${res.status})`);
        return;
      }
      setSavedAt(new Date().toLocaleTimeString());
      router.refresh();
      // Refetch the rollup so the over-budget badge re-evaluates.
      const res2 = await fetch(`/api/owner/orgs/${orgId}/llm-cost?days=30`, {
        cache: 'no-store',
      });
      if (res2.ok) {
        const body2 = (await res2.json()) as { data: LlmCostResponse };
        setData(body2.data);
      }
    });
  }

  if (loading && !data) {
    return <p className="text-xs text-muted-foreground italic">Loading LLM cost…</p>;
  }
  if (error && !data) {
    return <StatusBanner variant="danger">{error}</StatusBanner>;
  }
  if (!data) return null;

  const maxDailyCost = Math.max(...data.rollup.map((d) => d.totalCostUsd), 0.001);

  return (
    <div className="space-y-4">
      {/* KPI tiles row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Tile
          Icon={DollarSign}
          label="30-day total"
          value={`$${data.totalCostUsd.toFixed(2)}`}
        />
        <Tile
          Icon={Sparkles}
          label="Cost per signed note"
          value={
            data.costPerSignedNote != null
              ? `$${data.costPerSignedNote.toFixed(4)}`
              : 'n/a'
          }
          hint={`${data.notesSigned} signed`}
        />
        <Tile
          Icon={DollarSign}
          label="Current month"
          value={`$${data.currentMonthSpend.toFixed(2)}`}
          hint={
            data.monthlyBudgetUsd != null
              ? `of $${data.monthlyBudgetUsd.toFixed(2)} budget`
              : 'no budget set'
          }
          alert={data.isOverBudget}
        />
      </div>

      {/* Over-budget warning banner */}
      {data.isOverBudget && (
        <StatusBanner variant="danger">
          <AlertTriangle className="h-4 w-4 inline mr-1" aria-hidden />
          Over monthly budget. ${data.currentMonthSpend.toFixed(2)} spent against
          ${data.monthlyBudgetUsd!.toFixed(2)} threshold.
        </StatusBanner>
      )}

      {/* 30-day bar chart */}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Daily cost (30 days)</p>
        <div
          className="flex items-end gap-px h-16"
          role="img"
          aria-label={`30-day LLM cost chart, total $${data.totalCostUsd.toFixed(2)}`}
        >
          {data.rollup.map((d) => {
            const heightPct =
              d.totalCostUsd > 0
                ? Math.max((d.totalCostUsd / maxDailyCost) * 100, 4)
                : 0;
            return (
              <div
                key={d.day}
                className={
                  'flex-1 min-w-[2px] rounded-t-sm ' +
                  (d.totalCostUsd > 0
                    ? 'bg-[var(--status-info-fg)]'
                    : 'bg-muted')
                }
                style={{ height: `${heightPct}%` }}
                title={`${d.day}: $${d.totalCostUsd.toFixed(4)} (${d.callCount} calls)`}
              />
            );
          })}
        </div>
        <p className="text-[10px] text-muted-foreground">
          {data.rollup[0]?.day} → {data.rollup[data.rollup.length - 1]?.day}
        </p>
      </div>

      {/* Per-model breakdown */}
      {data.perModel.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">By model (window)</p>
          <ul className="space-y-1">
            {data.perModel.map((m) => (
              <li
                key={m.model}
                className="flex items-center justify-between text-xs"
              >
                <span className="font-mono text-foreground/80 truncate pr-2">
                  {m.model}
                </span>
                <span className="font-mono text-foreground tabular-nums">
                  ${m.totalCostUsd.toFixed(4)}
                </span>
                <span className="text-muted-foreground text-[10px] pl-2">
                  {m.callCount} calls
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Budget form */}
      <form onSubmit={saveBudget} className="space-y-2 pt-2 border-t border-border">
        <Label htmlFor="llm-budget">Monthly budget (USD)</Label>
        <div className="flex items-center gap-2">
          <Input
            id="llm-budget"
            type="number"
            min={0}
            step={0.01}
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            placeholder="Leave blank for no threshold"
            disabled={pending}
            className="max-w-[200px]"
          />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Saving…' : 'Save budget'}
          </Button>
          {data.monthlyBudgetUsd == null && (
            <StatusBadge variant="neutral" noIcon className="text-[10px]">
              No threshold set
            </StatusBadge>
          )}
        </div>
        {error && <StatusBanner variant="danger">{error}</StatusBanner>}
        {savedAt && (
          <StatusBanner variant="success">Saved at {savedAt}.</StatusBanner>
        )}
      </form>
    </div>
  );
}

function Tile({
  Icon,
  label,
  value,
  hint,
  alert,
}: {
  Icon: typeof DollarSign;
  label: string;
  value: string;
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
      <div
        className={
          'text-xl font-semibold font-mono ' +
          (alert ? 'text-[var(--status-danger-fg)]' : 'text-foreground')
        }
      >
        {value}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
