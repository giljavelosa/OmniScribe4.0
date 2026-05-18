import { describe, expect, it } from 'vitest';

import { encodeWavBlob } from '@/lib/audio/wav-encoder';

/**
 * The WAV encoder's shape is contract — the S3 path stores raw bytes,
 * downstream Soniox batch + WAV parsers expect the canonical RIFF/WAVE
 * header layout for 16 kHz mono PCM Int16. Lock the byte-level invariants.
 */
describe('encodeWavBlob', () => {
  async function readBlob(blob: Blob): Promise<ArrayBuffer> {
    return await blob.arrayBuffer();
  }

  function ascii(view: DataView, offset: number, length: number): string {
    let s = '';
    for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
    return s;
  }

  it('emits the canonical RIFF/WAVE header with 16 kHz mono Int16 fmt block', async () => {
    const chunks = [new Int16Array([1, 2, 3, 4])];
    const blob = encodeWavBlob(chunks, 16_000);
    expect(blob.type).toBe('audio/wav');
    const buf = await readBlob(blob);
    const view = new DataView(buf);
    expect(ascii(view, 0, 4)).toBe('RIFF');
    expect(ascii(view, 8, 4)).toBe('WAVE');
    expect(ascii(view, 12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(ascii(view, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(chunks[0]!.byteLength);
  });

  it('preserves sample bytes in order across multiple chunks', async () => {
    const chunks = [new Int16Array([10, 20]), new Int16Array([30, 40, 50])];
    const blob = encodeWavBlob(chunks, 16_000);
    const buf = await blob.arrayBuffer();
    const data = new Int16Array(buf, 44);
    expect(Array.from(data)).toEqual([10, 20, 30, 40, 50]);
  });

  it('emits a header-only WAV when chunks is empty', async () => {
    const blob = encodeWavBlob([], 16_000);
    const buf = await blob.arrayBuffer();
    expect(buf.byteLength).toBe(44);
    const view = new DataView(buf);
    expect(view.getUint32(40, true)).toBe(0);
  });
});
