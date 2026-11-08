// @vitest-environment happy-dom

import { fireEvent, render } from '@testing-library/vue';
import { describe, expect, it, vi } from 'vitest';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { MejiroNotationHighlighter } from '../src/MejiroNotationHighlighter.js';

describe('MejiroNotationHighlighter (Vue) — value binding', () => {
  it('binds the source text through v-model:value', async () => {
    const onUpdate = vi.fn();
    const { container } = render(MejiroNotationHighlighter, {
      props: { value: '｜漢字《かんじ》', 'onUpdate:value': onUpdate },
    });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('｜漢字《かんじ》');
    expect(container.querySelector('[data-token="ruby"]')?.textContent).toBe('｜漢字《かんじ》');

    await fireEvent.update(textarea, '本文');

    expect(onUpdate).toHaveBeenCalledWith('本文');
  });

  it('names the binding value and types its payload as a string', () => {
    expectTypeErrors(
      `import type { MejiroNotationHighlighterProps } from '@libraz/mejiro-vue';
const ok: MejiroNotationHighlighterProps = { value: '', 'onUpdate:value': (next: string) => void next };
void ok;
const styled: MejiroNotationHighlighterProps = { value: '', wrapperClass: 'w', wrapperStyle: { width: '1px' } };
void styled;
const p1: MejiroNotationHighlighterProps = { modelValue: '' };
const p2: MejiroNotationHighlighterProps = { value: '', textareaClass: 'x' };`,
      { fails: ['const p1', 'const p2'] },
    );
  });
});
