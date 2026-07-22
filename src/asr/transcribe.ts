import { prepareSeedTerms } from './seed-terms';
import type {
  AudioInput,
  NormalizedTranscript,
  SeedingProviderId,
  TranscriptionProvider,
} from './types';

/** Injected HTTP transport. Tests and the demo pass a fake; production passes `fetch`. */
export type Transport = (req: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Uint8Array | string;
}) => Promise<unknown>;

/** The default transport: a real HTTP round trip returning parsed JSON. */
export const httpTransport: Transport = async (req) => {
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body as BodyInit,
  });
  if (!res.ok) throw new Error(`${req.url} responded ${res.status}`);
  return res.json();
};

/** A transport that never touches the network — returns a fixed response body. */
export function fixtureTransport(response: unknown): Transport {
  return async () => response;
}

/**
 * Transcribes audio through any provider adapter.
 *
 * The seed-term cap is applied here rather than inside each adapter so that
 * `seedTermCount` reported on the transcript is always the number of terms
 * that actually reached the provider — the eval numbers depend on that being
 * true.
 */
export async function transcribe(opts: {
  provider: TranscriptionProvider;
  audio: AudioInput;
  seedTerms: string[];
  apiKey?: string;
  transport?: Transport;
}): Promise<NormalizedTranscript> {
  const capped =
    opts.provider.id === 'mock'
      ? opts.seedTerms
      : prepareSeedTerms(opts.seedTerms, opts.provider.id as SeedingProviderId);

  const request = opts.provider.buildRequest({
    audio: opts.audio,
    seedTerms: capped,
    apiKey: opts.apiKey ?? 'MOCK_API_KEY',
  });

  const transport = opts.transport ?? httpTransport;
  const startedAt = Date.now();
  const body = await transport(request);
  const latencyMs = Date.now() - startedAt;

  const { text, words } = opts.provider.normalize(body);
  return {
    provider: opts.provider.id,
    text,
    words,
    latencyMs,
    seedTermCount: capped.length,
  };
}
