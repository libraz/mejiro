import {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  forwardRef,
  type ReactNode,
  useRef,
  useState,
} from 'react';
import { useI18n } from './i18n.js';

/** Props for {@link MejiroDropZone}; other `button` attributes go to the root element. */
export interface MejiroDropZoneProps extends ComponentPropsWithoutRef<'button'> {
  /** File `accept` filter for the picker. @defaultValue '.epub' */
  accept?: string;
  /** Validator. Defaults to the `accept` filter, with extensions matched case-insensitively. */
  validateFile?: (file: File) => boolean;
  /** Called with the selected/dropped file. */
  onFile: (file: File) => void;
  /**
   * Called with a selected or dropped file that is not accepted: `'type'` when
   * it fails the `accept` filter, `'validation'` when
   * {@link MejiroDropZoneProps.validateFile} returns `false`.
   */
  onReject?: (file: File, reason: 'type' | 'validation') => void;
  /** Custom body content (replaces default icon/text). */
  children?: ReactNode;
  /** Additional class name for the root element. */
  className?: string;
  /** Additional inline styles. */
  style?: CSSProperties;
}

/**
 * Applies an `accept` filter the way the file picker does: extensions match
 * case-insensitively, `type/*` matches a MIME family, anything else an exact type.
 */
function matchesAccept(accept: string, file: File): boolean {
  const tokens = accept
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return tokens.some((token) => {
    if (token.startsWith('.')) return name.endsWith(token);
    if (token.endsWith('/*')) return type.startsWith(token.slice(0, -1));
    return type === token;
  });
}

/**
 * Drop zone for EPUB files. Combines drag-and-drop with a click-to-open file
 * picker. The root is a real button, so it is reachable with Tab, announced as
 * a control by screen readers, and opens the picker on Enter / Space.
 */
export const MejiroDropZone = forwardRef<HTMLButtonElement, MejiroDropZoneProps>(
  function MejiroDropZone(
    {
      accept = '.epub',
      validateFile,
      onFile,
      onReject,
      children,
      className,
      style,
      onClick,
      onKeyDown,
      onDragOver,
      onDragLeave,
      onDrop,
      ...rest
    },
    ref,
  ): ReactNode {
    const messages = useI18n();
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [dragover, setDragover] = useState(false);

    const receive = (file: File): void => {
      if (validateFile) {
        if (validateFile(file)) onFile(file);
        else onReject?.(file, 'validation');
        return;
      }
      if (matchesAccept(accept, file)) onFile(file);
      else onReject?.(file, 'type');
    };

    const rootClass = ['mejiro-reader-drop-zone', dragover ? 'is-dragover' : '', className ?? '']
      .filter(Boolean)
      .join(' ');

    return (
      <button
        type="button"
        {...rest}
        ref={ref}
        className={rootClass}
        style={style}
        onClick={(e) => {
          onClick?.(e);
          inputRef.current?.click();
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.key !== 'Enter' && e.key !== ' ') return;
          // Cancel the browser's own activation so the picker opens exactly once.
          e.preventDefault();
          inputRef.current?.click();
        }}
        onDragOver={(e) => {
          onDragOver?.(e);
          e.preventDefault();
          setDragover(true);
        }}
        onDragLeave={(e) => {
          onDragLeave?.(e);
          setDragover(false);
        }}
        onDrop={(e) => {
          onDrop?.(e);
          e.preventDefault();
          setDragover(false);
          const file = e.dataTransfer?.files[0];
          if (file) receive(file);
        }}
      >
        {children ?? (
          <>
            <div className="mejiro-reader-drop-zone-icon">{'\u{1F4D6}'}</div>
            <div className="mejiro-reader-drop-zone-text">
              <strong>{messages.dropZoneTitle}</strong>
            </div>
            <div className="mejiro-reader-drop-zone-hint">{messages.dropZoneHint}</div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Cleared so picking the same file again still fires `change`.
            e.target.value = '';
            if (file) receive(file);
          }}
        />
      </button>
    );
  },
);
