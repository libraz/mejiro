// @vitest-environment happy-dom
/** @jsxImportSource react */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MejiroPageIndicator } from '../src/MejiroPageIndicator.js';

describe('MejiroPageIndicator (React)', () => {
  it('renders the zero-based index one-based, out of count', () => {
    const { container } = render(<MejiroPageIndicator index={2} count={12} />);
    expect(container.querySelector('.mejiro-reader-page-indicator')?.textContent).toBe('3 / 12');
  });
});
