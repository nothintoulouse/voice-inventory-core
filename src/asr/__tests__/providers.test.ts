import { describe, expect, it } from 'vitest';
import { deepgramProvider, extractDeepgramWords } from '../providers/deepgram';
import {
  assemblyaiProvider,
  buildAssemblyAiBody,
  extractAssemblyAiWords,
} from '../providers/assemblyai';
import { mockProvider, syntheticWords } from '../providers/mock';
import { fixtureTransport, transcribe } from '../transcribe';
import { DEMO_ASSEMBLYAI_RESPONSE, DEMO_DEEPGRAM_RESPONSE } from '@/fixtures/transcript';

const AUDIO = { bytes: new Uint8Array([1, 2, 3]), mediaType: 'audio/mp4' };
const MOCK_KEY = 'MOCK_API_KEY_NOT_A_REAL_CREDENTIAL';

describe('deepgram adapter: request', () => {
  const req = deepgramProvider.buildRequest({
    audio: AUDIO,
    seedTerms: ['verano amaro', 'harbor one oh seven'],
    apiKey: MOCK_KEY,
  });
  const url = new URL(req.url);

  it('sends one keyterm param per term so multi-word phrases stay intact', () => {
    expect(url.searchParams.getAll('keyterm')).toEqual([
      'verano amaro',
      'harbor one oh seven',
    ]);
  });

  it('enables numerals and smart formatting', () => {
    expect(url.searchParams.get('numerals')).toBe('true');
    expect(url.searchParams.get('smart_format')).toBe('true');
  });

  it('sets content-type from the caller rather than sniffing the bytes', () => {
    expect(req.headers['content-type']).toBe('audio/mp4');
  });

  it('carries the credential in the authorization header only', () => {
    expect(req.headers.authorization).toBe(`Token ${MOCK_KEY}`);
    expect(req.url).not.toContain(MOCK_KEY);
  });

  it('uploads the audio bytes as the body', () => {
    expect(req.body).toBe(AUDIO.bytes);
  });
});

describe('deepgram adapter: normalization', () => {
  it('prefers the smart-formatted punctuated word and keeps confidence', () => {
    const words = extractDeepgramWords({
      results: {
        channels: [
          {
            alternatives: [
              {
                words: [
                  { word: 'six', punctuated_word: 'six.', start: 1, end: 1.4, confidence: 0.81 },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(words).toEqual([{ text: 'six.', start: 1, end: 1.4, confidence: 0.81 }]);
  });

  it('defaults confidence to 0.9 when the provider omits it', () => {
    const words = extractDeepgramWords({
      results: {
        channels: [{ alternatives: [{ words: [{ word: 'half', start: 0, end: 0.5 }] }] }],
      },
    });
    expect(words![0].confidence).toBe(0.9);
  });

  it('returns null on a malformed body instead of guessing', () => {
    expect(extractDeepgramWords(null)).toBeNull();
    expect(extractDeepgramWords({ results: {} })).toBeNull();
    expect(
      extractDeepgramWords({
        results: { channels: [{ alternatives: [{ words: [{ word: 'x' }] }] }] },
      }),
    ).toBeNull();
  });

  it('normalizes the recorded-shape fixture response', () => {
    const { text, words } = deepgramProvider.normalize(DEMO_DEEPGRAM_RESPONSE);
    expect(text).toContain('Nordvale Reserve');
    expect(words.length).toBeGreaterThan(40);
    expect(words.every((w) => w.confidence > 0 && w.confidence <= 1)).toBe(true);
  });
});

describe('assemblyai adapter', () => {
  it('puts seed terms in the JSON body as keyterms_prompt', () => {
    const body = JSON.parse(buildAssemblyAiBody(['verano amaro'], 'https://example.invalid/a'));
    expect(body.keyterms_prompt).toEqual(['verano amaro']);
  });

  it('omits keyterms_prompt entirely when there are no seed terms', () => {
    const body = JSON.parse(buildAssemblyAiBody([], 'https://example.invalid/a'));
    expect(body).not.toHaveProperty('keyterms_prompt');
  });

  it('sends speech_models (plural) with a keyterm-capable fallback', () => {
    const body = JSON.parse(buildAssemblyAiBody([], 'https://example.invalid/a'));
    expect(body.speech_models).toEqual(['universal-3-pro', 'universal-2']);
    expect(body).not.toHaveProperty('speech_model');
  });

  it('converts millisecond word timings to seconds', () => {
    const words = extractAssemblyAiWords({
      words: [{ text: 'half', start: 1500, end: 2000, confidence: 0.88 }],
    });
    expect(words).toEqual([{ text: 'half', start: 1.5, end: 2, confidence: 0.88 }]);
  });

  it('returns null on a malformed body', () => {
    expect(extractAssemblyAiWords({ words: [{ text: 'x' }] })).toBeNull();
    expect(extractAssemblyAiWords('nope')).toBeNull();
  });
});

describe('cross-provider normalization', () => {
  it('produces the same normalized transcript from either provider fixture', async () => {
    const dg = await transcribe({
      provider: deepgramProvider,
      audio: AUDIO,
      seedTerms: [],
      transport: fixtureTransport(DEMO_DEEPGRAM_RESPONSE),
    });
    const aai = await transcribe({
      provider: assemblyaiProvider,
      audio: AUDIO,
      seedTerms: [],
      transport: fixtureTransport(DEMO_ASSEMBLYAI_RESPONSE),
    });

    expect(aai.text).toBe(dg.text);
    expect(aai.words.length).toBe(dg.words.length);
    // Millisecond→second conversion must land within rounding distance.
    for (let i = 0; i < dg.words.length; i++) {
      expect(aai.words[i].start).toBeCloseTo(dg.words[i].start, 2);
      expect(aai.words[i].text).toBe(dg.words[i].text);
    }
  });
});

describe('transcribe', () => {
  it('applies the provider seed-term cap and reports what was actually sent', async () => {
    const terms = Array.from({ length: 600 }, (_, i) => `w${i}`);
    const result = await transcribe({
      provider: deepgramProvider,
      audio: AUDIO,
      seedTerms: terms,
      transport: fixtureTransport(DEMO_DEEPGRAM_RESPONSE),
    });
    expect(result.seedTermCount).toBe(500);
  });

  it('needs no credential and no network for the mock provider', async () => {
    const canned = { text: 'wenlock’s half', words: syntheticWords("wenlock's half") };
    const result = await transcribe({
      provider: mockProvider(canned),
      audio: AUDIO,
      seedTerms: ['anything'],
      transport: fixtureTransport(canned),
    });
    expect(result.provider).toBe('mock');
    expect(result.text).toBe(canned.text);
    expect(result.seedTermCount).toBe(1);
  });

  it('produces deterministic synthetic word timings', () => {
    expect(syntheticWords('a b c')).toEqual(syntheticWords('a b c'));
    expect(syntheticWords('a b c')[1]).toEqual({
      text: 'b',
      start: 0.4,
      end: 0.8,
      confidence: 0.94,
    });
  });
});
