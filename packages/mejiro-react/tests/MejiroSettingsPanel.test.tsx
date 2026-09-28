// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { EditableSettings } from '@libraz/mejiro';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MejiroSettingsPanel } from '../src/MejiroSettingsPanel.js';

const settings = {
  fontFamily: 'serif',
  fontSize: 16,
  lineSpacing: 1.8,
} as EditableSettings;

/** Types `text` one character at a time with `input` events only. */
function type(input: HTMLInputElement, text: string): void {
  for (let i = 1; i <= text.length; i++) {
    fireEvent.input(input, { target: { value: text.slice(0, i) } });
  }
}

describe('MejiroSettingsPanel (React) — number fields commit on change', () => {
  it('does not clamp a font size while it is being typed', () => {
    const onChange = vi.fn();
    const { container } = render(
      <MejiroSettingsPanel open settings={settings} onChange={onChange} />,
    );
    const size = container.querySelector('#mejiro-reader-font-size') as HTMLInputElement;
    type(size, '20');
    expect(onChange).not.toHaveBeenCalled();
    expect(size.value).toBe('20');
    fireEvent.change(size);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ ...settings, fontSize: 20 });
  });

  it('clamps an out-of-range value once, on commit, and shows the clamped value', () => {
    const onChange = vi.fn();
    const { container } = render(
      <MejiroSettingsPanel open settings={settings} onChange={onChange} />,
    );
    const size = container.querySelector('#mejiro-reader-font-size') as HTMLInputElement;
    type(size, '200');
    fireEvent.change(size);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ ...settings, fontSize: 48 });
    expect(size.value).toBe('48');
  });
});
