// PCM AudioWorkletProcessor — 16,000 Hz mono Int16 LE samples.
// Anti-regression rule 12: format is locked. Soniox real-time config expects
// pcm_s16le; any change here silently breaks downstream handling.
//
// posts { samples, rmsLevel } per processing block. The browser glue
// (useRealtimeTranscription) pumps `samples.buffer` to the Soniox WS and
// surfaces `rmsLevel` to the AudioLevelBars VU meter.

class PcmWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    const samples = new Int16Array(input.length);
    let sumSquares = 0;
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      samples[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      sumSquares += s * s;
    }
    const rmsLevel = Math.sqrt(sumSquares / input.length);

    // Transfer ownership of the underlying buffer to avoid a copy.
    this.port.postMessage({ samples, rmsLevel }, [samples.buffer]);
    return true;
  }
}

registerProcessor('pcm-worklet', PcmWorklet);
