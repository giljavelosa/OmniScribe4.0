import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted; use vi.hoisted so the mock fn is initialized before
// the import factory runs.
const { findUniqueMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    featureFlag: { findUnique: findUniqueMock },
  },
}));

import {
  FEATURE_FLAG_KEYS,
  isFeatureEnabled,
  isTruthyFlagValue,
} from '@/lib/feature-flags';

beforeEach(() => {
  findUniqueMock.mockReset();
});

describe('isTruthyFlagValue (pure normalizer)', () => {
  it('accepts boolean true', () => {
    expect(isTruthyFlagValue(true)).toBe(true);
  });

  it('rejects boolean false', () => {
    expect(isTruthyFlagValue(false)).toBe(false);
  });

  it('accepts string "true" case-insensitively', () => {
    expect(isTruthyFlagValue('true')).toBe(true);
    expect(isTruthyFlagValue('True')).toBe(true);
    expect(isTruthyFlagValue('TRUE')).toBe(true);
  });

  it('rejects string "false" / "0" / arbitrary strings', () => {
    expect(isTruthyFlagValue('false')).toBe(false);
    expect(isTruthyFlagValue('0')).toBe(false);
    expect(isTruthyFlagValue('yes')).toBe(false);
    expect(isTruthyFlagValue('')).toBe(false);
  });

  it('accepts object { enabled: true }', () => {
    expect(isTruthyFlagValue({ enabled: true })).toBe(true);
  });

  it('accepts object { enabled: "true" } recursively', () => {
    expect(isTruthyFlagValue({ enabled: 'true' })).toBe(true);
    expect(isTruthyFlagValue({ enabled: 'True' })).toBe(true);
  });

  it('rejects object { enabled: false } / missing enabled', () => {
    expect(isTruthyFlagValue({ enabled: false })).toBe(false);
    expect(isTruthyFlagValue({})).toBe(false);
    expect(isTruthyFlagValue({ rollout: 100 })).toBe(false);
  });

  it('rejects null / undefined / numbers / arrays', () => {
    expect(isTruthyFlagValue(null)).toBe(false);
    expect(isTruthyFlagValue(undefined)).toBe(false);
    expect(isTruthyFlagValue(1)).toBe(false);
    expect(isTruthyFlagValue(0)).toBe(false);
    expect(isTruthyFlagValue([true])).toBe(false);
    expect(isTruthyFlagValue(['true'])).toBe(false);
  });
});

describe('isFeatureEnabled (DB integration)', () => {
  it('returns true when the row exists with value=true', async () => {
    findUniqueMock.mockResolvedValueOnce({ value: true });
    expect(await isFeatureEnabled('org_1', 'cleo.caseRule.v1')).toBe(true);
    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { orgId_key: { orgId: 'org_1', key: 'cleo.caseRule.v1' } },
      select: { value: true },
    });
  });

  it('returns true when value is { enabled: true } JSON shape', async () => {
    findUniqueMock.mockResolvedValueOnce({ value: { enabled: true, rolloutPercent: 100 } });
    expect(await isFeatureEnabled('org_1', 'cleo.caseRule.v1')).toBe(true);
  });

  it('returns false when the row does NOT exist (absence = off)', async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    expect(await isFeatureEnabled('org_1', 'cleo.caseRule.v1')).toBe(false);
  });

  it('returns false when value is explicitly false', async () => {
    findUniqueMock.mockResolvedValueOnce({ value: false });
    expect(await isFeatureEnabled('org_1', 'cleo.caseRule.v1')).toBe(false);
  });

  it('fails-closed (returns false) on DB error — flag MUST NOT silently flip on during an outage', async () => {
    findUniqueMock.mockRejectedValueOnce(new Error('Prisma timeout'));
    expect(await isFeatureEnabled('org_1', 'cleo.caseRule.v1')).toBe(false);
  });

  it('honors a passed-in transaction client', async () => {
    const txMock = { featureFlag: { findUnique: vi.fn().mockResolvedValueOnce({ value: true }) } };
    expect(await isFeatureEnabled('org_1', 'k', txMock as never)).toBe(true);
    expect(txMock.featureFlag.findUnique).toHaveBeenCalledTimes(1);
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});

describe('FEATURE_FLAG_KEYS registry', () => {
  it('exports the Unit 49 case-rule key', () => {
    expect(FEATURE_FLAG_KEYS.CLEO_CASE_RULE_V1).toBe('cleo.caseRule.v1');
  });
});
