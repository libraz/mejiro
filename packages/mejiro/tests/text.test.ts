import { describe, expect, it } from 'vitest';
import { formatDialogueLineBreaks } from '../src/text.js';

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
});
