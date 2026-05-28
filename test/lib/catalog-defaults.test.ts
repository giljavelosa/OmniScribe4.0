import { describe, expect, it } from 'vitest';

import { DEFAULT_CATALOG_PAYLOAD } from '@/lib/billing/catalog-defaults';

describe('DEFAULT_CATALOG_PAYLOAD', () => {
  it('includes three solo tiers with standard at $89 / 100 visits', () => {
    const standard = DEFAULT_CATALOG_PAYLOAD.soloTiersJson.find((t) => t.id === 'solo-standard');
    expect(standard?.monthlyPriceCents).toBe(8900);
    expect(standard?.monthlyVisitCredit).toBe(100);
  });

  it('sets collaborator seat at $39/mo', () => {
    expect(DEFAULT_CATALOG_PAYLOAD.collaboratorSeatPriceCents).toBe(3900);
  });

  it('trial solo = 50 visits / 14 days', () => {
    expect(DEFAULT_CATALOG_PAYLOAD.trialSoloVisits).toBe(50);
    expect(DEFAULT_CATALOG_PAYLOAD.trialSoloDays).toBe(14);
  });

  it('trial org = 3 seats / 100 visits / 14 days', () => {
    expect(DEFAULT_CATALOG_PAYLOAD.trialOrgSeats).toBe(3);
    expect(DEFAULT_CATALOG_PAYLOAD.trialOrgVisits).toBe(100);
    expect(DEFAULT_CATALOG_PAYLOAD.trialOrgDays).toBe(14);
  });

  it('includes visit bundles with declining implied $/visit on larger packs', () => {
    const bundles = DEFAULT_CATALOG_PAYLOAD.visitBundlesJson;
    expect(bundles.length).toBeGreaterThanOrEqual(2);
    const small = bundles[0]!;
    const large = bundles[bundles.length - 1]!;
    const smallRate = small.priceCents / small.visitCount;
    const largeRate = large.priceCents / large.visitCount;
    expect(largeRate).toBeLessThan(smallRate);
  });
});
