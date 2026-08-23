// @vitest-environment happy-dom

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOverlayDragSession } from '../../src/browser/overlay-drag.js';
import type { ImageOverlayRect } from '../../src/overlay.js';

// `import.meta.url` is not a file URL under the DOM environment this file runs
// in, so the workspace root comes from the Vitest working directory instead.
const PACKAGES_ROOT = path.join(process.cwd(), 'packages');

/** Published packages whose sources must not carry a second drag loop. */
const PUBLISHED_SOURCES = ['mejiro/src', 'mejiro-react/src', 'mejiro-vue/src'];

function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/u.test(entry.name)) files.push(full);
    }
  };
  for (const source of PUBLISHED_SOURCES) walk(path.join(PACKAGES_ROOT, source));
  return files;
}

function filesMatching(pattern: RegExp): string[] {
  return sourceFiles()
    .filter((file) => pattern.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(PACKAGES_ROOT, file))
    .sort();
}

/** Pending animation-frame callbacks, indexed by handle - 1. */
let frames: (FrameRequestCallback | undefined)[] = [];

function flushFrames(): void {
  const pending = frames;
  frames = [];
  for (const callback of pending) callback?.(0);
}

function pointerMove(clientX: number, clientY: number): void {
  document.dispatchEvent(Object.assign(new Event('pointermove'), { clientX, clientY }));
}

function pointerUp(): void {
  document.dispatchEvent(new Event('pointerup'));
}

function overlayElements(): { overlay: HTMLElement; handle: HTMLElement } {
  const overlay = document.createElement('div');
  const handle = document.createElement('span');
  overlay.appendChild(handle);
  document.body.appendChild(overlay);
  Object.assign(overlay, { setPointerCapture: vi.fn() });
  Object.assign(handle, { setPointerCapture: vi.fn() });
  return { overlay, handle };
}

const START: ImageOverlayRect = { x: 10, y: 20, w: 100, h: 120 };

describe('createOverlayDragSession', () => {
  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
      frames[handle - 1] = undefined;
    });
  });

  afterEach(() => {
    // Sessions attach to the document, which outlives a single test, so end
    // any gesture still running before the frame stubs go away.
    pointerUp();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('translates the start rectangle by the cumulative pointer delta', () => {
    const onChange = vi.fn();
    const { overlay } = overlayElements();

    const session = createOverlayDragSession({
      mode: 'move',
      rect: START,
      startX: 200,
      startY: 300,
      pointerId: 7,
      captureElement: overlay,
      activeElement: overlay,
      dragClass: 'dragging',
      onChange,
    });

    expect(overlay.setPointerCapture).toHaveBeenCalledWith(7);
    expect(overlay.classList.contains('dragging')).toBe(true);

    pointerMove(230, 280);
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith({ x: 40, y: 0, w: 100, h: 120 });

    // Deltas are measured from the gesture start, never accumulated.
    pointerMove(190, 300);
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith({ x: 0, y: 20, w: 100, h: 120 });

    pointerUp();
    expect(session.active).toBe(false);
    expect(overlay.classList.contains('dragging')).toBe(false);

    pointerMove(500, 500);
    flushFrames();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(START).toEqual({ x: 10, y: 20, w: 100, h: 120 });
  });

  it('resizes from the top-left anchor and clamps at the minimum size', () => {
    const onChange = vi.fn();
    const { overlay, handle } = overlayElements();

    createOverlayDragSession({
      mode: 'resize',
      rect: START,
      startX: 0,
      startY: 0,
      pointerId: 3,
      captureElement: handle,
      activeElement: overlay,
      dragClass: 'dragging',
      onChange,
    });

    // The handle takes the pointer capture, the overlay takes the drag class.
    expect(handle.setPointerCapture).toHaveBeenCalledWith(3);
    expect(overlay.classList.contains('dragging')).toBe(true);

    pointerMove(40, 30);
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith({ x: 10, y: 20, w: 140, h: 150 });

    pointerMove(-500, -500);
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith({ x: 10, y: 20, w: 40, h: 40 });
  });

  it('honours a custom minimum size', () => {
    const onChange = vi.fn();

    createOverlayDragSession({
      mode: 'resize',
      rect: START,
      startX: 0,
      startY: 0,
      minSize: 80,
      onChange,
    });

    pointerMove(-500, -500);
    flushFrames();
    expect(onChange).toHaveBeenLastCalledWith({ x: 10, y: 20, w: 80, h: 80 });
  });

  it('coalesces several moves inside one animation frame', () => {
    const onChange = vi.fn();

    createOverlayDragSession({ mode: 'move', rect: START, startX: 0, startY: 0, onChange });

    pointerMove(5, 5);
    pointerMove(10, 10);
    pointerMove(15, 15);
    flushFrames();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ x: 25, y: 35, w: 100, h: 120 });
  });

  it('cancels once, dropping the queued frame and the listeners', () => {
    const onChange = vi.fn();
    const onEnd = vi.fn();
    const registry = new Set<() => void>();
    const { overlay } = overlayElements();
    const removeListener = vi.spyOn(document, 'removeEventListener');

    const session = createOverlayDragSession({
      mode: 'move',
      rect: START,
      startX: 0,
      startY: 0,
      activeElement: overlay,
      dragClass: 'dragging',
      registry,
      onChange,
      onEnd,
    });
    expect(registry.size).toBe(1);

    pointerMove(50, 50);
    session.cancel();
    flushFrames();

    expect(onChange).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
    expect(overlay.classList.contains('dragging')).toBe(false);
    expect(removeListener).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('pointerup', expect.any(Function));

    session.cancel();
    expect(onEnd).toHaveBeenCalledTimes(1);
    removeListener.mockRestore();
  });

  it('delivers changes synchronously when the runtime has no frame scheduler', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('requestAnimationFrame', undefined);
    vi.stubGlobal('cancelAnimationFrame', undefined);
    const onChange = vi.fn();

    const session = createOverlayDragSession({
      mode: 'move',
      rect: START,
      startX: 0,
      startY: 0,
      onChange,
    });

    pointerMove(10, 10);
    expect(onChange).toHaveBeenCalledWith({ x: 20, y: 30, w: 100, h: 120 });

    session.cancel();
  });
});

describe('pointer drag duplication', () => {
  it('runs the document-level drag loop from one module only', () => {
    // Pinned by symbol and by the listener wiring rather than by line numbers,
    // so a second copy anywhere in the published packages fails here. The DOM
    // work belongs to the browser layer; the DOM-free core only supplies the
    // rectangle arithmetic.
    expect(filesMatching(/addEventListener\(\s*'pointermove'/u)).toEqual([
      'mejiro/src/browser/overlay-drag.ts',
    ]);
    expect(filesMatching(/function createOverlayDragSession/u)).toEqual([
      'mejiro/src/browser/overlay-drag.ts',
    ]);
  });

  it('keeps the session behind the browser entry point, not the core one', () => {
    // The core entry stays DOM-free, so a consumer importing `@libraz/mejiro`
    // never pulls in a function that touches `document`.
    const barrel = (name: string): string =>
      fs.readFileSync(path.join(PACKAGES_ROOT, 'mejiro/src', name), 'utf8');

    expect(barrel('browser/index.ts')).toContain('createOverlayDragSession');
    expect(barrel('index.ts')).not.toContain('createOverlayDragSession');
  });

  it('has every overlay hook go through the shared session', () => {
    expect(filesMatching(/createOverlayDragSession\(\{/u)).toEqual([
      'mejiro-react/src/useImageOverlay.ts',
      'mejiro-react/src/useMultiImageOverlay.ts',
      'mejiro-vue/src/useImageOverlay.ts',
      'mejiro-vue/src/useMultiImageOverlay.ts',
    ]);
  });
});
