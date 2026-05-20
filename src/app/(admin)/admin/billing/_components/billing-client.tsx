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

type SeatsResponse = {
  summary: { activeSeats: number; assignedSeats: number };
  stripeConfigured: boolean;
  stripeCustomerLinked: boolean;
};

type ActionResponse = { data?: { url?: string }; error?: { message?: string } };

/**
 * BillingClient — the org-admin subscription surface. Shows whether the org
 * has an active subscription and lets the admin either start one (Stripe
 * Checkout) or manage an existing one (Stripe customer portal). Seats are
 * provisioned by the Stripe webhook after checkout; they show up on /admin/seats.
 */
export function BillingClient() {
  const params = useSearchParams();
  const checkout = params.get('checkout');

  const [state, setState] = useState<BillingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startLoad] = useTransition();
  const [tier, setTier] = useState<'SOLO' | 'TEAM'>('TEAM');
  const [quantity, setQuantity] = useState(3);
  const [pending, startAction] = useTransition();

  function load() {
    setError(null);
    startLoad(async () => {
      const res = await fetch('/api/admin/seats');
      if (!res.ok) {
        setError('Failed to load billing status.');
        return;
      }
      const json = (await res.json()) as SeatsResponse;
      setState({
        activeSeats: json.summary.activeSeats,
        assignedSeats: json.summary.assignedSeats,
        stripeConfigured: json.stripeConfigured,
        stripeCustomerLinked: json.stripeCustomerLinked,
      });
    });
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  function startCheckout() {
    setError(null);
    startAction(async () => {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, quantity }),
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

  const subscribed = !!state?.stripeCustomerLinked;
  const stripeOff = !!state && !state.stripeConfigured;

  return (
    <div className="space-y-3">
      {checkout === 'success' && (
        <StatusBanner variant="info">
          Payment received. Seats are being provisioned and will appear on the Seats page in a
          few moments.
        </StatusBanner>
      )}
      {checkout === 'cancelled' && (
        <StatusBanner variant="info">Checkout cancelled — no charge was made.</StatusBanner>
      )}
      {error && <StatusBanner variant="danger">{error}</StatusBanner>}
      {stripeOff && (
        <StatusBanner variant="danger">
          Billing is not configured on this server — subscriptions are unavailable until Stripe
          keys are set.
        </StatusBanner>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-md">Subscription</CardTitle>
          <CardDescription>
            {state
              ? subscribed
                ? `${state.activeSeats} seat${state.activeSeats === 1 ? '' : 's'} · ${state.assignedSeats} assigned`
                : 'No active subscription.'
              : 'Loading…'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {subscribed ? (
            <>
              <p className="text-xs text-muted-foreground">
                Update your payment method, change the seat quantity, or cancel in the Stripe
                billing portal. Seat-count changes sync back automatically.
              </p>
              <Button type="button" onClick={openPortal} disabled={pending || stripeOff}>
                {pending ? 'Opening…' : 'Manage billing'}
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Start a subscription to provision seats. You assign seats to clinicians on the
                Seats page; billing follows the number of seats you buy, not how many are
                assigned.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Plan</Label>
                  <Select value={tier} onValueChange={(v) => setTier(v as 'SOLO' | 'TEAM')}>
                    <SelectTrigger disabled={pending}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SOLO">Solo (1 seat)</SelectItem>
                      <SelectItem value="TEAM">Team</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {tier === 'TEAM' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="seat-qty">Seats</Label>
                    <Input
                      id="seat-qty"
                      type="number"
                      min={1}
                      max={500}
                      value={quantity}
                      onChange={(e) =>
                        setQuantity(Math.max(1, Math.min(500, Number(e.target.value) || 1)))
                      }
                      disabled={pending}
                    />
                  </div>
                )}
              </div>
              <Button type="button" onClick={startCheckout} disabled={pending || stripeOff}>
                {pending
                  ? 'Starting checkout…'
                  : tier === 'SOLO'
                    ? 'Subscribe — Solo'
                    : `Subscribe — Team (${quantity} seat${quantity === 1 ? '' : 's'})`}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
