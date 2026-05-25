import { describe, it, expect } from 'vitest';

import { stripJsonFence } from '@/lib/llm/strip-json-fence';

describe('stripJsonFence', () => {
  it('passes through already-unfenced JSON', () => {
    const raw = '{"hello":"world"}';
    expect(stripJsonFence(raw)).toBe('{"hello":"world"}');
  });

  it('strips ```json … ``` wrapper (the Sonnet 4.5 default)', () => {
    const raw = '```json\n{"hello":"world"}\n```';
    expect(stripJsonFence(raw)).toBe('{"hello":"world"}');
  });

  it('strips bare ``` … ``` wrapper', () => {
    const raw = '```\n{"hello":"world"}\n```';
    expect(stripJsonFence(raw)).toBe('{"hello":"world"}');
  });

  it('is case-insensitive on the json language tag', () => {
    const raw = '```JSON\n{"hello":"world"}\n```';
    expect(stripJsonFence(raw)).toBe('{"hello":"world"}');
  });

  it('tolerates surrounding whitespace', () => {
    const raw = '   \n```json\n{"hello":"world"}\n```\n  ';
    expect(stripJsonFence(raw)).toBe('{"hello":"world"}');
  });

  it('tolerates CRLF line endings', () => {
    const raw = '```json\r\n{"hello":"world"}\r\n```';
    expect(stripJsonFence(raw)).toBe('{"hello":"world"}');
  });

  it('strips opener even when closer is missing (truncated response)', () => {
    const raw = '```json\n{"hello":"world"';
    expect(stripJsonFence(raw)).toBe('{"hello":"world"');
  });

  it('strips closer even when opener is missing', () => {
    const raw = '{"hello":"world"}\n```';
    expect(stripJsonFence(raw)).toBe('{"hello":"world"}');
  });

  it('returns empty string for empty input', () => {
    expect(stripJsonFence('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(stripJsonFence('   \n  ')).toBe('');
  });

  it('preserves multi-line JSON content verbatim', () => {
    const raw = '```json\n{\n  "a": 1,\n  "b": [1, 2, 3]\n}\n```';
    expect(stripJsonFence(raw)).toBe('{\n  "a": 1,\n  "b": [1, 2, 3]\n}');
  });

  it('does NOT strip fences that appear inside the JSON body', () => {
    // The body itself contains ``` characters in a string; only outer fences
    // should be stripped.
    const raw = '```json\n{"snippet":"```ts\\nlet x = 1;\\n```"}\n```';
    expect(stripJsonFence(raw)).toBe('{"snippet":"```ts\\nlet x = 1;\\n```"}');
  });
});
