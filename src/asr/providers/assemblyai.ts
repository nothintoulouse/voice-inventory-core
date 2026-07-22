import type { ProviderRequest, TranscriptWord, TranscriptionProvider } from '../types';

const DEFAULT_CONFIDENCE = 0.9;
const BASE_URL = 'https://api.assemblyai.com/v2/transcript';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Builds the AssemblyAI transcript request.
 *
 * Two things differ from Deepgram and both are load-bearing:
 *  1. Seeding is a JSON body field (`keyterms_prompt`), not a query param.
 *  2. The audio is referenced by URL, not uploaded inline, so the caller
 *     supplies an already-hosted `audioUrl`. For the offline adapter shape we
 *     encode the audio as a placeholder URL and never dereference it.
 *
 * `speech_models` (plural) is sent rather than the older singular
 * `speech_model`; the fallback ordering keeps a keyterm-capable model in
 * second position so seeding never silently degrades.
 */
export function buildAssemblyAiBody(seedTerms: string[], audioUrl: string): string {
  const body: Record<string, unknown> = {
    audio_url: audioUrl,
    speech_models: ['universal-3-pro', 'universal-2'],
    punctuate: true,
    format_text: true,
  };
  if (seedTerms.length > 0) body.keyterms_prompt = seedTerms;
  return JSON.stringify(body);
}

function buildRequest(opts: {
  audio: { bytes: Uint8Array; mediaType: string };
  seedTerms: string[];
  apiKey: string;
  audioUrl?: string;
}): ProviderRequest {
  return {
    method: 'POST',
    url: BASE_URL,
    headers: {
      authorization: opts.apiKey,
      'content-type': 'application/json',
    },
    body: buildAssemblyAiBody(opts.seedTerms, opts.audioUrl ?? 'https://example.invalid/audio'),
  };
}

/**
 * AssemblyAI reports word timings in MILLISECONDS. Normalizing to seconds
 * here is the whole reason a provider-neutral transcript type exists — a unit
 * mismatch this quiet is exactly the kind of bug that only shows up as
 * nonsense confidence attribution three stages downstream.
 */
export function extractAssemblyAiWords(body: unknown): TranscriptWord[] | null {
  if (!isRecord(body) || !Array.isArray(body.words)) return null;
  const words: TranscriptWord[] = [];
  for (const w of body.words) {
    if (
      !isRecord(w) ||
      typeof w.text !== 'string' ||
      typeof w.start !== 'number' ||
      typeof w.end !== 'number'
    ) {
      return null;
    }
    words.push({
      text: w.text,
      start: w.start / 1000,
      end: w.end / 1000,
      confidence: typeof w.confidence === 'number' ? w.confidence : DEFAULT_CONFIDENCE,
    });
  }
  return words;
}

export const assemblyaiProvider: TranscriptionProvider = {
  id: 'assemblyai',
  credentialEnvVar: 'ASSEMBLYAI_API_KEY',
  buildRequest,
  normalize(body) {
    const words = extractAssemblyAiWords(body) ?? [];
    const text = isRecord(body) && typeof body.text === 'string' ? body.text : '';
    return { text, words };
  },
};
