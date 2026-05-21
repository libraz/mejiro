import { tokenizeManuscriptSource } from '@libraz/mejiro';
import type { ManuscriptDialect } from '@libraz/mejiro/epub';
import {
  type ChangeEvent,
  type CSSProperties,
  forwardRef,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';

/** Props for {@link MejiroNotationHighlighter}. */
export interface MejiroNotationHighlighterProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  /** Source manuscript text. */
  value: string;
  /** Called whenever the textarea content changes. */
  onChange: (next: string) => void;
  /** Manuscript notation dialect. @defaultValue `'mejiro'` */
  dialect?: ManuscriptDialect;
  /** Class applied to the wrapper element. */
  wrapperClassName?: string;
  /** Inline style on the wrapper element. */
  wrapperStyle?: CSSProperties;
}

/**
 * Textarea with a notation-highlight overlay. The overlay sits *behind* the
 * textarea and tints the background of manuscript notation tokens (ruby,
 * emphasis dots, tate-chu-yoko, em / strong, links, footnotes) so authors can
 * see at a glance which characters carry notation.
 *
 * The textarea is fully interactive; selection, undo / redo, and the
 * browser-native caret are unaffected. Notation kinds are exposed via
 * `data-token` attributes on the overlay spans so hosts can restyle them via
 * CSS (`.mejiro-notation-token[data-token="ruby"]` etc.).
 */
export const MejiroNotationHighlighter = forwardRef<
  HTMLTextAreaElement,
  MejiroNotationHighlighterProps
>(function MejiroNotationHighlighter(
  {
    value,
    onChange,
    dialect = 'mejiro',
    wrapperClassName,
    wrapperStyle,
    className,
    style,
    onScroll,
    ...rest
  },
  ref: Ref<HTMLTextAreaElement>,
): ReactNode {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement, []);

  const segments = useMemo(() => buildSegments(value, dialect), [value, dialect]);

  return (
    <div
      className={`mejiro-notation-highlighter${wrapperClassName ? ` ${wrapperClassName}` : ''}`}
      style={wrapperStyle}
    >
      <div
        ref={overlayRef}
        className="mejiro-notation-overlay"
        aria-hidden="true"
        // Trailing space + zero-width joiner ensures the overlay matches a
        // trailing newline's visual position in the textarea.
      >
        {segments.map((segment) => (
          <span
            key={segment.key}
            className={
              segment.kind ? `mejiro-notation-token mejiro-notation-${segment.kind}` : undefined
            }
            data-token={segment.kind}
          >
            {segment.text}
          </span>
        ))}
        {'​'}
      </div>
      <textarea
        {...rest}
        ref={textareaRef}
        className={`mejiro-notation-textarea${className ? ` ${className}` : ''}`}
        style={style}
        value={value}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
        onScroll={(event) => {
          if (overlayRef.current) {
            overlayRef.current.scrollTop = event.currentTarget.scrollTop;
            overlayRef.current.scrollLeft = event.currentTarget.scrollLeft;
          }
          onScroll?.(event);
        }}
        spellCheck={false}
      />
    </div>
  );
});

interface Segment {
  key: string;
  text: string;
  kind?: string;
}

function buildSegments(text: string, dialect: ManuscriptDialect): Segment[] {
  const tokens = tokenizeManuscriptSource(text, dialect);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const [i, token] of tokens.entries()) {
    if (token.start > cursor) {
      segments.push({ key: `t-${i}-pre`, text: text.slice(cursor, token.start) });
    }
    segments.push({
      key: `t-${i}`,
      text: text.slice(token.start, token.end),
      kind: token.kind,
    });
    cursor = token.end;
  }
  if (cursor < text.length) {
    segments.push({ key: 'tail', text: text.slice(cursor) });
  }
  if (segments.length === 0) {
    segments.push({ key: 'empty', text });
  }
  return segments;
}
