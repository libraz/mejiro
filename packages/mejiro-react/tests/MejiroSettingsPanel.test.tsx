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
    const onSettingsChange = vi.fn();
    const { container } = render(
      <MejiroSettingsPanel open settings={settings} onSettingsChange={onSettingsChange} />,
    );
    const size = container.querySelector('[id$="-font-size"]') as HTMLInputElement;
    type(size, '20');
    expect(onSettingsChange).not.toHaveBeenCalled();
    expect(size.value).toBe('20');
    fireEvent.change(size);
    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(onSettingsChange).toHaveBeenLastCalledWith({ ...settings, fontSize: 20 });
  });

  it('clamps an out-of-range value once, on commit, and shows the clamped value', () => {
    const onSettingsChange = vi.fn();
    const { container } = render(
      <MejiroSettingsPanel open settings={settings} onSettingsChange={onSettingsChange} />,
    );
    const size = container.querySelector('[id$="-font-size"]') as HTMLInputElement;
    type(size, '200');
    fireEvent.change(size);
    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(onSettingsChange).toHaveBeenLastCalledWith({ ...settings, fontSize: 48 });
    expect(size.value).toBe('48');
  });
});

describe('MejiroSettingsPanel (React)', () => {
  const baseSettings = {
    fontFamily: 'serif',
    fontSize: 16,
    lineSpacing: 1.8,
    kinsoku: 'strict' as const,
    enableHanging: true,
  };

  it('adds is-open when open=true', () => {
    const { container } = render(
      <MejiroSettingsPanel open settings={baseSettings} onSettingsChange={() => {}} />,
    );
    const panel = container.querySelector('.mejiro-reader-settings-panel') as HTMLElement;
    expect(panel.classList.contains('is-open')).toBe(true);
  });

  it('omits is-open when open=false', () => {
    const { container } = render(
      <MejiroSettingsPanel open={false} settings={baseSettings} onSettingsChange={() => {}} />,
    );
    const panel = container.querySelector('.mejiro-reader-settings-panel') as HTMLElement;
    expect(panel.classList.contains('is-open')).toBe(false);
  });

  it('wraps controls in the accordion clip box + padded content layer', () => {
    // The `0fr → 1fr` accordion requires `.settings-inner` to be a bare clip box
    // and the padding/flex to live on a nested `.settings-content`; otherwise a
    // closed panel reserves a permanent band (looks "always open").
    const { container } = render(
      <MejiroSettingsPanel open settings={baseSettings} onSettingsChange={() => {}} />,
    );
    const content = container.querySelector(
      '.mejiro-reader-settings-inner > .mejiro-reader-settings-content',
    );
    expect(content).not.toBeNull();
    // The controls live inside the content layer, not directly in the clip box.
    expect(content?.querySelector('.mejiro-reader-settings-group')).not.toBeNull();
  });

  it('calls onSettingsChange with the merged value when font size changes', () => {
    const onSettingsChange = vi.fn();
    const { container } = render(
      <MejiroSettingsPanel open settings={baseSettings} onSettingsChange={onSettingsChange} />,
    );
    const sizeInput = container.querySelector('[id$="-font-size"]') as HTMLInputElement;
    fireEvent.change(sizeInput, { target: { value: '20' } });
    expect(onSettingsChange).toHaveBeenCalledWith({ ...baseSettings, fontSize: 20 });
  });

  it('clamps invalid numeric settings instead of emitting zero or NaN', () => {
    const onSettingsChange = vi.fn();
    const { container } = render(
      <MejiroSettingsPanel open settings={baseSettings} onSettingsChange={onSettingsChange} />,
    );

    const sizeInput = container.querySelector('[id$="-font-size"]') as HTMLInputElement;
    fireEvent.change(sizeInput, { target: { value: '' } });
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      ...baseSettings,
      fontSize: baseSettings.fontSize,
    });
    fireEvent.change(sizeInput, { target: { value: '999' } });
    expect(onSettingsChange).toHaveBeenLastCalledWith({ ...baseSettings, fontSize: 48 });

    const spacingInput = container.querySelector('[id$="-line-spacing"]') as HTMLInputElement;
    fireEvent.change(spacingInput, { target: { value: '0' } });
    expect(onSettingsChange).toHaveBeenLastCalledWith({ ...baseSettings, lineSpacing: 1 });
    fireEvent.change(spacingInput, { target: { value: '4' } });
    expect(onSettingsChange).toHaveBeenLastCalledWith({ ...baseSettings, lineSpacing: 3 });
  });

  it('clamps the size stepper buttons to the declared range', () => {
    const onSettingsChange = vi.fn();
    const { container } = render(
      <MejiroSettingsPanel
        open
        settings={{ ...baseSettings, fontSize: 96 }}
        onSettingsChange={onSettingsChange}
      />,
    );
    const buttons = container.querySelectorAll('.mejiro-reader-btn--icon');
    fireEvent.click(buttons[0]);
    expect(onSettingsChange).toHaveBeenLastCalledWith({ ...baseSettings, fontSize: 48 });
    fireEvent.click(buttons[1]);
    expect(onSettingsChange).toHaveBeenLastCalledWith({ ...baseSettings, fontSize: 48 });
  });

  it('reflects min/max font size on the size input', () => {
    const { container } = render(
      <MejiroSettingsPanel
        open
        settings={baseSettings}
        onSettingsChange={() => {}}
        minFontSize={12}
        maxFontSize={28}
      />,
    );
    const sizeInput = container.querySelector('[id$="-font-size"]') as HTMLInputElement;
    expect(sizeInput.min).toBe('12');
    expect(sizeInput.max).toBe('28');
  });

  it('calls onSettingsChange for the kinsoku and hanging toggles', () => {
    const onSettingsChange = vi.fn();
    const { container } = render(
      <MejiroSettingsPanel open settings={baseSettings} onSettingsChange={onSettingsChange} />,
    );
    const kinsoku = container.querySelector('[id$="-kinsoku"]') as HTMLSelectElement;
    fireEvent.change(kinsoku, { target: { value: 'loose' } });
    expect(onSettingsChange).toHaveBeenLastCalledWith({ ...baseSettings, kinsoku: 'loose' });

    const hanging = container.querySelector('[id$="-hanging"]') as HTMLSelectElement;
    fireEvent.change(hanging, { target: { value: 'false' } });
    expect(onSettingsChange).toHaveBeenLastCalledWith({ ...baseSettings, enableHanging: false });
  });

  it('shows the active font even when it is not in the `fonts` list (no blank select)', () => {
    const { container } = render(
      <MejiroSettingsPanel
        open
        settings={{ ...baseSettings, fontFamily: '"Noto Serif JP", serif' }}
        onSettingsChange={() => {}}
        fonts={[{ value: 'sans-serif', label: 'System Sans' }]}
      />,
    );
    const fontSelect = container.querySelector('select') as HTMLSelectElement;
    expect(fontSelect.value).toBe('"Noto Serif JP", serif');
    const option = Array.from(fontSelect.options).find((o) => o.value === '"Noto Serif JP", serif');
    expect(option).toBeTruthy();
    // Prettified label: first family, quotes stripped.
    expect(option?.textContent).toBe('Noto Serif JP');
  });

  it('does not duplicate the active font when it is already in the `fonts` list', () => {
    const { container } = render(
      <MejiroSettingsPanel
        open
        settings={{ ...baseSettings, fontFamily: 'serif' }}
        onSettingsChange={() => {}}
        fonts={[{ value: 'serif', label: 'System Serif' }]}
      />,
    );
    const fontSelect = container.querySelector('select') as HTMLSelectElement;
    expect(fontSelect.options.length).toBe(1);
    expect(fontSelect.value).toBe('serif');
  });
});
