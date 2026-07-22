export { tokenize, parseSpokenInteger, parseSpokenDecimal } from './tokens';
export type { Token, SpokenNumber } from './tokens';
export { parseCountExpr, defaultGrammarConfig } from './count-expr';
export type { GrammarConfig, CountValue, CountParse, CountFlag } from './count-expr';
export { parseLine } from './parse';
export type { ParsedLine, LineFlag } from './parse';
export { segmentTranscript } from './segment';

import { GrammarConfig, defaultGrammarConfig } from './count-expr';
import { ParsedLine, parseLine } from './parse';
import { segmentTranscript } from './segment';

/** Transcript text → structured count lines. The deterministic front half of the pipeline. */
export function parseTranscript(
  text: string,
  config: GrammarConfig = defaultGrammarConfig,
): ParsedLine[] {
  return segmentTranscript(text, config).map((line) => parseLine(line, config));
}
