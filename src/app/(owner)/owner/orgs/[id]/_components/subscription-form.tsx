'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { StatusBanner } from '@/components/ui/status-banner';

/** Mirrors the SubscriptionPlan enum in prisma/schema.prisma. Kept
 *  inline as a tuple so the type narrows in the Select onValueChange. */
const PLANS = ['STARTER', 'PROFESSIONAL', 'ENTERPRISE', 'CUSTOM'] as const;
type Plan = (typeof PLANS)[number];

type Props = {
  orgId: string;
  initial: {
    subscriptionPlan: Plan;
    subscriptionOverrideNotes: string | null;
  };
};

/**
 * SubscriptionForm — Unit 32 owner console.
 *
 * Plan dropdown + override notes textarea. Save → PATCH
 * /api/owner/orgs/[id]/subscription → audit row carries before/after.
 *
 * Per spec PHI fence: override notes are FREE TEXT (sales context,
 * approval reasoning, etc.) but the audit metadata records LENGTH only.
 * The UI displays the full text since the owner already has access; the
 * audit row never persists the string.
 */
export function SubscriptionForm({ orgId, initial }: Props) {
  const router = useRouter();
  const [plan, setPlan] = useState<Plan>(initial.subscriptionPlan);
  const [notes, setNotes] = useState(initial.subscriptionOverrideNotes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/owner/orgs/${orgId}/subscription`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriptionPlan: plan,
          subscriptionOverrideNotes: notes.trim() || null,
        }),
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
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-2">
        <Label>Subscription plan</Label>
        <Select
          value={plan}
          onValueChange={(v) => setPlan(v as Plan)}
          disabled={pending}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLANS.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground italic">
          Pricing source-of-truth stays in Stripe; this tier is for at-a-glance
          owner triage.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="sub-notes">Override notes</Label>
        <Textarea
          id="sub-notes"
          rows={3}
          maxLength={500}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={pending}
          placeholder="e.g. $2k/mo discount approved by sales 2026-Q3"
        />
        <p className="text-[11px] text-muted-foreground">
          {notes.length}/500 · audit row records length only.
        </p>
      </div>
      {error && <StatusBanner variant="danger">{error}</StatusBanner>}
      {savedAt && <StatusBanner variant="success">Saved at {savedAt}.</StatusBanner>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save subscription'}
      </Button>
    </form>
  );
}
