import { describe, expect, it, vi } from 'vitest';

import { checkBrowserCompat, measureRoundTrip } from '@/lib/telehealth/preflight';

describe('checkBrowserCompat', () => {
  it('passes when every required global is present', () => {
    const globals = {
      MediaStreamTrackProcessor: function () {},
      AudioContext: function () {},
      WebSocket: function () {},
      navigator: { mediaDevices: { getUserMedia: () => {} } },
    };
    expect(checkBrowserCompat(globals).ok).toBe(true);
  });

  it('fails when MediaStreamTrackProcessor is missing (Safari, Firefox)', () => {
    const globals = {
      AudioContext: function () {},
      WebSocket: function () {},
      navigator: { mediaDevices: { getUserMedia: () => {} } },
    };
    const r = checkBrowserCompat(globals);
    expect(r.ok).toBe(false);
    expect(r.details.hasMediaStreamTrackProcessor).toBe(false);
  });

  it('fails when getUserMedia is unavailable (insecure context)', () => {
    const globals = {
      MediaStreamTrackProcessor: function () {},
      AudioContext: function () {},
      WebSocket: function () {},
      navigator: { mediaDevices: {} },
    };
    const r = checkBrowserCompat(globals);
    expect(r.ok).toBe(false);
    expect(r.details.hasGetUserMedia).toBe(false);
  });
});

describe('measureRoundTrip', () => {
  it('returns the round-trip in ms on a 200 response', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    let t = 0;
    const r = await measureRoundTrip({
      fetchImpl,
      now: () => {
        const next = t;
        t += 42;
        return next;
      },
    });
    expect(r).toEqual({ ok: true, rttMs: 42 });
  });

  it('reports http when the endpoint returns 500', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const r = await measureRoundTrip({ fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('http');
      expect(r.status).toBe(500);
    }
  });

  it('reports fetch_failed when fetch throws a non-Abort error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;
    const r = await measureRoundTrip({ fetchImpl });
    expect(r).toEqual({ ok: false, reason: 'fetch_failed' });
  });

  it('reports timeout when the request is aborted', async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as unknown as typeof fetch;
    const r = await measureRoundTrip({ fetchImpl, timeoutMs: 10 });
    expect(r).toEqual({ ok: false, reason: 'timeout' });
  });
});
