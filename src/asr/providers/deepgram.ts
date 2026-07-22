import type { ProviderRequest, TranscriptWord, TranscriptionProvider } from '../types';

const DEFAULT_CONFIDENCE = 0.9;
const BASE_URL = 'https://api.deepgram.com/v1/listen';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Builds the Deepgram pre-recorded request.
 *
 * Vocabulary seeding uses repeated `keyterm` query params — one per term, so
 * multi-word phrases ("verano amaro") stay intact instead of being split on
 * whitespace. `numerals=true` makes the model emit digits ("0.6") rather than
 * words, which the count grammar handles explicitly on both paths.
 *
 * `content-type` is set from the caller's mediaType rather than sniffed: a
 * Safari-recorded fragmented MP4 is easy to misidentify as audio/wav, and
 * Deepgram will happily transcribe silence out of a mislabelled container.
 */
function buildRequest(opts: {
  audio: { bytes: Uint8Array; mediaType: string };
  seedTerms: string[];
  apiKey: string;
}): ProviderRequest {
  const url = new URL(BASE_URL);
  url.searchParams.set('model', 'nova-3');
  url.searchParams.set('smart_format', 'true');
  url.searchParams.set('numerals', 'true');
  for (const term of opts.seedTerms) url.searchParams.append('keyterm', term);

  return {
    method: 'POST',
    url: url.toString(),
    headers: {
      authorization: `Token ${opts.apiKey}`,
      'content-type': opts.audio.mediaType,
    },
    body: opts.audio.bytes,
  };
}

/**
 * Pulls word-level detail out of the Deepgram response. Prefers the
 * smart-formatted `punctuated_word` over the raw token, and keeps the
 * per-word confidence — that number is the only honest signal the pipeline
 * has about how much to trust a given line.
 */
export function extractDeepgramWords(body: unknown): TranscriptWord[] | null {
  if (!isRecord(body) || !isRecord(body.results)) return null;
  const channel = Array.isArray(body.results.channels) ? body.results.channels[0] : undefined;
  if (!isRecord(channel)) return null;
  const alt = Array.isArray(channel.alternatives) ? channel.alternatives[0] : undefined;
  if (!isRecord(alt) || !Array.isArray(alt.words)) return null;

  const words: TranscriptWord[] = [];
  for (const w of alt.words) {
    if (
      !isRecord(w) ||
      typeof w.word !== 'string' ||
      typeof w.start !== 'number' ||
      typeof w.end !== 'number'
    ) {
      return null;
    }
    words.push({
      text: typeof w.punctuated_word === 'string' ? w.punctuated_word : w.word,
      start: w.start,
      end: w.end,
      confidence: typeof w.confidence === 'number' ? w.confidence : DEFAULT_CONFIDENCE,
    });
  }
  return words;
}

function extractDeepgramText(body: unknown): string {
  if (!isRecord(body) || !isRecord(body.results)) return '';
  const channel = Array.isArray(body.results.channels) ? body.results.channels[0] : undefined;
  if (!isRecord(channel)) return '';
  const alt = Array.isArray(channel.alternatives) ? channel.alternatives[0] : undefined;
  if (!isRecord(alt) || typeof alt.transcript !== 'string') return '';
  return alt.transcript;
}

export const deepgramProvider: TranscriptionProvider = {
  id: 'deepgram',
  credentialEnvVar: 'DEEPGRAM_API_KEY',
  buildRequest,
  normalize(body) {
    const words = extractDeepgramWords(body) ?? [];
    const text = extractDeepgramText(body);
    return { text, words };
  },
};
