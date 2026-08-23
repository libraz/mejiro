import { type CSSProperties, type ReactNode, useRef, useState } from 'react';
import { useI18n } from './i18n.js';

/** Props for {@link MejiroDropZone}. */
export interface MejiroDropZoneProps {
  /** File `accept` filter for the picker. @defaultValue '.epub' */
  accept?: string;
  /** Validator. Defaults to `name.endsWith('.epub')`. */
  validateFile?: (file: File) => boolean;
  /** Called with the selected/dropped file. */
  onFile: (file: File) => void;
  /** Custom body content (replaces default icon/text). */
  children?: ReactNode;
  /** Additional class name for the root element. */
  className?: string;
  /** Additional inline styles. */
  style?: CSSProperties;
}

/**
 * Drop zone for EPUB files. Combines drag-and-drop with a click-to-open file
 * picker. The root is a real button, so it is reachable with Tab, announced as
 * a control by screen readers, and opens the picker on Enter / Space.
 */
export function MejiroDropZone({
  accept = '.epub',
  validateFile,
  onFile,
  children,
  className,
  style,
}: MejiroDropZoneProps): ReactNode {
  const messages = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragover, setDragover] = useState(false);

  const isValid = (file: File): boolean => {
    if (validateFile) return validateFile(file);
    return file.name.endsWith('.epub');
  };

  const rootClass = ['mejiro-reader-drop-zone', dragover ? 'is-dragover' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={rootClass}
      style={style}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        // Cancel the browser's own activation so the picker opens exactly once.
        e.preventDefault();
        inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragover(true);
      }}
      onDragLeave={() => setDragover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragover(false);
        const file = e.dataTransfer?.files[0];
        if (file && isValid(file)) onFile(file);
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
          if (file && isValid(file)) onFile(file);
        }}
      />
    </button>
  );
}
