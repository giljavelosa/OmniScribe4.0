'use client';

import { useEffect, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBanner } from '@/components/ui/status-banner';

type BillingState = {
  activeSeats: number;
  assignedSeats: number;
  stripeConfigured: boolean;
  stripeCustomerLinked: boolean;
};

type CatalogState = {
  soloTiers: Array<{
    id: string;
    label: string;
    monthlyPriceCents: number;
    monthlyVisitCredit: number;
  }>;
  visitBundles: Array<{ id: string; label: string; visitCount: number; priceCents: number }>;
};

type ActionResponse = { data?: { url?: string }; error?: { message?: string } };

function formatUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function BillingClient() {
  const params = useSearchParams();
  const checkout = params.get('checkout');
  const capacity = params.get('capacity');

  const [state, setState] = useState<BillingState | null>(null);
  const [catalog, setCatalog] = useState<CatalogState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startLoad] = useTransition();
  const [tier, setTier] = useState('solo-standard');
  const [bundleId, setBundleId] = useState('bundle-500');
  const [pending, startAction] = useTransition();

  function load() {
    setError(null);
    startLoad(async () => {
      const [seatsRes, catalogRes] = await Promise.all([
        fetch('/api/admin/seats'),
        fetch('/api/billing/capacity-catalog'),
      ]);
      if (!seatsRes.ok) {
        setError('Failed to load billing status.');
        return;
      }
      const seatsJson = (await seatsRes.json()) as {
        summary: { activeSeats: number; assignedSeats: number };
        stripeConfigured: boolean;
        stripeCustomerLinked: boolean;
      };
      setState({
        activeSeats: seatsJson.summary.activeSeats,
        assignedSeats: seatsJson.summary.assignedSeats,
        stripeConfigured: seatsJson.stripeConfigured,
        stripeCustomerLinked: seatsJson.stripeCustomerLinked,
      });
      if (catalogRes.ok) {
        const catJson = (await catalogRes.json()) as { data: CatalogState };
        setCatalog(catJson.data);
        if (catJson.data.soloTiers[0]) setTier(catJson.data.soloTiers[1]?.id ?? catJson.data.soloTiers[0].id);
        if (catJson.data.visitBundles[0]) setBundleId(catJson.data.visitBundles[0].id);
      }
    });
  }

  useEffect(() => {
    load();
  }, []);

  function startCapacityCheckout(purchaseType: 'monthly_tier' | 'visit_bundle', catalogItemId: string) {
    setError(null);
    startAction(async () => {
      const res = await fetch('/api/billing/checkout-capacity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchaseType, catalogItemId }),
      });
      const json = (await res.json().catch(() => null)) as ActionResponse | null;
      if (!res.ok || !json?.data?.url) {
        setError(json?.error?.message ?? `Could not start checkout (${res.status}).`);
        return;
      }
      window.location.href = json.data.url;
    });
  }

  function openPortal() {
    setError(null);
    startAction(async () => {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const json = (await res.json().catch(() => null)) as ActionResponse | null;
      if (!res.ok || !json?.data?.url) {
        setError(json?.error?.message ?? `Could not open the billing portal (${res.status}).`);
        return;
      }
      window.location.href = json.data.url;
    });
  }

  const stripeOff = !!state && !state.stripeConfigured;
  const selectedTier = catalog?.soloTiers.find((t) => t.id === tier);
  const selectedBundle = catalog?.visitBundles.find((b) => b.id === bundleId);

  return (
    <div className="space-y-3">
      {checkout === 'success' && (
        <StatusBanner variant="info">
          {capacity === 'bundle'
            ? 'Payment received — visit bundle is being added to your org bank.'
            : capacity === 'tier'
              ? 'Subscription started — monthly visits are being credited to your org bank.'
              : 'Payment received. Changes sync in a few moments.'}
        </StatusBanner>
      )}
      {checkout === 'cancelled' && (
        <StatusBanner variant="info">Checkout cancelled — no charge was made.</StatusBanner>
      )}
      {error && <StatusBanner variant="danger">{error}</StatusBanner>}
      {stripeOff && (
        <StatusBanner variant="danger">
          Stripe is not configured — set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to enable
          purchases.
        </StatusBanner>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Visit bank — monthly plan</CardTitle>
          <CardDescription>
            Subscribe to a solo tier. Each month, visits are credited to your org bank (shared
            pool).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {catalog ? (
            <>
              <div className="space-y-1.5">
                <Label>Plan tier</Label>
                <Select value={tier} onValueChange={setTier}>
                  <SelectTrigger disabled={pending || stripeOff}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.soloTiers.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label} — {formatUsd(t.monthlyPriceCents)}/mo · {t.monthlyVisitCredit}{' '}
                        visits
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                disabled={pending || stripeOff || !selectedTier}
                onClick={() => startCapacityCheckout('monthly_tier', tier)}
              >
                {pending
                  ? 'Starting checkout…'
                  : selectedTier
                    ? `Subscribe — ${selectedTier.label}`
                    : 'Subscribe'}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Loading catalog…</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Visit top-up bundles</CardTitle>
          <CardDescription>
            One-time purchase — visits are added to your org bank immediately after payment.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {catalog ? (
            <>
              <div className="space-y-1.5">
                <Label>Bundle</Label>
                <Select value={bundleId} onValueChange={setBundleId}>
                  <SelectTrigger disabled={pending || stripeOff}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.visitBundles.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.label} — {formatUsd(b.priceCents)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={pending || stripeOff || !selectedBundle}
                onClick={() => startCapacityCheckout('visit_bundle', bundleId)}
              >
                {pending
                  ? 'Starting checkout…'
                  : selectedBundle
                    ? `Buy ${selectedBundle.label}`
                    : 'Buy bundle'}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Loading catalog…</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Legacy seat subscription</CardTitle>
          <CardDescription>
            {state
              ? state.stripeCustomerLinked
                ? `${state.activeSeats} seat${state.activeSeats === 1 ? '' : 's'} · ${state.assignedSeats} assigned`
                : 'No legacy seat subscription.'
              : 'Loading…'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state?.stripeCustomerLinked ? (
            <Button type="button" variant="outline" onClick={openPortal} disabled={pending || stripeOff}>
              Manage legacy billing
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Per-seat Stripe subscriptions from the pre-visit-bank model. New customers should use
              visit-bank plans above.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
