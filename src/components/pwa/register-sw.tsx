'use client';

import { useEffect } from 'react';

/**
 * RegisterServiceWorker — Unit 36.
 *
 * Mounted at the root layout. Registers `/sw.js` on first client
 * paint. Effect-only — renders nothing.
 *
 * No-op when:
 *   - The runtime is SSR (window undefined).
 *   - `serviceWorker` API isn't supported (older Safari, in-app browsers).
 *   - NODE_ENV === 'development' AND OMNISCRIBE_ENABLE_SW_IN_DEV is
 *     unset. Dev typically wants a fresh fetch on every change; HMR
 *     fights an aggressive cache. Set the env var when explicitly
 *     testing offline UX in dev.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (
      process.env.NODE_ENV === 'development' &&
      !process.env.NEXT_PUBLIC_OMNISCRIBE_ENABLE_SW_IN_DEV
    ) {
      return;
    }
    // Fire-and-forget — registration failures are logged to console
    // but don't block app boot. The console error gives a debug
    // breadcrumb if the SW file 404s in prod.
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('OmniScribe SW registration failed:', err);
    });
  }, []);

  return null;
}
