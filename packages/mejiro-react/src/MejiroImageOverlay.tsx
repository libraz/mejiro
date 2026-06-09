import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import { useI18n } from './i18n.js';
import type { ImageRect } from './useImageOverlay.js';

/** Props for {@link MejiroImageOverlay}. */
export interface MejiroImageOverlayProps {
  /** Position and size of the overlay (px). */
  rect: ImageRect;
  /** Label inside the overlay. @defaultValue `messages.imageButton` */
  label?: string;
  /** Pointer-down on the body (drag). */
  onOverlayPointerDown?: (e: ReactPointerEvent) => void;
  /** Pointer-down on the resize handle. */
  onResizePointerDown?: (e: ReactPointerEvent) => void;
  /** Triggered when the close button is pressed. */
  onClose?: () => void;
}

/**
 * Decorative image placeholder overlay with drag/resize affordances.
 * Pair the pointer handlers with {@link useImageOverlay} or {@link useMultiImageOverlay}.
 */
export function MejiroImageOverlay({
  rect,
  label,
  onOverlayPointerDown,
  onResizePointerDown,
  onClose,
}: MejiroImageOverlayProps): ReactNode {
  const messages = useI18n();
  const resolvedLabel = label ?? messages.imageButton;

  return (
    <div
      className="mejiro-reader-image-overlay"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
      }}
      onPointerDown={onOverlayPointerDown}
    >
      <div className="mejiro-reader-image-overlay-label">
        <div className="mejiro-reader-image-overlay-icon" />
        <span>{resolvedLabel}</span>
      </div>
      <div className="mejiro-reader-image-overlay-resize" onPointerDown={onResizePointerDown} />
      <button
        type="button"
        aria-label={messages.imageRemoveButton}
        title={messages.imageRemoveButton}
        className="mejiro-reader-image-overlay-close"
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onClose?.();
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.stopPropagation();
          e.preventDefault();
          onClose?.();
        }}
      />
    </div>
  );
}
