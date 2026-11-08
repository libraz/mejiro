// @vitest-environment happy-dom

import { fireEvent, render } from '@testing-library/vue';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { jaMessages, MejiroI18nProvider } from '../src/i18n.js';
import { MejiroDropZone } from '../src/MejiroDropZone.js';

async function pick(container: Element, file: File): Promise<void> {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await fireEvent.change(input);
}

function picked(emitted: Record<string, unknown[][]>): string[] {
  return (emitted.file ?? []).map(([file]) => (file as File).name);
}

/** Inputs whose `value` the browser emulation below owns. */
const emulated = new WeakSet<HTMLInputElement>();

/**
 * Picks `file` the way a browser does: no `change` fires when the selection
 * equals the input's current value.
 */
async function browserPick(container: Element, file: File): Promise<void> {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  if (!emulated.has(input)) {
    emulated.add(input);
    let value = '';
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => value,
      set: (next: string) => {
        value = next;
      },
    });
  }
  const path = `C:\\fakepath\\${file.name}`;
  if (input.value === path) return;
  input.value = path;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await fireEvent.change(input);
}

describe('MejiroDropZone (Vue) — file picker', () => {
  it('delivers the same file again when it is picked a second time', async () => {
    const { container, emitted } = render(MejiroDropZone);
    const file = new File(['x'], 'book.epub');
    await browserPick(container, file);
    await browserPick(container, file);
    expect(picked(emitted())).toEqual(['book.epub', 'book.epub']);
  });
});

describe('MejiroDropZone (Vue) — default validator', () => {
  it.each(['book.epub', 'BOOK.EPUB', 'Book.Epub'])('accepts %s', async (name) => {
    const { container, emitted } = render(MejiroDropZone);
    await pick(container, new File(['x'], name));
    expect(picked(emitted())).toEqual([name]);
  });

  it('rejects a file the accept filter does not allow', async () => {
    const { container, emitted } = render(MejiroDropZone);
    await pick(container, new File(['x'], 'notes.txt'));
    expect(picked(emitted())).toEqual([]);
  });

  it('follows a custom accept filter', async () => {
    const { container, emitted } = render(MejiroDropZone, { props: { accept: '.zip,image/*' } });
    await pick(container, new File(['x'], 'ARCHIVE.ZIP'));
    await pick(container, new File(['x'], 'cover', { type: 'image/png' }));
    await pick(container, new File(['x'], 'book.epub'));
    expect(picked(emitted())).toEqual(['ARCHIVE.ZIP', 'cover']);
  });
});

describe('MejiroDropZone (Vue)', () => {
  it('emits file when a valid .epub is dropped', async () => {
    const onFile = vi.fn();
    const { container } = render(MejiroDropZone, { attrs: { onFile } });
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLElement;
    const file = new File(['x'], 'book.epub', { type: 'application/epub+zip' });
    const dt = { files: [file] } as unknown as DataTransfer;

    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: dt });
    root.dispatchEvent(event);

    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][0].name).toBe('book.epub');
  });

  it('rejects non-.epub files via the default validator', () => {
    const onFile = vi.fn();
    const { container } = render(MejiroDropZone, { attrs: { onFile } });
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLElement;
    const file = new File(['x'], 'notes.txt');
    const dt = { files: [file] } as unknown as DataTransfer;

    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: dt });
    root.dispatchEvent(event);

    expect(onFile).not.toHaveBeenCalled();
  });

  it('honours a custom validateFile predicate', () => {
    const onFile = vi.fn();
    const { container } = render(MejiroDropZone, {
      props: { validateFile: (f: File) => f.name.endsWith('.zip') },
      attrs: { onFile },
    });
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLElement;
    const file = new File(['x'], 'book.zip');
    const dt = { files: [file] } as unknown as DataTransfer;
    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: dt });
    root.dispatchEvent(event);

    expect(onFile).toHaveBeenCalledTimes(1);
  });

  it('exposes a focusable control as its root', () => {
    const { container } = render(MejiroDropZone, { attrs: { onFile: () => {} } });
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLButtonElement;
    expect(root.tagName).toBe('BUTTON');
    expect(root.getAttribute('type')).toBe('button');
    expect(root.tabIndex).toBe(0);
    root.focus();
    expect(document.activeElement).toBe(root);
  });

  it('opens a book from the keyboard via Enter and Space', () => {
    const onFile = vi.fn();
    const { container } = render(MejiroDropZone, { attrs: { onFile } });
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLButtonElement;
    const picker = container.querySelector('input[type="file"]') as HTMLInputElement;
    const openPicker = vi.spyOn(picker, 'click').mockImplementation(() => {});
    root.focus();

    for (const key of ['Enter', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      root.dispatchEvent(event);
      // The native activation is cancelled so the picker opens exactly once.
      expect(event.defaultPrevented).toBe(true);
    }
    expect(openPicker).toHaveBeenCalledTimes(2);

    const file = new File(['x'], 'book.epub', { type: 'application/epub+zip' });
    Object.defineProperty(picker, 'files', { value: [file], configurable: true });
    picker.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][0].name).toBe('book.epub');
  });

  it('ignores other keys', () => {
    const { container } = render(MejiroDropZone, { attrs: { onFile: () => {} } });
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLButtonElement;
    const picker = container.querySelector('input[type="file"]') as HTMLInputElement;
    const openPicker = vi.spyOn(picker, 'click').mockImplementation(() => {});
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    expect(openPicker).not.toHaveBeenCalled();
  });

  it('toggles is-dragover on dragover/dragleave', async () => {
    const { container } = render(MejiroDropZone, { attrs: { onFile: () => {} } });
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLElement;
    root.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(root.classList.contains('is-dragover')).toBe(true);

    root.dispatchEvent(new Event('dragleave', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(root.classList.contains('is-dragover')).toBe(false);
  });

  it('uses the i18n catalog for default copy', () => {
    const Wrapped = defineComponent({
      setup() {
        return () =>
          h(MejiroI18nProvider, { messages: jaMessages }, () =>
            h(MejiroDropZone, { onFile: () => {} }),
          );
      },
    });
    const { container } = render(Wrapped);
    expect(container.textContent).toContain(jaMessages.dropZoneTitle);
    expect(container.textContent).toContain(jaMessages.dropZoneHint);
  });

  it('merges partial provider message overrides', () => {
    const Wrapped = defineComponent({
      setup() {
        return () =>
          h(MejiroI18nProvider, { messages: { dropZoneTitle: 'Custom drop' } }, () =>
            h(MejiroDropZone, { onFile: () => {} }),
          );
      },
    });
    const { container } = render(Wrapped);
    expect(container.textContent).toContain('Custom drop');
    expect(container.textContent).toContain('epub files only');
  });

  it('supports provider locale without explicit message overrides', () => {
    const Wrapped = defineComponent({
      setup() {
        return () =>
          h(MejiroI18nProvider, { locale: 'ja' }, () => h(MejiroDropZone, { onFile: () => {} }));
      },
    });
    const { container } = render(Wrapped);
    expect(container.textContent).toContain(jaMessages.dropZoneTitle);
    expect(container.textContent).toContain(jaMessages.dropZoneHint);
  });
});
