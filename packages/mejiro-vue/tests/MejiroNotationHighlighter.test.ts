// @vitest-environment happy-dom

import { fireEvent, render } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { MejiroNotationHighlighter } from '../src/MejiroNotationHighlighter.js';

function makeHarness(initial = '', normalize: (next: string) => string = (next) => next) {
  return defineComponent({
    setup() {
      const value = ref(initial);
      return () =>
        h(MejiroNotationHighlighter, {
          modelValue: value.value,
          'onUpdate:modelValue': (next: string) => {
            value.value = normalize(next);
          },
        });
    },
  });
}

describe('MejiroNotationHighlighter (Vue)', () => {
  it('renders the textarea + an overlay', () => {
    const { container } = render(makeHarness('本文'));
    expect(container.querySelector('.mejiro-notation-textarea')).not.toBeNull();
    expect(container.querySelector('.mejiro-notation-overlay')).not.toBeNull();
  });

  it('highlights ruby tokens with the corresponding data-token attribute', () => {
    const { container } = render(makeHarness('文字｜漢字《かんじ》です'));
    const rubyTokens = container.querySelectorAll('[data-token="ruby"]');
    expect(rubyTokens.length).toBe(1);
    expect(rubyTokens[0].textContent).toBe('｜漢字《かんじ》');
  });

  it('updates highlights on user input', async () => {
    const { container } = render(makeHarness());
    const ta = container.querySelector('.mejiro-notation-textarea') as HTMLTextAreaElement;
    await fireEvent.update(ta, '《《圏点》》');
    expect(container.querySelector('[data-token="emphasis"]')?.textContent).toBe('《《圏点》》');
  });

  it('keeps the previous highlight overlay during IME composition', async () => {
    const { container } = render(makeHarness());
    const ta = container.querySelector('.mejiro-notation-textarea') as HTMLTextAreaElement;

    await fireEvent.compositionStart(ta);
    await fireEvent.update(ta, '《《圏点》》');
    expect(container.querySelector('[data-token="emphasis"]')).toBeNull();

    await fireEvent.compositionEnd(ta);
    expect(container.querySelector('[data-token="emphasis"]')?.textContent).toBe('《《圏点》》');
  });

  it('does not rewrite the textarea value while composing when the host normalizes it', async () => {
    const { container } = render(makeHarness('', (next) => next.replace(/けん/g, '圏')));
    const ta = container.querySelector('.mejiro-notation-textarea') as HTMLTextAreaElement;

    await fireEvent.compositionStart(ta);
    await fireEvent.update(ta, 'けん');
    expect(ta.value).toBe('けん');

    await fireEvent.compositionEnd(ta);
    expect(ta.value).toBe('圏');
  });
});
