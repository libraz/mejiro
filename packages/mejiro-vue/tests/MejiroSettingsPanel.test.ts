// @vitest-environment happy-dom

import type { EditableSettings } from '@libraz/mejiro';
import { fireEvent, render } from '@testing-library/vue';
import { describe, expect, it, vi } from 'vitest';
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

describe('MejiroSettingsPanel (Vue)', () => {
  const baseSettings = {
    fontFamily: 'serif',
    fontSize: 16,
    lineSpacing: 1.8,
    kinsoku: 'strict' as const,
    enableHanging: true,
  };

  it('adds is-open when open=true', () => {
    const { container } = render(MejiroSettingsPanel, {
      props: { open: true, settings: baseSettings },
    });
    const panel = container.querySelector('.mejiro-reader-settings-panel') as HTMLElement;
    expect(panel.classList.contains('is-open')).toBe(true);
  });

  it('omits is-open when open=false', () => {
    const { container } = render(MejiroSettingsPanel, {
      props: { open: false, settings: baseSettings },
    });
    const panel = container.querySelector('.mejiro-reader-settings-panel') as HTMLElement;
    expect(panel.classList.contains('is-open')).toBe(false);
  });

  it('emits update:settings with the merged value when font size changes', () => {
    const onUpdate = vi.fn();
    const { container } = render(MejiroSettingsPanel, {
      props: { open: true, settings: baseSettings },
      attrs: { 'onUpdate:settings': onUpdate },
    });
    const sizeInput = container.querySelector(
      'input[type="number"]:not(.mejiro-reader-control--wide)',
    ) as HTMLInputElement;
    sizeInput.value = '20';
    sizeInput.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onUpdate).toHaveBeenCalledWith({ ...baseSettings, fontSize: 20 });
  });

  it('clamps invalid numeric settings instead of emitting zero or NaN', () => {
    const onUpdate = vi.fn();
    const { container } = render(MejiroSettingsPanel, {
      props: { open: true, settings: baseSettings },
      attrs: { 'onUpdate:settings': onUpdate },
    });

    const sizeInput = container.querySelector(
      'input[type="number"]:not(.mejiro-reader-control--wide)',
    ) as HTMLInputElement;
    sizeInput.value = '';
    sizeInput.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onUpdate).toHaveBeenLastCalledWith({ ...baseSettings, fontSize: baseSettings.fontSize });
    sizeInput.value = '999';
    sizeInput.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onUpdate).toHaveBeenLastCalledWith({ ...baseSettings, fontSize: 48 });

    const spacingInput = container.querySelector(
      '.mejiro-reader-control--wide',
    ) as HTMLInputElement;
    spacingInput.value = '0';
    spacingInput.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onUpdate).toHaveBeenLastCalledWith({ ...baseSettings, lineSpacing: 1 });
    spacingInput.value = '4';
    spacingInput.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onUpdate).toHaveBeenLastCalledWith({ ...baseSettings, lineSpacing: 3 });
  });

  it('clamps the size stepper buttons to the declared range', () => {
    const onUpdate = vi.fn();
    const { container } = render(MejiroSettingsPanel, {
      props: { open: true, settings: { ...baseSettings, fontSize: 96 } },
      attrs: { 'onUpdate:settings': onUpdate },
    });
    const buttons = container.querySelectorAll('.mejiro-reader-btn--icon');
    (buttons[0] as HTMLButtonElement).click();
    expect(onUpdate).toHaveBeenLastCalledWith({ ...baseSettings, fontSize: 48 });
    (buttons[1] as HTMLButtonElement).click();
    expect(onUpdate).toHaveBeenLastCalledWith({ ...baseSettings, fontSize: 48 });
  });

  it('reflects min/max font size on the size input', () => {
    const { container } = render(MejiroSettingsPanel, {
      props: { open: true, settings: baseSettings, minFontSize: 12, maxFontSize: 28 },
    });
    const sizeInput = container.querySelector(
      'input[type="number"]:not(.mejiro-reader-control--wide)',
    ) as HTMLInputElement;
    expect(sizeInput.min).toBe('12');
    expect(sizeInput.max).toBe('28');
  });

  it('emits update:settings for the kinsoku and hanging toggles', () => {
    const onUpdate = vi.fn();
    const { container } = render(MejiroSettingsPanel, {
      props: { open: true, settings: baseSettings },
      attrs: { 'onUpdate:settings': onUpdate },
    });
    const selects = container.querySelectorAll('select');
    const kinsoku = selects[1] as HTMLSelectElement;
    kinsoku.value = 'loose';
    kinsoku.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onUpdate).toHaveBeenLastCalledWith({ ...baseSettings, kinsoku: 'loose' });

    const hanging = selects[2] as HTMLSelectElement;
    hanging.value = 'false';
    hanging.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onUpdate).toHaveBeenLastCalledWith({ ...baseSettings, enableHanging: false });
  });

  it('shows the active font even when it is not in the `fonts` list (no blank select)', () => {
    const { container } = render(MejiroSettingsPanel, {
      props: {
        open: true,
        settings: { ...baseSettings, fontFamily: '"Noto Serif JP", serif' },
        // host passes no matching choice
        fonts: [{ value: 'sans-serif', label: 'System Sans' }],
      },
    });
    const fontSelect = container.querySelector('select') as HTMLSelectElement;
    // The select resolves to the active family instead of rendering blank.
    expect(fontSelect.value).toBe('"Noto Serif JP", serif');
    const option = Array.from(fontSelect.options).find((o) => o.value === '"Noto Serif JP", serif');
    expect(option).toBeTruthy();
    // Prettified label: first family, quotes stripped.
    expect(option?.textContent).toBe('Noto Serif JP');
  });

  it('does not duplicate the active font when it is already in the `fonts` list', () => {
    const { container } = render(MejiroSettingsPanel, {
      props: {
        open: true,
        settings: { ...baseSettings, fontFamily: 'serif' },
        fonts: [{ value: 'serif', label: 'System Serif' }],
      },
    });
    const fontSelect = container.querySelector('select') as HTMLSelectElement;
    expect(fontSelect.options.length).toBe(1);
    expect(fontSelect.value).toBe('serif');
  });
});
