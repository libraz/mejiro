// @vitest-environment happy-dom
/** @jsxImportSource react */

import { fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { MejiroNotationHighlighter } from '../src/MejiroNotationHighlighter.js';

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <MejiroNotationHighlighter value={value} onChange={setValue} data-testid="ta" />;
}

describe('MejiroNotationHighlighter (React)', () => {
  it('renders the textarea + an overlay', () => {
    const { container } = render(<Harness initial="本文" />);
    expect(container.querySelector('.mejiro-notation-textarea')).not.toBeNull();
    expect(container.querySelector('.mejiro-notation-overlay')).not.toBeNull();
  });

  it('highlights ruby tokens with the corresponding data-token attribute', () => {
    const { container } = render(<Harness initial="文字｜漢字《かんじ》です" />);
    const rubyTokens = container.querySelectorAll('[data-token="ruby"]');
    expect(rubyTokens.length).toBe(1);
    expect(rubyTokens[0].textContent).toBe('｜漢字《かんじ》');
  });

  it('updates highlights on user input', () => {
    const { container } = render(<Harness />);
    const ta = container.querySelector('.mejiro-notation-textarea') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '《《圏点》》' } });
    expect(container.querySelector('[data-token="emphasis"]')?.textContent).toBe('《《圏点》》');
  });
});
