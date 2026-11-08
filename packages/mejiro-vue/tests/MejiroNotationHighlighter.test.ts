// @vitest-environment happy-dom

import { fireEvent, render } from '@testing-library/vue';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { MejiroNotationHighlighter } from '../src/MejiroNotationHighlighter.js';

function makeHarness(initial = '', normalize: (next: string) => string = (next) => next) {
  return defineComponent({
    setup() {
      const value = ref(initial);
      return () =>
        h(MejiroNotationHighlighter, {
          value: value.value,
          'onUpdate:value': (next: string) => {
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

describe('MejiroNotationHighlighter (Vue)', () => {
  it('passes attrs and listeners through to the textarea and wrapper props to the wrapper', () => {
    const onFocus = vi.fn();
    const onInput = vi.fn();
    const { container } = render(MejiroNotationHighlighter, {
      props: { value: '本文', wrapperClass: 'outer', wrapperStyle: { width: '240px' } },
      attrs: {
        class: 'from-attrs',
        placeholder: 'write here',
        rows: 7,
        maxlength: 12,
        'aria-label': 'draft body',
        onFocus,
        onInput,
      },
    });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

    const wrapper = container.querySelector('.mejiro-notation-highlighter') as HTMLElement;
    expect(wrapper.classList.contains('outer')).toBe(true);
    expect(wrapper.style.width).toBe('240px');
    expect(wrapper.classList.contains('from-attrs')).toBe(false);
    expect(textarea.classList.contains('mejiro-notation-textarea')).toBe(true);
    expect(textarea.classList.contains('from-attrs')).toBe(true);
    expect(textarea.getAttribute('placeholder')).toBe('write here');
    expect(textarea.getAttribute('rows')).toBe('7');
    expect(textarea.maxLength).toBe(12);
    expect(textarea.getAttribute('aria-label')).toBe('draft body');

    textarea.dispatchEvent(new Event('focus', { bubbles: true }));
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onInput).toHaveBeenCalledTimes(1);
  });
});
