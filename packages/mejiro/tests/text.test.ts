import { describe, expect, it } from 'vitest';
import { isLineEndProhibited, isLineStartProhibited } from '../src/kinsoku.js';
import { normalizeAnnotatedText } from '../src/normalize.js';
import { formatDialogueLineBreaks, normalizeText, toCodepoints } from '../src/text.js';

describe('normalizeText / toCodepoints', () => {
  it('normalizes decomposed text to NFC before codepoint conversion', () => {
    const decomposed = 'か\u3099';

    expect(normalizeText(decomposed)).toBe('が');
    expect([...toCodepoints(decomposed)]).toEqual(['が'.codePointAt(0)]);
  });

  it('keeps CJK compatibility ideographs as written', () => {
    // 神 U+FA19 and 塚 U+FA10 would fold to U+795E / U+585A under plain NFC; U+2F8A6 is from the supplement.
    const name = '\u{FA19}\u{FA10}\u{2F8A6}';
    expect(normalizeText(name)).toBe(name);
    expect([...toCodepoints(`か\u3099${name}は\u3099`)]).toEqual([
      0x304c, 0xfa19, 0xfa10, 0x2f8a6, 0x3070,
    ]);
  });

  it('keeps compatibility ideographs through normalizeAnnotatedText with indices intact', () => {
    const result = normalizeAnnotatedText('か\u3099\u{FA19}社', [
      { kind: 'ruby', startIndex: 2, endIndex: 3, rubyText: 'かみ', type: 'mono' },
    ]);
    expect(result.text).toBe('が\u{FA19}社');
    expect(result.inlineAnnotations[0]).toMatchObject({ startIndex: 1, endIndex: 2 });
  });

  it('preserves variation selectors and zwj emoji as explicit codepoints', () => {
    expect([...toCodepoints('葛\u{e0100}')]).toEqual([0x845b, 0xe0100]);
    expect([...toCodepoints('👨‍👩‍👧‍👦')]).toEqual([
      0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466,
    ]);
  });
});

describe('formatDialogueLineBreaks', () => {
  it('separates dialogue from surrounding prose', () => {
    expect(formatDialogueLineBreaks('彼は言った。「こんにちは」私はうなずいた。')).toBe(
      '彼は言った。\n「こんにちは」\n私はうなずいた。',
    );
  });

  it('preserves already separated dialogue lines', () => {
    expect(formatDialogueLineBreaks('彼は言った。\n「こんにちは」\n私はうなずいた。')).toBe(
      '彼は言った。\n「こんにちは」\n私はうなずいた。',
    );
  });

  it('handles Japanese double quotes', () => {
    expect(formatDialogueLineBreaks('彼は『そうだ』と答えた。')).toBe(
      '彼は\n『そうだ』\nと答えた。',
    );
  });

  it('normalizes whitespace around inserted breaks without creating extra blank lines', () => {
    expect(
      formatDialogueLineBreaks('彼は言った。　「こんにちは」   私はうなずいた。\n\n\n次。'),
    ).toBe('彼は言った。\n「こんにちは」\n私はうなずいた。\n\n次。');
  });

  it('inserts no break that leaves a kinsoku-prohibited character at a line edge', () => {
    const inputs = [
      '「はい」、と彼は言った。（「いいえ」）',
      '「はい」　。と言った。',
      '彼は（　「そう」）と言った。',
      '「ええ」…と言った。彼は「はい」と言った。',
    ];
    // The inputs hold no line feeds, so every line edge in the output is an inserted break.
    for (const input of inputs) {
      const output = formatDialogueLineBreaks(input);
      const lines = output.split('\n');
      for (const line of lines.slice(1)) {
        expect(isLineStartProhibited(line.codePointAt(0) ?? 0), `${input} -> ${line}`).toBe(false);
      }
      for (const line of lines.slice(0, -1)) {
        const last = [...line].at(-1)?.codePointAt(0) ?? 0;
        expect(isLineEndProhibited(last), `${input} -> ${line}`).toBe(false);
      }
      expect(formatDialogueLineBreaks(output)).toBe(output);
    }
    expect(formatDialogueLineBreaks('「はい」、と彼は言った。（「いいえ」）')).toBe(
      '「はい」、と彼は言った。（「いいえ」）',
    );
    expect(formatDialogueLineBreaks('「ええ」…と言った。彼は「はい」と言った。')).toBe(
      '「ええ」…と言った。彼は\n「はい」\nと言った。',
    );
  });
});
