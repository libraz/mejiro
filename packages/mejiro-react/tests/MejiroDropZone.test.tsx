// @vitest-environment happy-dom
/** @jsxImportSource react */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jaMessages, MejiroI18nProvider } from '../src/i18n.js';
import { MejiroDropZone } from '../src/MejiroDropZone.js';

function pick(container: HTMLElement, file: File): void {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  fireEvent.change(input);
}

/** Inputs whose `value` the browser emulation below owns. */
const emulated = new WeakSet<HTMLInputElement>();

/**
 * Picks `file` the way a browser does: no `change` fires when the selection
 * equals the input's current value.
 */
function browserPick(container: HTMLElement, file: File): void {
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
  fireEvent.change(input);
}

describe('MejiroDropZone (React) — file picker', () => {
  it('delivers the same file again when it is picked a second time', () => {
    const onFile = vi.fn();
    const { container } = render(<MejiroDropZone onFile={onFile} />);
    const file = new File(['x'], 'book.epub');
    browserPick(container, file);
    browserPick(container, file);
    expect(onFile).toHaveBeenCalledTimes(2);
  });
});

describe('MejiroDropZone (React) — default validator', () => {
  it.each(['book.epub', 'BOOK.EPUB', 'Book.Epub'])('accepts %s', (name) => {
    const onFile = vi.fn();
    const { container } = render(<MejiroDropZone onFile={onFile} />);
    pick(container, new File(['x'], name));
    expect(onFile).toHaveBeenCalledTimes(1);
  });

  it('rejects a file the accept filter does not allow', () => {
    const onFile = vi.fn();
    const { container } = render(<MejiroDropZone onFile={onFile} />);
    pick(container, new File(['x'], 'notes.txt'));
    expect(onFile).not.toHaveBeenCalled();
  });

  it('follows a custom accept filter', () => {
    const onFile = vi.fn();
    const { container } = render(<MejiroDropZone accept=".zip,image/*" onFile={onFile} />);
    pick(container, new File(['x'], 'ARCHIVE.ZIP'));
    pick(container, new File(['x'], 'cover', { type: 'image/png' }));
    pick(container, new File(['x'], 'book.epub'));
    expect(onFile.mock.calls.map(([file]) => file.name)).toEqual(['ARCHIVE.ZIP', 'cover']);
  });
});

describe('MejiroDropZone (React)', () => {
  it('calls onFile when a valid .epub is dropped', () => {
    const onFile = vi.fn();
    const { container } = render(<MejiroDropZone onFile={onFile} />);
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLElement;
    const file = new File(['x'], 'book.epub', { type: 'application/epub+zip' });
    const dt = { files: [file] } as unknown as DataTransfer;

    fireEvent.drop(root, { dataTransfer: dt });

    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][0].name).toBe('book.epub');
  });

  it('rejects non-.epub files via the default validator', () => {
    const onFile = vi.fn();
    const { container } = render(<MejiroDropZone onFile={onFile} />);
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLElement;
    const file = new File(['x'], 'notes.txt');
    const dt = { files: [file] } as unknown as DataTransfer;

    fireEvent.drop(root, { dataTransfer: dt });

    expect(onFile).not.toHaveBeenCalled();
  });

  it('honours a custom validateFile predicate', () => {
    const onFile = vi.fn();
    const { container } = render(
      <MejiroDropZone onFile={onFile} validateFile={(f) => f.name.endsWith('.zip')} />,
    );
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLElement;
    const file = new File(['x'], 'book.zip');
    const dt = { files: [file] } as unknown as DataTransfer;
    fireEvent.drop(root, { dataTransfer: dt });

    expect(onFile).toHaveBeenCalledTimes(1);
  });

  it('exposes a focusable control as its root', () => {
    const { container } = render(<MejiroDropZone onFile={() => {}} />);
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLButtonElement;
    expect(root.tagName).toBe('BUTTON');
    expect(root.getAttribute('type')).toBe('button');
    expect(root.tabIndex).toBe(0);
    root.focus();
    expect(document.activeElement).toBe(root);
  });

  it('opens a book from the keyboard via Enter and Space', () => {
    const onFile = vi.fn();
    const { container } = render(<MejiroDropZone onFile={onFile} />);
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLButtonElement;
    const picker = container.querySelector('input[type="file"]') as HTMLInputElement;
    const openPicker = vi.spyOn(picker, 'click').mockImplementation(() => {});
    root.focus();

    for (const key of ['Enter', ' ']) {
      // The native activation is cancelled so the picker opens exactly once.
      expect(fireEvent.keyDown(root, { key })).toBe(false);
    }
    expect(openPicker).toHaveBeenCalledTimes(2);

    const file = new File(['x'], 'book.epub', { type: 'application/epub+zip' });
    Object.defineProperty(picker, 'files', { value: [file], configurable: true });
    fireEvent.change(picker);

    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][0].name).toBe('book.epub');
  });

  it('ignores other keys', () => {
    const { container } = render(<MejiroDropZone onFile={() => {}} />);
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLButtonElement;
    const picker = container.querySelector('input[type="file"]') as HTMLInputElement;
    const openPicker = vi.spyOn(picker, 'click').mockImplementation(() => {});
    fireEvent.keyDown(root, { key: 'a' });
    expect(openPicker).not.toHaveBeenCalled();
  });

  it('toggles is-dragover on dragover/dragleave', () => {
    const { container } = render(<MejiroDropZone onFile={() => {}} />);
    const root = container.querySelector('.mejiro-reader-drop-zone') as HTMLElement;
    fireEvent.dragOver(root);
    expect(root.classList.contains('is-dragover')).toBe(true);

    fireEvent.dragLeave(root);
    expect(root.classList.contains('is-dragover')).toBe(false);
  });

  it('uses the i18n catalog for default copy', () => {
    const { container } = render(
      <MejiroI18nProvider messages={jaMessages}>
        <MejiroDropZone onFile={() => {}} />
      </MejiroI18nProvider>,
    );
    expect(container.textContent).toContain(jaMessages.dropZoneTitle);
    expect(container.textContent).toContain(jaMessages.dropZoneHint);
  });

  it('merges partial provider message overrides', () => {
    const { container } = render(
      <MejiroI18nProvider messages={{ dropZoneTitle: 'Custom drop' }}>
        <MejiroDropZone onFile={() => {}} />
      </MejiroI18nProvider>,
    );

    expect(container.textContent).toContain('Custom drop');
    expect(container.textContent).toContain('epub files only');
  });

  it('supports provider locale without explicit message overrides', () => {
    const { container } = render(
      <MejiroI18nProvider locale="ja">
        <MejiroDropZone onFile={() => {}} />
      </MejiroI18nProvider>,
    );

    expect(container.textContent).toContain(jaMessages.dropZoneTitle);
    expect(container.textContent).toContain(jaMessages.dropZoneHint);
  });
});

describe('MejiroDropZone (React) — rejected files', () => {
  it('reports a file the accept filter refuses as a type rejection', () => {
    const onFile = vi.fn();
    const onReject = vi.fn();
    const { container } = render(<MejiroDropZone onFile={onFile} onReject={onReject} />);
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' });

    pick(container, file);

    expect(onFile).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledExactlyOnceWith(file, 'type');
  });

  it('reports a file validateFile refuses as a validation rejection, dropped or picked', () => {
    const onFile = vi.fn();
    const onReject = vi.fn();
    const { container } = render(
      <MejiroDropZone onFile={onFile} onReject={onReject} validateFile={() => false} />,
    );
    const file = new File(['x'], 'book.epub', { type: 'application/epub+zip' });

    pick(container, file);
    fireEvent.drop(container.querySelector('button') as HTMLButtonElement, {
      dataTransfer: { files: [file] },
    });

    expect(onFile).not.toHaveBeenCalled();
    expect(onReject.mock.calls).toEqual([
      [file, 'validation'],
      [file, 'validation'],
    ]);
  });

  it('does not report an accepted file', () => {
    const onFile = vi.fn();
    const onReject = vi.fn();
    const { container } = render(<MejiroDropZone onFile={onFile} onReject={onReject} />);
    const file = new File(['x'], 'Book.EPUB');

    pick(container, file);

    expect(onFile).toHaveBeenCalledExactlyOnceWith(file);
    expect(onReject).not.toHaveBeenCalled();
  });
});
