import type { ImageOverlayRect } from '@libraz/mejiro';
import {
  type ComponentPropsWithoutRef,
  forwardRef,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useI18n } from './i18n.js';

/** Props for {@link MejiroImagePlaceholder}; other `div` attributes go to the root element. */
export interface MejiroImagePlaceholderProps extends ComponentPropsWithoutRef<'div'> {
  /** Position and size of the placeholder (px). */
  rect: ImageOverlayRect;
  /** Label inside the placeholder. @defaultValue `messages.imageButton` */
  label?: string;
  /** Pointer-down on the body (drag). */
  onOverlayPointerDown?: (e: ReactPointerEvent) => void;
  /** Pointer-down on the resize handle. */
  onResizePointerDown?: (e: ReactPointerEvent) => void;
  /** Triggered when the close button is pressed. */
  onClose?: () => void;
}

/**
 * Decorative image placeholder with drag and resize affordances, drawn where
 * an image overlay excludes text. Pair the pointer handlers with
 * {@link useImageOverlay}.
 */
export const MejiroImagePlaceholder = forwardRef<HTMLDivElement, MejiroImagePlaceholderProps>(
  function MejiroImagePlaceholder(
    {
      rect,
      label,
      onOverlayPointerDown,
      onResizePointerDown,
      onClose,
      className,
      style,
      onPointerDown,
      ...rest
    },
    ref,
  ): ReactNode {
    const messages = useI18n();
    const resolvedLabel = label ?? messages.imageButton;

    return (
      <div
        {...rest}
        ref={ref}
        className={
          className ? `mejiro-reader-image-overlay ${className}` : 'mejiro-reader-image-overlay'
        }
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          ...style,
        }}
        onPointerDown={(e) => {
          onPointerDown?.(e);
          onOverlayPointerDown?.(e);
        }}
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
          // A press here must not start a drag of the placeholder it sits on.
          onPointerDown={(e) => e.stopPropagation()}
          // One path for pointer, keyboard and assistive-technology activation.
          onClick={() => onClose?.()}
        />
      </div>
    );
  },
);
