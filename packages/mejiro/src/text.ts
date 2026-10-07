import { isLineEndProhibited, isLineStartProhibited } from './kinsoku.js';

/** CJK Compatibility Ideographs and their supplement, which NFC maps to other glyphs. */
const COMPATIBILITY_IDEOGRAPH = /[\uF900-\uFAFF\u{2F800}-\u{2FA1F}]/u;
const COMPATIBILITY_IDEOGRAPH_RUN = /([\uF900-\uFAFF\u{2F800}-\u{2FA1F}]+)/u;

/**
 * Normalizes text to NFC before codepoint-based layout.
 *
 * Mejiro's public offsets are NFC Unicode codepoint offsets. This keeps
 * decomposed input such as `か\u3099` aligned with the same rendered character
 * as precomposed `が`. CJK compatibility ideographs (U+F900–FAFF,
 * U+2F800–2FA1F) are kept as written: NFC would replace each with a unified
 * ideograph of a different glyph, losing a deliberate glyph choice.
 */
export function normalizeText(str: string): string {
  if (!COMPATIBILITY_IDEOGRAPH.test(str)) return str.normalize('NFC');
  // Odd split indices are the captured ideograph runs; nothing composes across them.
  return str
    .split(COMPATIBILITY_IDEOGRAPH_RUN)
    .map((part, i) => (i % 2 === 1 ? part : part.normalize('NFC')))
    .join('');
}

/**
 * Converts a string to a Uint32Array of NFC-normalized Unicode codepoints.
 *
 * This is the recommended way to prepare text input for {@link computeBreaks},
 * which requires a `Uint32Array` of codepoints.
 *
 * @param str - Input string.
 * @returns Uint32Array of Unicode codepoints.
 */
export function toCodepoints(str: string): Uint32Array {
  const cps: number[] = [];
  for (const ch of normalizeText(str)) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined) cps.push(cp);
  }
  return new Uint32Array(cps);
}

/**
 * Adds natural line breaks around Japanese dialogue quotes.
 *
 * This is a manuscript-editing helper, not an EPUB-specific transform. It
 * normalizes CRLF to LF, inserts a break before opening quotes and after
 * closing quotes when they are attached to surrounding prose, trims whitespace
 * around inserted breaks, and avoids creating more than one blank line. No
 * break is inserted where it would leave a line-start-prohibited character
 * (`、`, `）`, …) at the start of a line or a line-end-prohibited one (`（`, …)
 * at the end of one.
 *
 * @param text - Japanese prose manuscript text.
 * @returns Text with dialogue quotes separated onto their own lines.
 */
export function formatDialogueLineBreaks(text: string): string {
  const chars = [...text.replace(/\r\n?/gu, '\n')];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    if (i > 0 && (opensDialogueAt(chars, i) || closesDialogueAt(chars, i))) out += '\n';
    out += chars[i];
  }
  return out.replace(/[ \t　]*\n[ \t　]*/gu, '\n').replace(/\n{3,}/gu, '\n\n');
}

const OPENING_QUOTES = new Set(['「', '『']);
const CLOSING_QUOTES = new Set(['」', '』']);
const isInlineSpace = (ch: string): boolean => ch === ' ' || ch === '\t' || ch === '　';

/** Whether a break belongs before the opening quote at `i`, after attached prose. */
function opensDialogueAt(chars: readonly string[], i: number): boolean {
  const prev = chars[i - 1];
  if (!OPENING_QUOTES.has(chars[i]) || prev === '\n' || OPENING_QUOTES.has(prev)) return false;
  // Whitespace before the break is trimmed, so the line ends at the last visible character.
  let j = i - 1;
  while (j > 0 && isInlineSpace(chars[j])) j--;
  return !isLineEndProhibited(chars[j].codePointAt(0) ?? 0);
}

/** Whether a break belongs after the closing quote before `i`, before attached prose. */
function closesDialogueAt(chars: readonly string[], i: number): boolean {
  const next = chars[i];
  if (!CLOSING_QUOTES.has(chars[i - 1]) || next === '\n' || CLOSING_QUOTES.has(next)) return false;
  // Whitespace after the break is trimmed, so the line starts at the next visible character.
  let j = i;
  while (j < chars.length - 1 && isInlineSpace(chars[j])) j++;
  return !isLineStartProhibited(chars[j].codePointAt(0) ?? 0);
}
