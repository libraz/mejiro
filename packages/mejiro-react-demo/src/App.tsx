import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { DEFAULT_HEADING_STYLES, DEFAULT_PAGE_PADDING, MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { parseEpub } from '@libraz/mejiro/epub';
import { MejiroPageView, useImageOverlay } from '@libraz/mejiro-react';
import { useCallback, useEffect, useRef, useState } from 'react';

const FONTS = [
  { value: "'Shippori Mincho', serif", label: 'Shippori Mincho' },
  { value: "'Noto Serif JP', serif", label: 'Noto Serif JP' },
  { value: "'Zen Kaku Gothic New', sans-serif", label: 'Zen Kaku Gothic New' },
  { value: 'serif', label: 'System Serif' },
];

const bookRef = new MejiroBook({
  fontFamily: FONTS[0].value,
  fontSize: 16,
  lineSpacing: 1.9,
  headingStyles: DEFAULT_HEADING_STYLES,
});

export default function App() {
  const [epub, setEpub] = useState<EpubBook | null>(null);
  const [layout, setLayout] = useState<ChapterLayout | null>(null);
  const [spread, setSpread] = useState<SpreadResult | null>(null);
  const [spreadIdx, setSpreadIdx] = useState(0);
  const [chapter, setChapter] = useState(0);
  const [loading, setLoading] = useState(false);
  const [turning, setTurning] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fontFamily, setFontFamily] = useState(FONTS[0].value);
  const [fontSize, setFontSize] = useState(16);
  const [lineSpacing, setLineSpacing] = useState(1.9);
  const [mode, setMode] = useState<'strict' | 'loose'>('strict');
  const [hanging, setHanging] = useState(true);
  const [stats, setStats] = useState('');
  const [pageW, setPageW] = useState(0);
  const [pageH, setPageH] = useState(0);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const spreadIdxRef = useRef(spreadIdx);
  spreadIdxRef.current = spreadIdx;

  // Image overlay hook manages imageRect state, drag, and resize internally
  const onImageUpdate = useCallback((s: SpreadResult) => setSpread(s), []);
  const { imageRect, hasImage, toggleImage, onOverlayPointerDown, onResizePointerDown } =
    useImageOverlay(layout, spreadIdx, onImageUpdate);

  const contentH = pageH - DEFAULT_PAGE_PADDING.y - DEFAULT_PAGE_PADDING.bottom;
  const totalSpreads = spread ? Math.ceil(spread.totalPages / 2) : 0;

  // Load EPUB
  const loadEpub = useCallback(async (buf: ArrayBuffer) => {
    setLoading(true);
    try {
      const result = await parseEpub(buf);
      setEpub(result);
      setChapter(0);
      setSpreadIdx(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch('/neko.epub')
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((buf) => {
        if (buf) loadEpub(buf);
      });
  }, [loadEpub]);

  // Layout chapter
  useEffect(() => {
    if (!epub) return;
    const ch = epub.chapters[chapter];
    if (!ch) return;
    if (!surfaceRef.current) return;

    bookRef.setOptions({ fontFamily, fontSize, lineSpacing, mode, enableHanging: hanging });
    const { pageWidth, pageHeight } = bookRef.computePageSize(surfaceRef.current);

    setPageW(pageWidth);
    setPageH(pageHeight);

    const t0 = performance.now();
    bookRef.layoutChapter(ch).then((l) => {
      const elapsed = performance.now() - t0;
      setLayout(l);
      setSpreadIdx(0);
      const totalChars = ch.paragraphs.reduce((s, p) => s + p.text.length, 0);
      const totalRuby = ch.paragraphs.reduce((s, p) => s + p.rubyAnnotations.length, 0);
      const fontLabel = FONTS.find((f) => f.value === fontFamily)?.label ?? '';
      setStats(
        [
          `${totalChars}ch`,
          `${l.totalPages}pp`,
          totalRuby > 0 ? `${totalRuby}ruby` : null,
          `${fontLabel} ${fontSize}px`,
          `${elapsed.toFixed(0)}ms`,
        ]
          .filter(Boolean)
          .join(' / '),
      );
    });
  }, [epub, chapter, fontFamily, fontSize, lineSpacing, mode, hanging]);

  // Update spread when layout/index changes (no image)
  useEffect(() => {
    if (!layout) return;
    if (!imageRect) {
      setSpread(layout.getSpread(spreadIdx));
    }
  }, [layout, spreadIdx, imageRect]);

  // Keyboard + resize
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!layoutRef.current) return;
      const total = Math.ceil(layoutRef.current.totalPages / 2);
      if (e.key === 'ArrowLeft') navigate(1, total);
      if (e.key === 'ArrowRight') navigate(-1, total);
    };
    const onResize = () => {
      if (!(surfaceRef.current && layoutRef.current)) return;
      const { pageWidth, pageHeight, contentHeight } = bookRef.computePageSize(surfaceRef.current);
      setPageW(pageWidth);
      setPageH(pageHeight);
      // Derive lineWidth from contentHeight (same formula as verticalLineWidth)
      const lineWidth = contentHeight - fontSize * 0.5;
      layoutRef.current.resize({ pageWidth, lineWidth });
      setSpread(layoutRef.current.getSpread(spreadIdxRef.current));
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [fontSize]);

  const navigate = useCallback((delta: number, total: number) => {
    setSpreadIdx((prev) => {
      const next = prev + delta;
      if (next < 0 || next >= total) return prev;
      setTurning(true);
      setTimeout(() => {
        setSpreadIdx(next);
        setTurning(false);
      }, 180);
      return prev;
    });
  }, []);

  const runningTitleRight = epub
    ? epub.author
      ? `${epub.author}  ${epub.title}`
      : epub.title
    : '';
  const runningTitleLeft = epub?.chapters[chapter]?.title ?? '';
  const currentPage = spreadIdx * 2;
  const fontStyle = { fontSize: `${fontSize}px`, fontFamily, lineHeight: `${lineSpacing}` };

  return (
    <>
      <header>
        <div className="header-left">
          <div className="logo">
            <span className="logo-mark">mejiro</span>
            <span className="logo-sub">React Demo</span>
          </div>
          {epub && (
            <div className="chapter-nav">
              <select
                value={chapter}
                onChange={(e) => {
                  setChapter(Number(e.target.value));
                  setSpreadIdx(0);
                }}
              >
                {epub.chapters.map((ch, i) => (
                  <option key={i} value={i}>
                    {ch.title ?? `Chapter ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="header-actions">
          <span className="stats">{stats}</span>
          <button type="button" className="btn-header" onClick={() => fileRef.current?.click()}>
            Open
          </button>
          <button
            type="button"
            className={`btn-header${hasImage ? ' active' : ''}`}
            onClick={toggleImage}
          >
            Image
          </button>
          <button
            type="button"
            className={`btn-header${settingsOpen ? ' active' : ''}`}
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            Settings<span className="arrow">&#9662;</span>
          </button>
        </div>
      </header>

      <div className={`settings-panel${settingsOpen ? ' open' : ''}`}>
        <div className="settings-inner">
          <div className="settings-group">
            <span className="settings-group-title">Font</span>
            <div className="control">
              <select value={fontFamily} onChange={(e) => setFontFamily(e.target.value)}>
                {FONTS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="control">
              <label className="control-label">Size</label>
              <input
                type="number"
                value={fontSize}
                min={10}
                max={48}
                onChange={(e) => setFontSize(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="settings-group">
            <span className="settings-group-title">Layout</span>
            <div className="control">
              <label className="control-label">Kinsoku</label>
              <select value={mode} onChange={(e) => setMode(e.target.value as 'strict' | 'loose')}>
                <option value="strict">Strict</option>
                <option value="loose">Loose</option>
              </select>
            </div>
            <div className="control">
              <label className="control-label">Hanging</label>
              <select
                value={String(hanging)}
                onChange={(e) => setHanging(e.target.value === 'true')}
              >
                <option value="true">On</option>
                <option value="false">Off</option>
              </select>
            </div>
            <div className="control">
              <label className="control-label">行間</label>
              <input
                className="line-spacing"
                type="number"
                value={lineSpacing}
                min={1.0}
                max={3.0}
                step={0.1}
                onChange={(e) => setLineSpacing(Number(e.target.value))}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="reading-surface" ref={surfaceRef}>
        {!(epub || loading) && (
          <div className="drop-zone" onClick={() => fileRef.current?.click()}>
            <div className="drop-zone-icon">&#x1F4D6;</div>
            <div className="drop-zone-text">
              <strong>Drop an EPUB file here</strong>
              <br />
              or click to browse
            </div>
            <div className="drop-zone-hint">Supports EPUB with furigana / ruby</div>
          </div>
        )}
        {loading && <div className="loading-indicator">Loading...</div>}
        {epub && spread && pageW > 0 && (
          <div className="book">
            <div className={`spread${turning ? ' turning' : ''}`}>
              <div
                className="page-container page-right"
                style={{ width: pageW, height: pageH, overflow: hasImage ? 'visible' : undefined }}
              >
                <div className="page-rule" />
                <div className="page-header">
                  <span className="page-header-title">{runningTitleRight}</span>
                  <span className="page-header-num">{currentPage + 1}</span>
                </div>
                <div className="page-viewport">
                  <div className="page-clip" style={{ height: contentH }}>
                    <MejiroPageView
                      result={spread.right}
                      slotMode={hasImage}
                      className="page-content"
                      style={{ ...fontStyle, height: contentH }}
                      fontFamily={fontFamily}
                      lineSpacing={lineSpacing}
                    />
                  </div>
                </div>
                {imageRect && (
                  <div
                    className="image-overlay visible"
                    style={{
                      left: imageRect.x,
                      top: imageRect.y,
                      width: imageRect.w,
                      height: imageRect.h,
                      cursor: 'grab',
                      touchAction: 'none',
                    }}
                    onPointerDown={onOverlayPointerDown}
                  >
                    <div className="image-overlay-label">
                      <div className="image-overlay-icon" />
                      <span>Image</span>
                    </div>
                    <div className="image-overlay-resize" onPointerDown={onResizePointerDown} />
                    <div
                      className="image-overlay-close"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        toggleImage();
                      }}
                    />
                  </div>
                )}
              </div>
              <div className="page-container page-left" style={{ width: pageW, height: pageH }}>
                <div className="page-rule" />
                <div className="page-header">
                  <span className="page-header-title">{runningTitleLeft}</span>
                  <span className="page-header-num">
                    {currentPage + 2 <= spread.totalPages ? currentPage + 2 : ''}
                  </span>
                </div>
                <div className="page-viewport">
                  <div className="page-clip" style={{ height: contentH }}>
                    <MejiroPageView
                      result={spread.left}
                      slotMode={hasImage}
                      className="page-content"
                      style={{ ...fontStyle, height: contentH }}
                      fontFamily={fontFamily}
                      lineSpacing={lineSpacing}
                    />
                  </div>
                </div>
              </div>
              <div className="nav-zone nav-zone--prev" onClick={() => navigate(-1, totalSpreads)} />
              <div className="nav-zone nav-zone--next" onClick={() => navigate(1, totalSpreads)} />
              <div className="page-indicator">
                {spreadIdx + 1} / {totalSpreads}
              </div>
            </div>
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".epub"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) file.arrayBuffer().then(loadEpub);
        }}
      />
    </>
  );
}
