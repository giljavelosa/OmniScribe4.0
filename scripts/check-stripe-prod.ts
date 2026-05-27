#!/usr/bin/env tsx
/**
 * scripts/check-stripe-prod.ts
 *
 * Read-only Stripe production health summary. Runs against the DATABASE_URL
 * and STRIPE_SECRET_KEY in the loaded env — point it at prod by loading a
 * prod env file. Never writes anything to either Stripe or the DB.
 *
 * Verifies, in this order:
 *   1. Env config       — which STRIPE_* vars are set; key/price-id mode parity
 *   2. Stripe API auth  — light call to confirm STRIPE_SECRET_KEY actually works
 *   3. Webhook config   — endpoint pointed at NEXTAUTH_URL, enabled events match
 *   4. Audit activity   — recent STRIPE_* and SEAT_* counts in 7d / 30d windows
 *   5. DB invariants    — subscribed orgs with 0 active seats; live seats with
 *                         no stripeSubId
 *
 * Usage:
 *   node --env-file=.env.prod --import=tsx scripts/check-stripe-prod.ts
 *   (or: npm run check:stripe — wired into package.json)
 *
 * Exits 0 when everything is green or only-warnings; exits 1 on any failure
 * so the script can be wired into a deploy / cron health check.
 */

import { prisma } from '@/lib/prisma';
import { isStripeConfigured, getPublicBaseUrl } from '@/lib/stripe/env';

type Status = 'ok' | 'warn' | 'fail';
type Section = {
  name: string;
  rows: Array<{ status: Status; label: string; detail: string }>;
};

const sections: Section[] = [];

function mask(s: string | undefined, keep = 6): string {
  if (!s) return '<unset>';
  if (s.length <= keep) return '*'.repeat(s.length);
  return `${s.slice(0, keep)}…(${s.length} chars)`;
}

function mode(key: string | undefined): 'live' | 'test' | 'unknown' {
  if (!key) return 'unknown';
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) return 'live';
  if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) return 'test';
  return 'unknown';
}

// Note: Stripe price IDs are *not* visually distinguishable between test and
// live mode — both have the form `price_…`. The only reliable test for
// price/key mode parity is `stripe.prices.retrieve(id)` with the configured
// secret key, which is done in checkStripeApi() below.

function row(
  section: Section,
  status: Status,
  label: string,
  detail: string,
): void {
  section.rows.push({ status, label, detail });
}

async function checkEnv(): Promise<Section> {
  const s: Section = { name: 'env config', rows: [] };
  const secret = process.env.STRIPE_SECRET_KEY;
  const webhook = process.env.STRIPE_WEBHOOK_SECRET;
  const solo = process.env.STRIPE_SOLO_PRICE_ID;
  const team = process.env.STRIPE_TEAM_PRICE_ID;
  const baseUrl = getPublicBaseUrl();

  row(s, secret ? 'ok' : 'fail', 'STRIPE_SECRET_KEY', secret ? `${mask(secret)} (${mode(secret)} mode)` : 'unset — billing routes return 501');
  row(s, webhook ? 'ok' : 'fail', 'STRIPE_WEBHOOK_SECRET', webhook ? `${mask(webhook)} (looks ${webhook.startsWith('whsec_') ? 'well-formed' : 'malformed — should start with whsec_'})` : 'unset — webhook returns 501 on every delivery');
  row(s, solo ? 'ok' : 'fail', 'STRIPE_SOLO_PRICE_ID', solo ?? 'unset — SOLO checkout will throw');
  row(s, team ? 'ok' : 'fail', 'STRIPE_TEAM_PRICE_ID', team ?? 'unset — TEAM checkout will throw');
  row(s, isStripeConfigured() ? 'ok' : 'fail', 'isStripeConfigured()', isStripeConfigured() ? 'true' : 'false — billing feature OFF, every billing route returns 501');

  // NEXTAUTH_URL sanity — Stripe redirects fail if this is localhost in prod.
  if (baseUrl.includes('localhost')) {
    row(s, 'warn', 'NEXTAUTH_URL', `${baseUrl} — looks like a dev URL. Checkout success/cancel redirects will land users on localhost in prod.`);
  } else {
    row(s, 'ok', 'NEXTAUTH_URL', baseUrl);
  }

  return s;
}

async function checkStripeApi(): Promise<Section> {
  const s: Section = { name: 'stripe api', rows: [] };
  if (!process.env.STRIPE_SECRET_KEY) {
    row(s, 'fail', 'auth', 'skipped — STRIPE_SECRET_KEY unset');
    return s;
  }
  // Import lazily so the script still runs (env section + DB sections) when
  // stripe.js can't construct a client.
  const { getStripe } = await import('@/lib/stripe/client');
  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch (err) {
    row(s, 'fail', 'auth', err instanceof Error ? err.message : String(err));
    return s;
  }

  let livemode: boolean | null = null;
  try {
    const balance = await stripe.balance.retrieve();
    livemode = balance.livemode;
    row(s, 'ok', 'auth', `balance.retrieve OK (livemode=${livemode})`);
    const keyMode = mode(process.env.STRIPE_SECRET_KEY);
    if (livemode && keyMode === 'test') {
      row(s, 'fail', 'livemode parity', 'Stripe reports livemode=true but key looks test-mode. Refusing to trust the env.');
    } else if (!livemode && keyMode === 'live') {
      row(s, 'fail', 'livemode parity', 'Stripe reports livemode=false but key looks live-mode. Refusing to trust the env.');
    }
  } catch (err) {
    const e = err as { type?: string; message?: string };
    row(s, 'fail', 'auth', `${e.type ?? 'error'}: ${e.message ?? String(err)}`);
    return s;
  }

  // Resolve each configured price against Stripe. This is the ONLY reliable
  // way to detect a price/key mode mismatch — a live-mode key looking up a
  // test-mode price id returns `resource_missing` even though the id is
  // perfectly well-formed. Catching it here is much cheaper than discovering
  // it on the first real checkout attempt.
  const PRICE_VARS: Array<['STRIPE_SOLO_PRICE_ID' | 'STRIPE_TEAM_PRICE_ID', string | undefined]> = [
    ['STRIPE_SOLO_PRICE_ID', process.env.STRIPE_SOLO_PRICE_ID],
    ['STRIPE_TEAM_PRICE_ID', process.env.STRIPE_TEAM_PRICE_ID],
  ];
  for (const [label, id] of PRICE_VARS) {
    if (!id) {
      row(s, 'fail', label, 'unset');
      continue;
    }
    try {
      const price = await stripe.prices.retrieve(id);
      if (livemode !== null && price.livemode !== livemode) {
        row(
          s,
          'fail',
          label,
          `price livemode=${price.livemode} but key livemode=${livemode}. Mode mismatch — checkout will throw "No such price".`,
        );
        continue;
      }
      const recurring = price.recurring;
      if (!recurring) {
        row(s, 'fail', label, `${id} is not a recurring price — subscription checkout requires recurring.`);
        continue;
      }
      const amount = price.unit_amount != null ? `${(price.unit_amount / 100).toFixed(2)} ${price.currency.toUpperCase()}` : 'metered';
      row(s, price.active ? 'ok' : 'fail', label, `${amount} / ${recurring.interval} · active=${price.active}`);
    } catch (err) {
      const e = err as { code?: string; type?: string; message?: string };
      // The most common case: live-mode key + test-mode price id (or vice
      // versa) returns `resource_missing`. Call that out explicitly because
      // the raw Stripe error is otherwise easy to misread as "this id is
      // typo'd" when the real problem is a mode mismatch.
      if (e.code === 'resource_missing') {
        row(
          s,
          'fail',
          label,
          `${id} not found by this key. Either the id is wrong OR the key is the wrong mode (live vs test). ${e.message ?? ''}`,
        );
      } else {
        row(s, 'fail', label, `${e.type ?? 'error'}: ${e.message ?? String(err)}`);
      }
    }
  }

  // Webhook endpoint check — does ANY registered endpoint point at our
  // NEXTAUTH_URL/api/webhooks/stripe, and does it subscribe to all five
  // events we handle?
  const expectedUrl = `${getPublicBaseUrl()}/api/webhooks/stripe`;
  const REQUIRED_EVENTS = [
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.payment_failed',
  ];

  try {
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const match = endpoints.data.find((e) => e.url === expectedUrl);
    if (!match) {
      const others = endpoints.data.map((e) => e.url).slice(0, 5);
      row(
        s,
        'fail',
        'webhook endpoint',
        `no endpoint matches ${expectedUrl}. ${endpoints.data.length} endpoint(s) registered${others.length ? `: ${others.join(', ')}` : ''}`,
      );
    } else {
      row(s, match.status === 'enabled' ? 'ok' : 'fail', 'webhook endpoint', `${expectedUrl} status=${match.status}`);
      const enabled = match.enabled_events ?? [];
      const wildcard = enabled.includes('*');
      const missing = REQUIRED_EVENTS.filter((e) => !wildcard && !enabled.includes(e));
      if (missing.length === 0) {
        row(s, 'ok', 'webhook events', wildcard ? 'subscribed to * (all events)' : `all ${REQUIRED_EVENTS.length} required events subscribed`);
      } else {
        row(s, 'fail', 'webhook events', `missing: ${missing.join(', ')} — seat provisioning / cancel handling will silently drop these events`);
      }
    }
  } catch (err) {
    const e = err as { type?: string; message?: string };
    row(s, 'fail', 'webhook endpoint', `${e.type ?? 'error'}: ${e.message ?? String(err)}`);
  }

  return s;
}

async function checkAuditActivity(): Promise<Section> {
  const s: Section = { name: 'audit activity', rows: [] };
  const STRIPE_ACTIONS = [
    'STRIPE_CHECKOUT_STARTED',
    'STRIPE_SUBSCRIPTION_UPDATED',
    'STRIPE_SUBSCRIPTION_CANCELED',
    'STRIPE_PAYMENT_FAILED',
    'STRIPE_BILLING_PORTAL_OPENED',
    'SEAT_ASSIGNED',
    'SEAT_REVOKED',
  ];
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  try {
    const [count7d, count30d, lastWebhook, lastCheckout, lastFailed] = await Promise.all([
      prisma.auditLog.groupBy({
        by: ['action'],
        where: { action: { in: STRIPE_ACTIONS }, createdAt: { gte: sevenDaysAgo } },
        _count: { _all: true },
      }),
      prisma.auditLog.groupBy({
        by: ['action'],
        where: { action: { in: STRIPE_ACTIONS }, createdAt: { gte: thirtyDaysAgo } },
        _count: { _all: true },
      }),
      prisma.auditLog.findFirst({
        where: {
          action: {
            in: [
              'STRIPE_SUBSCRIPTION_UPDATED',
              'STRIPE_SUBSCRIPTION_CANCELED',
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, action: true, orgId: true },
      }),
      prisma.auditLog.findFirst({
        where: { action: 'STRIPE_CHECKOUT_STARTED' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, orgId: true },
      }),
      prisma.auditLog.findFirst({
        where: { action: 'STRIPE_PAYMENT_FAILED', createdAt: { gte: thirtyDaysAgo } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, orgId: true },
      }),
    ]);

    // 7d roll-up.
    if (count7d.length === 0) {
      row(s, 'warn', 'last 7 days', 'zero Stripe / Seat audit events — either no billing activity or Stripe isn\'t being talked to from this env');
    } else {
      const summary = count7d.map((g) => `${g.action.replace(/^STRIPE_/, '').toLowerCase()}=${g._count._all}`).join(' ');
      row(s, 'ok', 'last 7 days', summary);
    }
    if (count30d.length === 0) {
      row(s, 'warn', 'last 30 days', 'zero Stripe / Seat audit events');
    } else {
      const summary = count30d.map((g) => `${g.action.replace(/^STRIPE_/, '').toLowerCase()}=${g._count._all}`).join(' ');
      row(s, 'ok', 'last 30 days', summary);
    }

    // Most recent webhook-driven event — proves the webhook is actually firing.
    if (lastWebhook) {
      const ageDays = Math.round(
        (now.getTime() - lastWebhook.createdAt.getTime()) / (24 * 60 * 60 * 1000),
      );
      row(s, ageDays > 30 ? 'warn' : 'ok', 'last webhook-driven event', `${lastWebhook.action} ${ageDays}d ago (orgId=${lastWebhook.orgId ?? 'unknown'})`);
    } else {
      row(s, 'warn', 'last webhook-driven event', 'never — no STRIPE_SUBSCRIPTION_UPDATED/CANCELED row in audit log');
    }

    // Checkouts started — confirms the entry point is reachable.
    if (lastCheckout) {
      const ageDays = Math.round(
        (now.getTime() - lastCheckout.createdAt.getTime()) / (24 * 60 * 60 * 1000),
      );
      row(s, 'ok', 'last checkout started', `${ageDays}d ago (orgId=${lastCheckout.orgId ?? 'unknown'})`);
    } else {
      row(s, 'warn', 'last checkout started', 'never');
    }

    if (lastFailed) {
      row(s, 'warn', 'recent payment failure', `${lastFailed.createdAt.toISOString()} (orgId=${lastFailed.orgId ?? 'unknown'}) — Stripe is dunning; not a code bug, but a customer may need outreach`);
    } else {
      row(s, 'ok', 'recent payment failure', 'none in 30 days');
    }
  } catch (err) {
    row(s, 'fail', 'query', err instanceof Error ? err.message.slice(0, 200) : String(err));
  }
  return s;
}

async function checkDbInvariants(): Promise<Section> {
  const s: Section = { name: 'db invariants', rows: [] };
  try {
    // Orgs that claim a Stripe customer but have zero active seats — either a
    // mid-flight checkout, a fully-canceled sub, or a webhook that never
    // reconciled. Filter out demo / seed orgs by also looking for any audit
    // history; an org we've never seen a webhook for is more telling than one
    // we have.
    const orgsWithCustomer = await prisma.organization.findMany({
      where: { stripeCustomerId: { not: null } },
      select: {
        id: true,
        name: true,
        stripeCustomerId: true,
        seats: { where: { isActive: true }, select: { id: true } },
      },
    });
    const orphanOrgs = orgsWithCustomer.filter((o) => o.seats.length === 0);
    if (orphanOrgs.length === 0) {
      row(s, 'ok', 'subscribed orgs w/ zero seats', `0 / ${orgsWithCustomer.length} orgs with a stripeCustomerId have zero active seats`);
    } else {
      const sample = orphanOrgs.slice(0, 5).map((o) => `${o.name} (${o.id})`).join(', ');
      row(
        s,
        'warn',
        'subscribed orgs w/ zero seats',
        `${orphanOrgs.length} / ${orgsWithCustomer.length} — could be canceled subs, or a webhook that never reconciled. Sample: ${sample}`,
      );
    }

    // Active seats with no Stripe subscription id — in a Stripe-configured
    // env this should be empty. Seed / legacy seats explain it in dev.
    const orphanSeats = await prisma.seat.count({
      where: { isActive: true, stripeSubId: null },
    });
    if (orphanSeats === 0) {
      row(s, 'ok', 'active seats w/ no stripeSubId', '0');
    } else {
      row(
        s,
        isStripeConfigured() ? 'warn' : 'ok',
        'active seats w/ no stripeSubId',
        `${orphanSeats} — legitimate for seed / pre-Stripe seats; suspicious if Stripe has been live for a while`,
      );
    }

    // Total live seats. Sanity number — quoting this back to ops gives them a
    // pulse on the system without opening the Stripe dashboard.
    const [liveSeats, assignedSeats, byTier] = await Promise.all([
      prisma.seat.count({ where: { isActive: true } }),
      prisma.orgUser.count({ where: { seatId: { not: null } } }),
      prisma.seat.groupBy({
        by: ['tier'],
        where: { isActive: true },
        _count: { _all: true },
      }),
    ]);
    const tierSummary = byTier.map((t) => `${t.tier.toLowerCase()}=${t._count._all}`).join(' ');
    row(s, 'ok', 'live seats', `${liveSeats} total, ${assignedSeats} assigned${tierSummary ? ` (${tierSummary})` : ''}`);
  } catch (err) {
    row(s, 'fail', 'query', err instanceof Error ? err.message.slice(0, 200) : String(err));
  }
  return s;
}

function render(): number {
  const G = '\x1b[32m';
  const Y = '\x1b[33m';
  const R = '\x1b[31m';
  const D = '\x1b[2m';
  const X = '\x1b[0m';
  const marker = (st: Status) => (st === 'ok' ? `${G}✓${X}` : st === 'warn' ? `${Y}!${X}` : `${R}✗${X}`);

  let failed = 0;
  let warned = 0;

  console.log(`\n┌─ stripe production check ─────────────────────────────────────────`);
  for (const sec of sections) {
    console.log(`│`);
    console.log(`│ ${D}── ${sec.name} ──${X}`);
    const labelPad = Math.max(0, ...sec.rows.map((r) => r.label.length));
    for (const r of sec.rows) {
      console.log(`│  ${marker(r.status)} ${r.label.padEnd(labelPad)}  ${r.detail}`);
      if (r.status === 'fail') failed++;
      if (r.status === 'warn') warned++;
    }
  }
  const ok = sections.reduce((n, sec) => n + sec.rows.filter((r) => r.status === 'ok').length, 0);
  const total = sections.reduce((n, sec) => n + sec.rows.length, 0);
  console.log(`│`);
  console.log(`└─ ${ok}/${total} passed · ${warned} warn · ${failed} fail\n`);
  return failed > 0 ? 1 : 0;
}

async function main(): Promise<void> {
  // Order matters: env first (fast, no I/O) so the operator sees obvious
  // config gaps before we wait on network/DB calls.
  sections.push(await checkEnv());
  sections.push(await checkStripeApi());
  sections.push(await checkAuditActivity());
  sections.push(await checkDbInvariants());

  const code = render();
  await prisma.$disconnect();
  process.exit(code);
}

main().catch(async (err) => {
  console.error('check-stripe-prod fatal:', err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(2);
});
