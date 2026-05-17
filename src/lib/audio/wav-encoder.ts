/**
 * WAV encoder — concatenates Int16 PCM chunks and prepends a RIFF/WAVE
 * header. Used by both the in-person capture flow (Unit 03) and the
 * telehealth clinician room (Unit 17). The S3 layer just stores bytes;
 * the downstream Soniox batch path expects a WAV file, so the encoder's
 * shape is contract.
 *
 * Locked at PCM Int16, mono, 16 kHz — matches Soniox config
 * (rule 12 in CLAUDE.md). Don't parametrize until there's a real second
 * caller with different needs.
 */

export function encodeWavBlob(chunks: Int16Array[], sampleRate: number): Blob {
  const totalSamples = chunks.reduce((acc, c) => acc + c.length, 0);
  const merged = new Int16Array(totalSamples);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  const dataBytes = merged.byteLength;
  const headerBytes = 44;
  const buffer = new ArrayBuffer(headerBytes + dataBytes);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, headerBytes + dataBytes - 8, true);
  writeString(view, 8, 'WAVE');
  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  // PCM samples
  new Int16Array(buffer, headerBytes).set(merged);

  return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}
