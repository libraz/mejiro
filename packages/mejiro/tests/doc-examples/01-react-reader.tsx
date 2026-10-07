/** @jsxImportSource react */
export { book, Reader };

// #region doc:reader

import type { SpreadResult } from '@libraz/mejiro/book';
import { DEFAULT_HEADING_STYLES, MejiroBook } from '@libraz/mejiro/book';
import { parseEpub } from '@libraz/mejiro/epub';
import { MejiroPageView } from '@libraz/mejiro-react';
import { useEffect, useRef, useState } from 'react';

// Create once outside the component so the cache persists across renders
const book = new MejiroBook({
  fontFamily: '"Noto Serif JP", serif',
  fontSize: 16,
  lineSpacing: 1.8,
  headingStyles: DEFAULT_HEADING_STYLES,
});

function Reader() {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [spread, setSpread] = useState<SpreadResult | null>(null);
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    (async () => {
      if (!surfaceRef.current) return;

      // Compute page dimensions from container
      const { pageWidth, pageHeight } = book.computePageSize(surfaceRef.current);
      setPageSize({ w: pageWidth, h: pageHeight });

      // Load EPUB and lay out the first chapter
      const res = await fetch('/book.epub');
      const epub = await parseEpub(await res.arrayBuffer());
      const layout = await book.layoutChapter(epub.chapters[0]);

      // Get first spread
      setSpread(layout.getSpread(0));
    })();
  }, []);

  if (!spread) return <div ref={surfaceRef} style={{ width: '100%', height: '100vh' }} />;

  const style = {
    width: pageSize.w,
    height: pageSize.h,
    fontSize: 16,
    fontFamily: '"Noto Serif JP", serif',
    lineHeight: 1.8,
  };

  return (
    <div ref={surfaceRef} style={{ display: 'flex', justifyContent: 'center' }}>
      <MejiroPageView
        result={spread.right}
        style={style}
        fontFamily='"Noto Serif JP", serif'
        lineSpacing={1.8}
      />
      <MejiroPageView
        result={spread.left}
        style={style}
        fontFamily='"Noto Serif JP", serif'
        lineSpacing={1.8}
      />
    </div>
  );
}

// #endregion doc:reader
