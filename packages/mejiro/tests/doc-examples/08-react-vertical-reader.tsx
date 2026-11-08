/** @jsxImportSource react */
export { book, VerticalReader };

// #region doc:reader

import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { MejiroBook } from '@libraz/mejiro/book';
import { MejiroPageView, useImageOverlay } from '@libraz/mejiro-react';
import { useCallback, useEffect, useRef, useState } from 'react';

const book = new MejiroBook({
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
  lineSpacing: 1.8,
});

function VerticalReader({ paragraphs }: { paragraphs: { text: string }[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<ChapterLayout | null>(null);
  const [spread, setSpread] = useState<SpreadResult | null>(null);
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });

  // Image overlays: every change re-flows the spread around them
  const { currentImages, addOverlay, clearOverlays, onOverlayPointerDown, onResizePointerDown } =
    useImageOverlay(layout, { spreadIndex, onReflow: setSpread });
  const overlay = currentImages[0];

  // Measure the container and lay out the chapter
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const { pageWidth, pageHeight } = book.fitPageSize(el);
    setPageSize({ width: pageWidth, height: pageHeight });

    book.layoutChapter({ paragraphs }).then((lo) => {
      setLayout(lo);
      setSpread(lo.getSpread(0));
      setSpreadIndex(0);
    });
  }, [paragraphs]);

  // Navigate spreads
  const goTo = useCallback(
    (index: number) => {
      if (!layout) return;
      setSpreadIndex(index);
      setSpread(layout.getSpread(index));
    },
    [layout],
  );

  // The measured container renders on every path, so the effect finds it on first commit.
  if (!spread) return <div ref={containerRef}>Loading...</div>;

  const spreadCount = Math.ceil(spread.pageCount / 2);

  return (
    <div ref={containerRef}>
      <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
        {/* Right page (first in vertical-rl order) */}
        <div style={{ width: pageSize.width, height: pageSize.height, position: 'relative' }}>
          <MejiroPageView
            result={spread.right}
            fontFamily='"Noto Serif JP"'
            lineSpacing={1.8}
            slotMode={spread.right.hasImages}
            style={{ width: '100%', height: '100%' }}
          />
          {/* Image overlay on the right page */}
          {overlay && (
            <div
              style={{
                position: 'absolute',
                left: overlay.rect.x,
                top: overlay.rect.y,
                width: overlay.rect.width,
                height: overlay.rect.height,
                background: 'rgba(0,0,0,0.1)',
                border: '2px dashed #888',
                cursor: 'move',
              }}
              onPointerDown={(e) => onOverlayPointerDown(overlay.id, e)}
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
                onPointerDown={(e) => onResizePointerDown(overlay.id, e)}
              />
            </div>
          )}
        </div>

        {/* Left page */}
        <div style={{ width: pageSize.width, height: pageSize.height }}>
          <MejiroPageView
            result={spread.left}
            fontFamily='"Noto Serif JP"'
            lineSpacing={1.8}
            slotMode={spread.left.hasImages}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: 8 }}>
        <button type="button" onClick={() => goTo(spreadIndex - 1)} disabled={spreadIndex === 0}>
          Previous
        </button>
        <span style={{ margin: '0 1em' }}>
          {spreadIndex + 1} / {spreadCount}
        </span>
        <button
          type="button"
          onClick={() => goTo(spreadIndex + 1)}
          disabled={spreadIndex >= spreadCount - 1}
        >
          Next
        </button>
        <button
          type="button"
          onClick={() => (overlay ? clearOverlays(spreadIndex) : addOverlay())}
          style={{ marginLeft: '1em' }}
        >
          {overlay ? 'Remove Image' : 'Add Image'}
        </button>
      </div>
    </div>
  );
}

// #endregion doc:reader
