// @vitest-environment happy-dom

import { render } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { MejiroPageIndicator } from '../src/MejiroPageIndicator.js';

describe('MejiroPageIndicator (Vue)', () => {
  it('shows the zero-based index one-based, over the count', () => {
    const { container } = render(MejiroPageIndicator, { props: { index: 2, count: 12 } });
    expect(container.querySelector('.mejiro-reader-page-indicator')?.textContent).toBe('3 / 12');
  });

  it('takes index and count, the names useSpread returns', () => {
    expectTypeErrors(
      `import type { MejiroPageIndicatorProps } from '@libraz/mejiro-vue';
const ok: MejiroPageIndicatorProps = { index: 0, count: 1 };
void ok;
const p1: MejiroPageIndicatorProps = { current: 1, total: 1 };`,
      { fails: ['const p1'] },
    );
  });
});
