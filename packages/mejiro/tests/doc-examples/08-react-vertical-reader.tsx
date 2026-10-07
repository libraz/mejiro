/** @jsxImportSource react */
export { book, VerticalReader };

// #region doc:reader

import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { DEFAULT_HEADING_STYLES, MejiroBook } from '@libraz/mejiro/book';
import { MejiroPageView, useImageOverlay } from '@libraz/mejiro-react';
import { useCallback, useEffect, useRef, useState } from 'react';

const book = new MejiroBook({
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineSpacing: 1.8,
  headingStyles: DEFAULT_HEADING_STYLES,
});

function VerticalReader({ paragraphs }: { paragraphs: { text: string }[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<ChapterLayout | null>(null);
  const [spread, setSpread] = useState<SpreadResult | null>(null);
  const [spreadIdx, setSpreadIdx] = useState(0);
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });

  // Image overlay hook
  const { imageRect, hasImage, toggleImage, onOverlayPointerDown, onResizePointerDown } =
    useImageOverlay(layout, spreadIdx, setSpread);

  // Compute page size from container and lay out the chapter
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const { pageWidth, pageHeight } = book.computePageSize(el);
    setPageSize({ w: pageWidth, h: pageHeight });

    book.layoutChapter({ paragraphs }).then((lo) => {
      setLayout(lo);
      setSpread(lo.getSpread(0));
      setSpreadIdx(0);
    });
  }, [paragraphs]);

  // Navigate spreads
  const goTo = useCallback(
    (idx: number) => {
      if (!layout) return;
      setSpreadIdx(idx);
      setSpread(layout.getSpread(idx));
    },
    [layout],
  );

  // The measured container renders on every path, so the effect finds it on first commit.
  if (!spread) return <div ref={containerRef}>Loading...</div>;

  const totalSpreads = Math.ceil(spread.totalPages / 2);

  return (
    <div ref={containerRef}>
      <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
        {/* Right page (first in vertical-rl order) */}
        <div style={{ width: pageSize.w, height: pageSize.h, position: 'relative' }}>
          <MejiroPageView
            result={spread.right}
            fontFamily='"Noto Serif JP"'
            lineSpacing={1.8}
            slotMode={hasImage}
            style={{ width: '100%', height: '100%' }}
          />
          {/* Image overlay on the right page */}
          {imageRect && (
            <div
              style={{
                position: 'absolute',
                left: imageRect.x,
                top: imageRect.y,
                width: imageRect.w,
                height: imageRect.h,
                background: 'rgba(0,0,0,0.1)',
                border: '2px dashed #888',
                cursor: 'move',
              }}
              onPointerDown={onOverlayPointerDown}
            >
              {/* Resize handle */}
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  bottom: 0,
                  width: 16,
                  height: 16,
                  cursor: 'nwse-resize',
                }}
                onPointerDown={onResizePointerDown}
              />
            </div>
          )}
        </div>

        {/* Left page */}
        <div style={{ width: pageSize.w, height: pageSize.h }}>
          <MejiroPageView
            result={spread.left}
            fontFamily='"Noto Serif JP"'
            lineSpacing={1.8}
            slotMode={hasImage}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: 8 }}>
        <button type="button" onClick={() => goTo(spreadIdx - 1)} disabled={spreadIdx === 0}>
          Previous
        </button>
        <span style={{ margin: '0 1em' }}>
          {spreadIdx + 1} / {totalSpreads}
        </span>
        <button
          type="button"
          onClick={() => goTo(spreadIdx + 1)}
          disabled={spreadIdx >= totalSpreads - 1}
        >
          Next
        </button>
        <button type="button" onClick={toggleImage} style={{ marginLeft: '1em' }}>
          {hasImage ? 'Remove Image' : 'Add Image'}
        </button>
      </div>
    </div>
  );
}

// #endregion doc:reader
