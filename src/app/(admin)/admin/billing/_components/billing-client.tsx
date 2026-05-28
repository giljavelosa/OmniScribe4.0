'use client';

import { useEffect, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  collaboratorSeatPriceCents: number;
  orgPlan: {
    minSeats: number;
    maxSeats: number;
    seatPriceCents: number;
    visitsPerSeatPerMonth: number;
  };
  billingStatus: {
    stripeCustomerLinked: boolean;
    capacitySubscriptionLinked: boolean;
    commercialModel: string | null;
    committedSeats: number;
    trialEndsAt: string | null;
  };
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
  const [orgSeats, setOrgSeats] = useState('3');
  const [collaboratorQty, setCollaboratorQty] = useState('1');
  const [pending, startAction] = useTransition();
  const [legacyOpen, setLegacyOpen] = useState(false);

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
        if (catJson.data.soloTiers[0]) {
          setTier(catJson.data.soloTiers[1]?.id ?? catJson.data.soloTiers[0].id);
        }
        if (catJson.data.visitBundles[0]) setBundleId(catJson.data.visitBundles[0].id);
        setOrgSeats(String(catJson.data.orgPlan.minSeats));
      }
    });
  }

  useEffect(() => {
    load();
  }, []);

  function startCapacityCheckout(body: Record<string, unknown>) {
    setError(null);
    startAction(async () => {
      const res = await fetch('/api/billing/checkout-capacity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
  const orgSeatCount = Number(orgSeats);
  const orgPlan = catalog?.orgPlan;
  const orgQuote =
    orgPlan && Number.isFinite(orgSeatCount) && orgSeatCount >= orgPlan.minSeats
      ? {
          monthlyTotal: orgSeatCount * orgPlan.seatPriceCents,
          monthlyVisits: orgSeatCount * orgPlan.visitsPerSeatPerMonth,
        }
      : null;
  const collabQty = Number(collaboratorQty);
  const canManagePortal =
    catalog?.billingStatus.stripeCustomerLinked ||
    catalog?.billingStatus.capacitySubscriptionLinked;

  const successMessage =
    capacity === 'bundle'
      ? 'Payment received — visit bundle is being added to your org bank.'
      : capacity === 'org_tier'
        ? 'Team subscription started — seats and monthly visits are being applied.'
        : capacity === 'collaborator'
          ? 'Collaborator seats added — your seat cap is updating.'
          : capacity === 'tier'
            ? 'Subscription started — monthly visits are being credited to your org bank.'
            : 'Payment received. Changes sync in a few moments.';

  return (
    <div className="space-y-3">
      {checkout === 'success' && <StatusBanner variant="info">{successMessage}</StatusBanner>}
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

      {canManagePortal && (
        <Card>
          <CardHeader>
            <CardTitle className="text-md">Manage subscription</CardTitle>
            <CardDescription>
              Update payment method, change seat quantity, or cancel your visit-bank subscription in
              Stripe.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="outline" onClick={openPortal} disabled={pending || stripeOff}>
              Open billing portal
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Team visit bank — monthly plan</CardTitle>
          <CardDescription>
            For practices with multiple clinicians. Price is per seat; visits credit to your shared
            org bank each month.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {catalog && orgPlan ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="org-seats">Clinician seats</Label>
                <Input
                  id="org-seats"
                  type="number"
                  min={orgPlan.minSeats}
                  max={orgPlan.maxSeats}
                  value={orgSeats}
                  onChange={(e) => setOrgSeats(e.target.value)}
                  disabled={pending || stripeOff}
                />
                <p className="text-xs text-muted-foreground">
                  {formatUsd(orgPlan.seatPriceCents)}/seat/mo · {orgPlan.visitsPerSeatPerMonth}{' '}
                  visits/seat/mo · min {orgPlan.minSeats} seats
                </p>
              </div>
              {orgQuote && (
                <p className="text-sm">
                  {formatUsd(orgQuote.monthlyTotal)}/mo · {orgQuote.monthlyVisits.toLocaleString()}{' '}
                  visits/month
                </p>
              )}
              <Button
                type="button"
                disabled={pending || stripeOff || !orgQuote}
                onClick={() =>
                  startCapacityCheckout({
                    purchaseType: 'org_monthly_tier',
                    seatCount: orgSeatCount,
                  })
                }
              >
                {pending ? 'Starting checkout…' : 'Subscribe — team plan'}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Loading catalog…</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Solo visit bank — monthly plan</CardTitle>
          <CardDescription>
            One clinician. Visits credit to your org bank each month.
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
                onClick={() =>
                  startCapacityCheckout({ purchaseType: 'monthly_tier', catalogItemId: tier })
                }
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
          <CardTitle className="text-md">Collaborator seat add-on</CardTitle>
          <CardDescription>
            Add extra clinician seats beyond your base plan without changing visit bundles.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {catalog ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="collab-qty">Additional seats</Label>
                <Input
                  id="collab-qty"
                  type="number"
                  min={1}
                  max={20}
                  value={collaboratorQty}
                  onChange={(e) => setCollaboratorQty(e.target.value)}
                  disabled={pending || stripeOff}
                />
                <p className="text-xs text-muted-foreground">
                  {formatUsd(catalog.collaboratorSeatPriceCents)}/seat/mo each
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={pending || stripeOff || !Number.isFinite(collabQty) || collabQty < 1}
                onClick={() =>
                  startCapacityCheckout({
                    purchaseType: 'collaborator_seats',
                    quantity: collabQty,
                  })
                }
              >
                {pending
                  ? 'Starting checkout…'
                  : `Add ${collabQty} seat${collabQty === 1 ? '' : 's'}`}
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
                onClick={() =>
                  startCapacityCheckout({ purchaseType: 'visit_bundle', catalogItemId: bundleId })
                }
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

      {state?.stripeCustomerLinked && (
        <Card className="border-dashed bg-muted/20">
          <CardHeader className="pb-2">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => setLegacyOpen((open) => !open)}
              aria-expanded={legacyOpen}
            >
              <div>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Previous billing model (per-seat only)
                </CardTitle>
                <CardDescription className="text-xs mt-1">
                  Only needed if your org still has an old seat subscription. New plans use visit
                  bank above.
                </CardDescription>
              </div>
              <span className="text-xs text-muted-foreground shrink-0 ml-3">
                {legacyOpen ? 'Hide' : 'Show'}
              </span>
            </button>
          </CardHeader>
          {legacyOpen && (
            <CardContent className="pt-0 space-y-2">
              <p className="text-sm text-muted-foreground">
                {state.activeSeats} seat{state.activeSeats === 1 ? '' : 's'} ·{' '}
                {state.assignedSeats} assigned
              </p>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
