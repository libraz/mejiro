import { type ImageOverlayRect, moveImageOverlayRect, resizeImageOverlayRect } from '../overlay.js';

/**
 * Gesture an {@link OverlayDragSession} applies to the rectangle captured at
 * pointer-down: `'move'` translates it, `'resize'` grows or shrinks it from the
 * bottom-right corner.
 */
export type OverlayDragMode = 'move' | 'resize';

/** Inputs for {@link createOverlayDragSession}. */
export interface OverlayDragSessionOptions {
  /** Gesture the session applies to {@link OverlayDragSessionOptions.rect}. */
  mode: OverlayDragMode;
  /** Rectangle captured at pointer-down. Never mutated. */
  rect: ImageOverlayRect;
  /** Pointer x at pointer-down, in client coordinates (px). */
  startX: number;
  /** Pointer y at pointer-down, in client coordinates (px). */
  startY: number;
  /**
   * Pointer that owns the gesture. When set, events from any other pointer are
   * ignored; together with {@link OverlayDragSessionOptions.captureElement}, the
   * element captures it so the gesture survives the pointer leaving the overlay.
   */
  pointerId?: number;
  /** Element the pointer is captured on — usually the pointer-down target. */
  captureElement?: HTMLElement | null;
  /**
   * Element carrying {@link OverlayDragSessionOptions.dragClass} while the
   * gesture runs. Often the overlay itself even when the gesture started on a
   * child handle.
   */
  activeElement?: HTMLElement | null;
  /** Class toggled on `activeElement` for the duration of the gesture. */
  dragClass?: string;
  /** Minimum width and height in `'resize'` mode (px). @defaultValue 40 */
  minSize?: number;
  /**
   * Receives the rectangle re-derived from the cumulative pointer delta. Every
   * call gets a fresh object; the start rectangle is the base each time, so
   * rounding never accumulates across a gesture.
   */
  onChange: (rect: ImageOverlayRect) => void;
  /**
   * Called exactly once when the gesture ends, however it ended: `pointerup`,
   * `pointercancel`, loss of pointer capture, or `cancel()`.
   */
  onEnd?: () => void;
  /**
   * Set the session registers its disposer in for the gesture's lifetime, so a
   * host can end every gesture still in flight when its component unmounts.
   * The entry removes itself once the gesture ends.
   */
  registry?: Set<() => void>;
}

/** Handle for a pointer drag started by {@link createOverlayDragSession}. */
export interface OverlayDragSession {
  /** Whether the gesture is still running. */
  readonly active: boolean;
  /**
   * Ends the gesture and releases every listener, dropping any update not yet
   * delivered. Idempotent.
   */
  cancel: () => void;
}

/**
 * Starts a pointer drag on an image overlay and returns a handle to it.
 *
 * This is the single pointer-drag implementation behind the framework overlay
 * hooks: it owns pointer capture, the drag class, the document-level
 * `pointermove` / `pointerup` / `pointercancel` / `lostpointercapture`
 * listeners, animation-frame coalescing and teardown, leaving each host with
 * nothing but its own state update in {@link OverlayDragSessionOptions.onChange}. Call it from a pointer-down
 * handler after the host has decided the gesture applies.
 *
 * Framework-agnostic on purpose — no effect or watcher is involved, so the
 * session can be created from a plain DOM listener as well. It lives in the
 * browser layer because it drives real DOM APIs; the rectangle arithmetic it
 * applies stays in the DOM-free core as {@link moveImageOverlayRect} and
 * {@link resizeImageOverlayRect}. Updates are coalesced with
 * `requestAnimationFrame` where the runtime provides it, and delivered
 * synchronously where it does not; an update still queued when the pointer is
 * released or cancelled is delivered before `onEnd`.
 *
 * The rectangle is never clamped to the content area beyond the `'resize'`
 * minimum size, so an overlay can be dragged partly out of view; a host needing
 * containment clamps inside `onChange`.
 *
 * @param options - Gesture description and callbacks.
 * @returns A handle whose `cancel()` ends the gesture early.
 */
export function createOverlayDragSession(options: OverlayDragSessionOptions): OverlayDragSession {
  const { mode, rect, startX, startY, pointerId, captureElement, activeElement, dragClass } =
    options;
  const coalesces =
    typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function';
  const target = typeof document === 'undefined' ? undefined : document;

  let active = true;
  let frame = 0;
  // Rect computed by the latest move and not yet handed to `onChange`.
  let pending: ImageOverlayRect | null = null;

  const owns = (event: PointerEvent): boolean =>
    pointerId === undefined || event.pointerId === pointerId;

  const deliver = (): void => {
    frame = 0;
    const next = pending;
    pending = null;
    if (next) options.onChange(next);
  };

  const handleMove = (event: PointerEvent): void => {
    if (!owns(event)) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    pending =
      mode === 'move'
        ? moveImageOverlayRect(rect, deltaX, deltaY)
        : resizeImageOverlayRect(rect, deltaX, deltaY, options.minSize);
    if (!coalesces) deliver();
    else if (!frame) frame = requestAnimationFrame(deliver);
  };

  // The one teardown path. A gesture the browser ended delivers its last
  // position first; an explicit cancel() drops it.
  const end = (settle: boolean): void => {
    if (!active) return;
    active = false;
    if (frame && coalesces) cancelAnimationFrame(frame);
    if (settle) deliver();
    frame = 0;
    pending = null;
    if (dragClass) activeElement?.classList.remove(dragClass);
    target?.removeEventListener('pointermove', handleMove);
    target?.removeEventListener('pointerup', handleEnd);
    target?.removeEventListener('pointercancel', handleEnd);
    target?.removeEventListener('lostpointercapture', handleEnd);
    options.registry?.delete(cancel);
    options.onEnd?.();
  };

  const handleEnd = (event: PointerEvent): void => {
    if (owns(event)) end(true);
  };

  const cancel = (): void => end(false);

  if (pointerId !== undefined) captureElement?.setPointerCapture(pointerId);
  if (dragClass) activeElement?.classList.add(dragClass);
  target?.addEventListener('pointermove', handleMove);
  target?.addEventListener('pointerup', handleEnd);
  target?.addEventListener('pointercancel', handleEnd);
  target?.addEventListener('lostpointercapture', handleEnd);
  options.registry?.add(cancel);

  return {
    get active() {
      return active;
    },
    cancel,
  };
}
