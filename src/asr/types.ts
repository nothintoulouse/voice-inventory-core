/**
 * Provider-neutral transcription contract.
 *
 * Everything downstream of this file is deterministic. Everything upstream of
 * it (the acoustic model) is probabilistic and is treated as an untrusted
 * input: the pipeline consumes only `NormalizedTranscript` and never a
 * provider-specific response shape.
 */

export type AsrProviderId = 'assemblyai' | 'deepgram' | 'mock';

/** Providers that apply real vocabulary-seeding caps. */
export type SeedingProviderId = 'assemblyai' | 'deepgram';

export type TranscriptWord = {
  text: string;
  /** Seconds from the start of the audio. */
  start: number;
  /** Seconds from the start of the audio. */
  end: number;
  /** 0–1. Defaults to 0.9 when the provider omits per-word confidence. */
  confidence: number;
};

export type NormalizedTranscript = {
  provider: string;
  text: string;
  words: TranscriptWord[];
  latencyMs: number;
  seedTermCount: number;
};

/** Audio handed to a provider adapter. */
export type AudioInput = {
  bytes: Uint8Array;
  /** e.g. "audio/mp4", "audio/wav". */
  mediaType: string;
};

/**
 * An HTTP request a provider adapter wants to make, described as data so it
 * can be asserted on in tests without a network or an API key.
 */
export type ProviderRequest = {
  method: 'POST';
  url: string;
  headers: Record<string, string>;
  /** JSON body, or raw audio bytes for providers that accept a binary upload. */
  body: Uint8Array | string;
};

/**
 * A transcription provider, reduced to three pieces:
 *  - `buildRequest` : (audio, seed terms, credential) → request description
 *  - `normalize`    : provider JSON → normalized words/text
 *
 * Splitting it this way is what makes the adapters testable offline: the
 * request builder and the response normalizer are both pure functions, and
 * the only impure part is the `fetch` that `transcribe()` injects.
 */
export type TranscriptionProvider = {
  id: AsrProviderId;
  /** Environment variable that supplies the credential, for documentation. */
  credentialEnvVar: string;
  buildRequest(opts: {
    audio: AudioInput;
    seedTerms: string[];
    apiKey: string;
  }): ProviderRequest;
  normalize(body: unknown): { text: string; words: TranscriptWord[] };
};
