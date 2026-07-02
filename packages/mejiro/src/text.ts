/**
 * Normalizes text to NFC before codepoint-based layout.
 *
 * Mejiro's public offsets are NFC Unicode codepoint offsets. This keeps
 * decomposed input such as `か\u3099` aligned with the same rendered character
 * as precomposed `が`.
 */
export function normalizeText(str: string): string {
  return str.normalize('NFC');
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
 * around inserted breaks, and avoids creating more than one blank line.
 *
 * @param text - Japanese prose manuscript text.
 * @returns Text with dialogue quotes separated onto their own lines.
 */
export function formatDialogueLineBreaks(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .replace(/([^\n「『])([「『])/gu, '$1\n$2')
    .replace(/([」』])([^」』\n])/gu, '$1\n$2')
    .replace(/[ \t　]*\n[ \t　]*/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n');
}
