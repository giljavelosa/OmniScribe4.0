import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePrefersReducedMotion } from '@/lib/hooks/use-prefers-reduced-motion';

/**
 * usePrefersReducedMotion hook tests — Unit 36.
 *
 * Mocks window.matchMedia so the hook can be exercised without a
 * real OS preference. Verifies initial-state sync, change-event
 * subscription, and SSR-fallback default.
 */

type MockMql = {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  _listeners: Array<(e: { matches: boolean }) => void>;
  _trigger: (matches: boolean) => void;
};

function installMatchMedia(initial: boolean): MockMql {
  const mql: MockMql = {
    matches: initial,
    _listeners: [],
    addEventListener: vi.fn((_event: string, listener: (e: { matches: boolean }) => void) => {
      mql._listeners.push(listener);
    }),
    removeEventListener: vi.fn((_event: string, listener: (e: { matches: boolean }) => void) => {
      const idx = mql._listeners.indexOf(listener);
      if (idx >= 0) mql._listeners.splice(idx, 1);
    }),
    _trigger(matches: boolean) {
      mql.matches = matches;
      for (const l of mql._listeners) l({ matches });
    },
  };
  window.matchMedia = vi.fn().mockImplementation(() => mql) as unknown as typeof window.matchMedia;
  return mql;
}

afterEach(() => {
  // Reset window.matchMedia between tests.
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe('usePrefersReducedMotion', () => {
  it('syncs to the media-query matches value on mount', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });

  it('returns false when the user has no preference', () => {
    installMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it('updates when the OS preference changes', () => {
    const mql = installMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
    act(() => {
      mql._trigger(true);
    });
    expect(result.current).toBe(true);
    act(() => {
      mql._trigger(false);
    });
    expect(result.current).toBe(false);
  });

  it('cleans up the change listener on unmount', () => {
    const mql = installMatchMedia(false);
    const { unmount } = renderHook(() => usePrefersReducedMotion());
    expect(mql._listeners).toHaveLength(1);
    unmount();
    expect(mql._listeners).toHaveLength(0);
  });

  it('handles environments without matchMedia (returns false)', () => {
    // matchMedia not installed — happy-dom test env baseline.
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });
});
