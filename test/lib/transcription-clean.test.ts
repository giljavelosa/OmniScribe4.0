import { describe, it, expect } from 'vitest';
import {
  cleanRealtimeTranscript,
  cleanBatchTranscript,
  cleanPastedTranscript,
} from '@/services/transcription/clean';

describe('cleanRealtimeTranscript', () => {
  it('drops non-final partials and keeps finals', () => {
    const cleaned = cleanRealtimeTranscript({
      segments: [
        { id: '1', text: 'Hello', speaker: 1, isFinal: false },
        { id: '2', text: 'Hello, how are you?', speaker: 1, isFinal: true },
      ],
      partial: 'Hello, how are y',
    });
    expect(cleaned.structured).toHaveLength(1);
    expect(cleaned.structured[0]?.text).toBe('Hello, how are you?');
    expect(cleaned.source).toBe('realtime');
  });

  it('coalesces consecutive same-speaker segments', () => {
    const cleaned = cleanRealtimeTranscript({
      segments: [
        { id: '1', text: 'First', speaker: 1, isFinal: true },
        { id: '2', text: 'and second', speaker: 1, isFinal: true },
        { id: '3', text: 'and third', speaker: 2, isFinal: true },
      ],
    });
    expect(cleaned.structured).toHaveLength(2);
    expect(cleaned.structured[0]?.text).toBe('First and second');
    expect(cleaned.structured[0]?.speaker).toBe('CLINICIAN');
    expect(cleaned.structured[1]?.text).toBe('and third');
    expect(cleaned.structured[1]?.speaker).toBe('PATIENT');
  });

  it('maps Soniox speaker integers to roles', () => {
    const cleaned = cleanRealtimeTranscript({
      segments: [
        { id: '1', text: 'a', speaker: 1, isFinal: true },
        { id: '2', text: 'b', speaker: 2, isFinal: true },
        { id: '3', text: 'c', speaker: 3, isFinal: true },
        { id: '4', text: 'd', speaker: null, isFinal: true },
      ],
    });
    const roles = cleaned.structured.map((s) => s.speaker);
    expect(roles).toEqual(['CLINICIAN', 'PATIENT', 'OTHER', 'OTHER']);
  });

  it('reports word + speaker counts', () => {
    const cleaned = cleanRealtimeTranscript({
      segments: [
        { id: '1', text: 'hello there friend', speaker: 1, isFinal: true },
        { id: '2', text: 'hi', speaker: 2, isFinal: true },
      ],
    });
    expect(cleaned.wordCount).toBe(4);
    expect(cleaned.speakerCount).toBe(2);
  });

  it('normalizes whitespace runs', () => {
    const cleaned = cleanRealtimeTranscript({
      segments: [{ id: '1', text: '  hello\n\tworld  ', speaker: 1, isFinal: true }],
    });
    expect(cleaned.structured[0]?.text).toBe('hello world');
  });
});

describe('cleanBatchTranscript', () => {
  it('uses provided duration_ms when present', () => {
    const cleaned = cleanBatchTranscript({
      tokens: [
        { text: 'hello', speaker: 1, start_ms: 0, end_ms: 1000, is_final: true },
        { text: 'world', speaker: 1, start_ms: 1100, end_ms: 1500, is_final: true },
      ],
      duration_ms: 12345,
    });
    expect(cleaned.durationMs).toBe(12345);
    expect(cleaned.source).toBe('batch');
    expect(cleaned.structured[0]?.text).toBe('hello world');
  });

  it('falls back to max endMs when duration_ms missing', () => {
    const cleaned = cleanBatchTranscript({
      tokens: [
        { text: 'hello', speaker: 1, start_ms: 0, end_ms: 1000, is_final: true },
        { text: 'world', speaker: 2, start_ms: 1100, end_ms: 1500, is_final: true },
      ],
    });
    expect(cleaned.durationMs).toBe(1500);
  });
});

describe('cleanPastedTranscript', () => {
  it('produces a single OTHER-speaker segment', () => {
    const cleaned = cleanPastedTranscript({
      source: 'pasted',
      text: '  Patient   reports   knee pain.  ',
    });
    expect(cleaned.source).toBe('pasted');
    expect(cleaned.structured).toHaveLength(1);
    expect(cleaned.structured[0]?.text).toBe('Patient reports knee pain.');
    expect(cleaned.structured[0]?.speaker).toBe('OTHER');
    expect(cleaned.speakerCount).toBe(1);
    expect(cleaned.wordCount).toBe(4);
  });

  it('returns empty structured for empty text', () => {
    const cleaned = cleanPastedTranscript({ source: 'pasted', text: '   ' });
    expect(cleaned.structured).toEqual([]);
    expect(cleaned.speakerCount).toBe(0);
  });
});
