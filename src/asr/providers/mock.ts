import type { ProviderRequest, TranscriptWord, TranscriptionProvider } from '../types';

/**
 * A provider that replays a canned transcript. No network, no credential.
 *
 * This is what makes the deterministic half of the pipeline testable and
 * demonstrable end-to-end: given a fixed transcript, every stage after ASR
 * must produce a byte-identical result on every run and every machine.
 */
export function mockProvider(canned: {
  text: string;
  words: TranscriptWord[];
}): TranscriptionProvider {
  return {
    id: 'mock',
    credentialEnvVar: 'NONE_REQUIRED',
    buildRequest(): ProviderRequest {
      return {
        method: 'POST',
        url: 'mock://transcribe',
        headers: {},
        body: JSON.stringify(canned),
      };
    },
    normalize() {
      return canned;
    },
  };
}

/**
 * Builds plausible word timings/confidences for a transcript string, so mock
 * runs exercise the same confidence-attribution code path as real ASR.
 * Deterministic: the same text always yields the same numbers.
 */
export function syntheticWords(
  text: string,
  opts: { wordsPerSecond?: number; confidence?: (word: string, i: number) => number } = {},
): TranscriptWord[] {
  const wps = opts.wordsPerSecond ?? 2.5;
  const conf = opts.confidence ?? (() => 0.94);
  const pieces = text.split(/\s+/).filter((w) => w.length > 0);
  return pieces.map((word, i) => ({
    text: word,
    start: Number((i / wps).toFixed(3)),
    end: Number(((i + 1) / wps).toFixed(3)),
    confidence: Number(conf(word, i).toFixed(3)),
  }));
}
