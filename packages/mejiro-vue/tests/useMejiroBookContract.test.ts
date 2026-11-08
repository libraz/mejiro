// @vitest-environment happy-dom

import type { BookOptions } from '@libraz/mejiro/book';
import { MejiroBook } from '@libraz/mejiro/book';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, reactive } from 'vue';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { type UseMejiroBookReturn, useMejiroBook } from '../src/index.js';

function harness(...args: Parameters<typeof useMejiroBook>): UseMejiroBookReturn {
  let result!: UseMejiroBookReturn;
  mount(
    defineComponent({
      setup() {
        result = useMejiroBook(...args);
        return () => h('div');
      },
    }),
  );
  return result;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useMejiroBook (Vue) — reactive options', () => {
  it('follows a getter of BookOptions, applying only the runtime keys that changed', async () => {
    const update = vi.spyOn(MejiroBook.prototype, 'updateOptions');
    const props = reactive<BookOptions>({ fontFamily: 'serif', fontSize: 16, lineSpacing: 1.8 });
    const state = harness(() => ({ ...props }));

    props.lineSpacing = 2;
    await nextTick();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ lineSpacing: 2 });
    expect(state.options.value.lineSpacing).toBe(2);
  });

  it('ignores later changes to construction-time keys and keeps the same book', async () => {
    const update = vi.spyOn(MejiroBook.prototype, 'updateOptions');
    const props = reactive<BookOptions>({ fontFamily: 'serif', fontSize: 16 });
    const state = harness(() => ({ ...props }));
    const book = state.book;

    props.strictFontCheck = true;
    props.wordAwareBreaking = 'full';
    await nextTick();

    expect(update).not.toHaveBeenCalled();
    expect(state.book).toBe(book);
  });

  it('merges a patch through updateOptions', async () => {
    const state = harness({ fontFamily: 'serif', fontSize: 16 });

    await state.updateOptions({ lineSpacing: 2.2 });

    expect(state.book.getOptions().lineSpacing).toBe(2.2);
    expect(state.options.value).toMatchObject({ fontFamily: 'serif', lineSpacing: 2.2 });
  });
});

describe('useMejiroBook (Vue) — public types', () => {
  it('takes one BookOptions source and an optional hook options object', () => {
    expectTypeErrors(
      `import type { BookOptions } from '@libraz/mejiro/book';
import { useMejiroBook } from '@libraz/mejiro-vue';
import { ref } from 'vue';
const options = ref<BookOptions>({ fontFamily: 'serif', fontSize: 16, strictFontCheck: true });
const state = useMejiroBook(options, { debounceMs: 50, onError: () => {} });
useMejiroBook(() => options.value);
void state.updateOptions({ lineSpacing: 2 });
void state.updateOptions({ strictFontCheck: false });
void state.setOptions({ lineSpacing: 2 });
useMejiroBook(options.value, ref({ fontSize: 18 }), { debounceMs: 50 });
import type { MejiroBookOptions } from '@libraz/mejiro/book';`,
      {
        fails: [
          'updateOptions({ strictFontCheck: false })',
          'state.setOptions(',
          'ref({ fontSize: 18 })',
          '{ MejiroBookOptions }',
        ],
      },
    );
  });
});
