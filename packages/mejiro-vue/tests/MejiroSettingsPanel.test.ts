// @vitest-environment happy-dom

import type { EditableSettings } from '@libraz/mejiro';
import { fireEvent, render } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import { MejiroSettingsPanel } from '../src/MejiroSettingsPanel.js';

const settings = {
  fontFamily: 'serif',
  fontSize: 16,
  lineSpacing: 1.8,
} as EditableSettings;

/** Types `text` one character at a time with `input` events only. */
async function type(input: HTMLInputElement, text: string): Promise<void> {
  for (let i = 1; i <= text.length; i++) {
    input.value = text.slice(0, i);
    await fireEvent.input(input);
  }
}

function sizeInput(container: Element): HTMLInputElement {
  return container.querySelector('input[type="number"]') as HTMLInputElement;
}

describe('MejiroSettingsPanel (Vue) — number fields commit on change', () => {
  it('does not clamp a font size while it is being typed', async () => {
    const { container, emitted } = render(MejiroSettingsPanel, { props: { open: true, settings } });
    const size = sizeInput(container);
    await type(size, '20');
    expect(emitted()['update:settings']).toBeUndefined();
    expect(size.value).toBe('20');
    await fireEvent.change(size);
    expect(emitted()['update:settings']).toEqual([[{ ...settings, fontSize: 20 }]]);
  });

  it('clamps an out-of-range value once, on commit, and shows the clamped value', async () => {
    const { container, emitted } = render(MejiroSettingsPanel, { props: { open: true, settings } });
    const size = sizeInput(container);
    await type(size, '200');
    await fireEvent.change(size);
    expect(emitted()['update:settings']).toEqual([[{ ...settings, fontSize: 48 }]]);
    expect(size.value).toBe('48');
  });
});
