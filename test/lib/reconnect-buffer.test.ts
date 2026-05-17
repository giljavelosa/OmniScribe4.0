import { describe, expect, it } from 'vitest';

import { ReconnectBuffer } from '@/lib/telehealth/reconnect-buffer';

describe('ReconnectBuffer', () => {
  it('pushes and drains in order', () => {
    const buf = new ReconnectBuffer({ sampleRate: 16_000, windowSeconds: 1 });
    buf.push(new Int16Array([1, 2, 3]));
    buf.push(new Int16Array([4, 5]));
    const drained = buf.drain();
    expect(drained.length).toBe(2);
    expect(Array.from(drained[0]!)).toEqual([1, 2, 3]);
    expect(Array.from(drained[1]!)).toEqual([4, 5]);
    expect(buf.size).toBe(0);
  });

  it('drain leaves the buffer empty', () => {
    const buf = new ReconnectBuffer({ sampleRate: 16_000, windowSeconds: 1 });
    buf.push(new Int16Array([1, 2]));
    buf.drain();
    expect(buf.size).toBe(0);
    expect(buf.drain()).toEqual([]);
  });

  it('ignores empty chunks', () => {
    const buf = new ReconnectBuffer({ sampleRate: 16_000, windowSeconds: 1 });
    buf.push(new Int16Array(0));
    expect(buf.size).toBe(0);
    expect(buf.drain()).toEqual([]);
  });

  it('drops oldest chunks when over capacity', () => {
    // 0.1 s window at 100 Hz = 10 sample cap.
    const buf = new ReconnectBuffer({ sampleRate: 100, windowSeconds: 0.1 });
    expect(buf.capacity).toBe(10);
    buf.push(new Int16Array([1, 2, 3, 4])); // 4
    buf.push(new Int16Array([5, 6, 7, 8])); // 8
    buf.push(new Int16Array([9, 10, 11, 12])); // overflow → drop first chunk
    expect(buf.size).toBe(8);
    const drained = buf.drain();
    expect(drained.length).toBe(2);
    expect(Array.from(drained[0]!)).toEqual([5, 6, 7, 8]);
    expect(Array.from(drained[1]!)).toEqual([9, 10, 11, 12]);
  });

  it('keeps at least the most recent chunk even if it alone exceeds capacity', () => {
    const buf = new ReconnectBuffer({ sampleRate: 100, windowSeconds: 0.05 }); // 5 sample cap
    buf.push(new Int16Array([1, 2, 3]));
    // One mega-chunk larger than the whole window. We can't drop it without
    // losing everything; verify it stays.
    const big = new Int16Array(20);
    for (let i = 0; i < big.length; i++) big[i] = 100 + i;
    buf.push(big);
    const drained = buf.drain();
    expect(drained.length).toBe(1);
    expect(drained[0]!.length).toBe(20);
  });

  it('rejects non-positive sampleRate / windowSeconds', () => {
    expect(() => new ReconnectBuffer({ sampleRate: 0 })).toThrow();
    expect(() => new ReconnectBuffer({ sampleRate: -1 })).toThrow();
    expect(() => new ReconnectBuffer({ sampleRate: 16_000, windowSeconds: 0 })).toThrow();
    expect(() => new ReconnectBuffer({ sampleRate: 16_000, windowSeconds: -5 })).toThrow();
  });

  it('default window is 30 seconds at the requested sample rate', () => {
    const buf = new ReconnectBuffer({ sampleRate: 16_000 });
    expect(buf.capacity).toBe(16_000 * 30);
  });
});
