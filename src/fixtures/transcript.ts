import { syntheticWords } from '@/asr/providers/mock';
import type { TranscriptWord } from '@/asr/types';

/**
 * A synthetic count narration, written to exercise every branch of the
 * grammar and the review logic. All product names are invented.
 *
 * The text is written the way smart-formatted cloud ASR actually returns it —
 * sentence punctuation present, digits where the model chose digits, and one
 * deliberate mishearing ("leader" for "liter", which both providers produced
 * on the real first end-to-end run).
 */
export const DEMO_TRANSCRIPT_TEXT = [
  "Marlo's seven fifty point six.",
  'Nordvale Reserve one leader full.',
  'Thornbury Dry point three.',
  "Wenlock's half.",
  "Fowler's Mark one full and point four.",
  'Harbor one oh seven point four.',
  'Solara not here.',
  'Verano Amaro half, flag this.',
  "Plus point two Fowler's.",
  'Bison Creek case plus three.',
  "Wenlock's point two.",
].join(' ');

/**
 * Per-word confidences. Deliberately lowered on the two words the acoustic
 * model would plausibly struggle with, so the ASR component of the composite
 * score is not a constant.
 */
const LOW_CONFIDENCE_WORDS = new Set(['leader', 'verano', 'amaro', 'harbor']);

export const DEMO_TRANSCRIPT_WORDS: TranscriptWord[] = syntheticWords(DEMO_TRANSCRIPT_TEXT, {
  confidence: (word) =>
    LOW_CONFIDENCE_WORDS.has(word.toLowerCase().replace(/[^a-z']/g, '')) ? 0.71 : 0.96,
});

/**
 * A recorded-shape Deepgram response body wrapping the same transcript. The
 * numbers are synthetic; the SHAPE is what the adapter is tested against.
 */
export const DEMO_DEEPGRAM_RESPONSE = {
  metadata: { request_id: '00000000-0000-0000-0000-000000000000', model_info: {} },
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: DEMO_TRANSCRIPT_TEXT,
            confidence: 0.94,
            words: DEMO_TRANSCRIPT_WORDS.map((w) => ({
              word: w.text.toLowerCase().replace(/[^a-z0-9'.]/g, ''),
              punctuated_word: w.text,
              start: w.start,
              end: w.end,
              confidence: w.confidence,
            })),
          },
        ],
      },
    ],
  },
};

/** A recorded-shape AssemblyAI response body. Note: word timings in MILLISECONDS. */
export const DEMO_ASSEMBLYAI_RESPONSE = {
  id: '00000000-0000-0000-0000-000000000000',
  status: 'completed',
  text: DEMO_TRANSCRIPT_TEXT,
  words: DEMO_TRANSCRIPT_WORDS.map((w) => ({
    text: w.text,
    start: Math.round(w.start * 1000),
    end: Math.round(w.end * 1000),
    confidence: w.confidence,
  })),
};
