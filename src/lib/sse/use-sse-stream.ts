'use client';

import { useEffect, useRef, useState } from 'react';

export type SseConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

type EventHandlers = Record<string, () => void>;

type Options = {
  /** Per-event handlers keyed by event name. Use addEventListener semantics. */
  handlers: EventHandlers;
  /** Disable the connection (e.g. note already SIGNED, no point watching). */
  enabled?: boolean;
  /** Max reconnect attempts before falling back to 'offline'. */
  maxRetries?: number;
};

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

/**
 * useSseStream — production-grade EventSource wrapper.
 *
 * Why: the raw EventSource closes silently on transient network errors. Before
 * this hook, the review surface's SSE channel would go stale without telling
 * the clinician. With the hook:
 *   - `status: 'connecting' | 'live' | 'reconnecting' | 'offline'` exposed
 *     for surface-level indicators.
 *   - Exponential backoff reconnect (1s → 2s → 4s → 8s → 16s, capped). After
 *     `maxRetries` attempts, status flips to 'offline' and the user must
 *     refresh to retry.
 *   - First successful 'open' resets the retry counter so a 2-hour visit
 *     that hiccups once doesn't burn the retry budget for the whole session.
 *
 * Browser EventSource's built-in reconnect is opaque + slow; we replace it
 * with explicit close+recreate so retry timing is debuggable.
 */
export function useSseStream(url: string, { handlers, enabled = true, maxRetries = 6 }: Options) {
  const [status, setStatus] = useState<SseConnectionStatus>(enabled ? 'connecting' : 'offline');
  const handlersRef = useRef(handlers);

  // Sync handlers into the ref so the EventSource's listeners always call
  // the latest closure without re-subscribing.
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus('offline');
      return;
    }

    let cancelled = false;
    let retryCount = 0;
    let currentEs: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;
      setStatus(retryCount === 0 ? 'connecting' : 'reconnecting');

      const es = new EventSource(url);
      currentEs = es;

      es.onopen = () => {
        retryCount = 0;
        setStatus('live');
      };

      // Read handlers from the ref at INVOCATION time, not subscription time —
      // otherwise the listener closes over the handler captured at connect()
      // and the handlersRef sync effect is dead code. Iterate the snapshot of
      // event names so we register exactly one listener per channel.
      for (const name of Object.keys(handlersRef.current)) {
        es.addEventListener(name, () => {
          const current = handlersRef.current[name];
          if (current) current();
        });
      }

      es.onerror = () => {
        if (cancelled) return;
        es.close();
        currentEs = null;
        if (retryCount >= maxRetries) {
          setStatus('offline');
          return;
        }
        const delay = BACKOFF_MS[Math.min(retryCount, BACKOFF_MS.length - 1)] ?? 16_000;
        retryCount += 1;
        setStatus('reconnecting');
        reconnectTimer = setTimeout(() => {
          if (!cancelled) connect();
        }, delay);
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (currentEs) currentEs.close();
    };
  }, [url, enabled, maxRetries]);

  return { status };
}
