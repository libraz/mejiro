// Headless = bypass MejiroReader, build the UI yourself from the hooks.
// Shown here: custom header + MejiroSpread + custom prev/next zones.
import '@libraz/mejiro/render/mejiro-fonts.css';
import { DEFAULT_BOOK_OPTIONS } from '@libraz/mejiro/book';
import {
  MejiroSpread,
  useChapterLayout,
  useEpub,
  useMejiroBook,
  useSpread,
} from '@libraz/mejiro-react';
import { useRef, useState } from 'react';
import './styles.css';

export default function App() {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [chapter] = useState(0);

  const { book } = useMejiroBook({
    ...DEFAULT_BOOK_OPTIONS,
    fontSize: 18,
    lineSpacing: 2.0,
  });
  const { epub } = useEpub({ defaultUrl: '/neko.epub' });
  const layoutCtx = useChapterLayout(book, epub, chapter, surfaceRef);
  const spreadCtx = useSpread(layoutCtx.layout, { enableKeyboard: true });

  const heading = !epub
    ? '読み込み中…'
    : epub.author
      ? `${epub.author} — ${epub.title}`
      : epub.title;
  const opts = book.getOptions();

  return (
    <div className="shell">
      <header className="bar">
        <span className="title">{heading}</span>
        {spreadCtx.spread && (
          <span className="nav-info">
            {spreadCtx.spreadIdx + 1} / {spreadCtx.totalSpreads}
          </span>
        )}
      </header>

      <div ref={surfaceRef} className="surface">
        {spreadCtx.spread && layoutCtx.layout ? (
          <MejiroSpread
            spread={spreadCtx.spread}
            pageWidth={layoutCtx.pageWidth}
            pageHeight={layoutCtx.pageHeight}
            contentHeight={layoutCtx.contentHeight}
            fontFamily={opts.fontFamily}
            fontSize={opts.fontSize}
            lineSpacing={opts.lineSpacing}
            turning={spreadCtx.turning}
            onPrev={spreadCtx.prev}
            onNext={spreadCtx.next}
          />
        ) : (
          <p className="loading">Loading…</p>
        )}
      </div>
    </div>
  );
}
