import type { ColumnSlot, PageSlice } from '@libraz/mejiro';
import { computeBreaks, paginate, SpreadExclusionEngine, toCodepoints } from '@libraz/mejiro';
import { CharMeasurer, MejiroBrowser, toFontSpec, verticalLineWidth } from '@libraz/mejiro/browser';
import type { EpubBook } from '@libraz/mejiro/epub';
import { parseEpub } from '@libraz/mejiro/epub';
import type { RenderEntry, RenderPage, RenderSegment } from '@libraz/mejiro/render';
import {
  adjustExclusionSlots,
  buildColumnSlots,
  buildLineMetrics,
  buildParagraphMeasures,
  buildRenderPage,
  getImageXOffset,
  packPageLines,
} from '@libraz/mejiro/render';

// ── Elements ──
const dropZone = document.getElementById('dropZone') as HTMLDivElement;
const loadingEl = document.getElementById('loading') as HTMLDivElement;
const bookEl = document.getElementById('book') as HTMLDivElement;
const spread = document.getElementById('spread') as HTMLDivElement;
const pageRight = document.getElementById('pageRight') as HTMLDivElement;
const pageLeft = document.getElementById('pageLeft') as HTMLDivElement;
const pageContentRight = document.getElementById('pageContentRight') as HTMLDivElement;
const pageContentLeft = document.getElementById('pageContentLeft') as HTMLDivElement;
const runningTitleRight = document.getElementById('runningTitleRight') as HTMLSpanElement;
const runningTitleLeft = document.getElementById('runningTitleLeft') as HTMLSpanElement;
const runningPageRight = document.getElementById('runningPageRight') as HTMLSpanElement;
const runningPageLeft = document.getElementById('runningPageLeft') as HTMLSpanElement;
const pageIndicator = document.getElementById('pageIndicator') as HTMLDivElement;
const navPrev = document.getElementById('navPrev') as HTMLDivElement;
const navNext = document.getElementById('navNext') as HTMLDivElement;
const stats = document.getElementById('stats') as HTMLDivElement;
const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const openFileBtn = document.getElementById('openFile') as HTMLButtonElement;
const settingsToggle = document.getElementById('settingsToggle') as HTMLButtonElement;
const settingsPanel = document.getElementById('settingsPanel') as HTMLDivElement;
const chapterNav = document.getElementById('chapterNav') as HTMLDivElement;
const chapterSelect = document.getElementById('chapterSelect') as HTMLSelectElement;
const fontFamilySelect = document.getElementById('fontFamily') as HTMLSelectElement;
const fontSizeInput = document.getElementById('fontSize') as HTMLInputElement;
const modeSelect = document.getElementById('mode') as HTMLSelectElement;
const hangingSelect = document.getElementById('hanging') as HTMLSelectElement;
const lineSpacingInput = document.getElementById('lineSpacing') as HTMLInputElement;
const imageToggle = document.getElementById('imageToggle') as HTMLButtonElement;

// ── State ──
const mejiro = new MejiroBrowser();
const charMeasurer = new CharMeasurer();
let currentBook: EpubBook | null = null;
let currentChapter = 0;
// currentPage = index of the right page in the spread (always even: 0, 2, 4, ...)
let currentPage = 0;
let totalPages = 0;
let updateTimer: ReturnType<typeof setTimeout> | null = null;

// ── Layout results & page map ──
let renderEntries: RenderEntry[] = [];
let pages: PageSlice[][] = [];

// ── Image exclusion state ──
interface ImagePlacement {
  x: number;
  y: number;
  w: number;
  h: number;
  el: HTMLDivElement;
}
/** Per-spread image placements. Key = spread index (currentPage / 2). */
const spreadImageMap = new Map<number, ImagePlacement[]>();

/** Returns the image placements for the current spread. */
function currentSpreadImages(): ImagePlacement[] {
  const key = Math.floor(currentPage / 2);
  let list = spreadImageMap.get(key);
  if (!list) {
    list = [];
    spreadImageMap.set(key, list);
  }
  return list;
}

/** Cached per-paragraph data for fast re-layout during drag. */
interface CachedParagraph {
  text: Uint32Array;
  advances: Float32Array;
  chars: string[];
  rubyAnnotations: import('@libraz/mejiro/browser').RubyInputAnnotation[];
  headingLevel?: number;
}
let cachedParagraphs: CachedParagraph[] = [];
let cachedLineWidth = 0;
let cachedMode: 'strict' | 'loose' = 'strict';
let cachedHanging = true;

/** Per-spread layout info for exclusion mode. */
interface SpreadLayoutInfo {
  lineStart: number;
  slotCount: number;
  rightSlotCount: number;
  rightSlots: ColumnSlot[];
  leftSlots: ColumnSlot[];
  hasImages: boolean;
}
let exclusionLines: { segments: RenderSegment[]; isHeading: boolean }[] = [];
let exclusionSpreadLayouts: SpreadLayoutInfo[] = [];

// ── Settings toggle ──
settingsToggle.addEventListener('click', () => {
  settingsPanel.classList.toggle('open');
  settingsToggle.classList.toggle('active');
});

// ── Image overlay management ──
function createImageOverlay(x: number, y: number): ImagePlacement {
  const el = document.createElement('div');
  el.className = 'image-overlay visible';
  el.innerHTML = `
    <div class="image-overlay-label"><div class="image-overlay-icon"></div><span>Image</span></div>
    <div class="image-overlay-resize"></div>
    <div class="image-overlay-close"></div>
  `;
  pageRight.appendChild(el);

  const placement: ImagePlacement = { x, y, w: 120, h: 160, el };
  currentSpreadImages().push(placement);
  applyOverlayStyle(placement);
  setupOverlayDrag(placement);
  return placement;
}

function removeImageOverlay(placement: ImagePlacement): void {
  placement.el.remove();
  const list = currentSpreadImages();
  const idx = list.indexOf(placement);
  if (idx >= 0) list.splice(idx, 1);
  // Clean up empty entries
  if (list.length === 0) {
    spreadImageMap.delete(Math.floor(currentPage / 2));
  }
  if (spreadImageMap.size === 0) {
    imageToggle.classList.remove('active');
    pageRight.style.overflow = '';
    renderCurrentSpread();
  } else {
    reflowWithExclusion();
  }
}

function applyOverlayStyle(p: ImagePlacement): void {
  p.el.style.left = `${p.x}px`;
  p.el.style.top = `${p.y}px`;
  p.el.style.width = `${p.w}px`;
  p.el.style.height = `${p.h}px`;
}

function setupOverlayDrag(placement: ImagePlacement): void {
  const resizeEl = placement.el.querySelector('.image-overlay-resize') as HTMLDivElement;
  const closeEl = placement.el.querySelector('.image-overlay-close') as HTMLDivElement;
  let dragging = false;
  let resizing = false;
  let startX = 0;
  let startY = 0;
  let startVal = { x: 0, y: 0, w: 0, h: 0 };

  closeEl.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    removeImageOverlay(placement);
  });

  resizeEl.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    resizing = true;
    startX = e.clientX;
    startY = e.clientY;
    startVal = { x: placement.x, y: placement.y, w: placement.w, h: placement.h };
    placement.el.classList.add('dragging');
    resizeEl.setPointerCapture(e.pointerId);
  });

  placement.el.addEventListener('pointerdown', (e) => {
    if (resizing) return;
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startVal = { x: placement.x, y: placement.y, w: placement.w, h: placement.h };
    placement.el.classList.add('dragging');
    placement.el.setPointerCapture(e.pointerId);
  });

  const onMove = (e: PointerEvent) => {
    if (!(dragging || resizing)) return;
    e.preventDefault();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (resizing) {
      placement.w = Math.max(40, startVal.w + dx);
      placement.h = Math.max(40, startVal.h + dy);
    } else {
      placement.x = startVal.x + dx;
      placement.y = startVal.y + dy;
    }
    applyOverlayStyle(placement);
    scheduleReflow();
  };

  const onUp = () => {
    dragging = false;
    resizing = false;
    placement.el.classList.remove('dragging');
  };

  placement.el.addEventListener('pointermove', onMove);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

let reflowRafId = 0;
function scheduleReflow(): void {
  cancelAnimationFrame(reflowRafId);
  reflowRafId = requestAnimationFrame(() => {
    if (spreadImageMap.size > 0) {
      reflowWithExclusion();
    } else {
      renderCurrentSpread();
    }
  });
}

// ── Image toggle button ──
imageToggle.addEventListener('click', () => {
  if (!currentBook) return;
  imageToggle.classList.add('active');
  pageRight.style.overflow = 'visible';
  // Add image to the current spread
  const list = currentSpreadImages();
  const last = list[list.length - 1];
  const nx = last ? last.x - 100 : 80;
  const ny = last ? last.y + 40 : 100;
  createImageOverlay(nx, ny);
  scheduleReflow();
});

// ── File open ──
openFileBtn.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) loadEpubFile(file);
});

// ── Drag and drop ──
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer?.files[0];
  if (file?.name.endsWith('.epub')) loadEpubFile(file);
});

document.body.addEventListener('dragover', (e) => e.preventDefault());
document.body.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file?.name.endsWith('.epub')) loadEpubFile(file);
});

// ── Settings change listeners ──
fontFamilySelect.addEventListener('change', render);
fontSizeInput.addEventListener('input', debouncedRender);
modeSelect.addEventListener('change', render);
hangingSelect.addEventListener('change', render);
lineSpacingInput.addEventListener('input', debouncedRender);

chapterSelect.addEventListener('change', () => {
  currentChapter = Number(chapterSelect.value);
  currentPage = 0;
  render();
});

// ── Page navigation (2 pages per spread) ──
navPrev.addEventListener('click', () => navigateSpread(-1));
navNext.addEventListener('click', () => navigateSpread(1));

document.addEventListener('keydown', (e) => {
  if (!currentBook) return;
  // In vertical-rl: ArrowLeft = forward (next spread), ArrowRight = backward (prev spread)
  if (e.key === 'ArrowLeft') navigateSpread(1);
  else if (e.key === 'ArrowRight') navigateSpread(-1);
});

function navigateSpread(delta: number): void {
  const next = currentPage + delta * 2;
  if (next < 0 || next >= totalPages) return;

  spread.classList.add('turning');
  setTimeout(() => {
    // Hide overlays for the old spread
    hideSpreadOverlays();
    currentPage = next;
    // Show overlays for the new spread
    showSpreadOverlays();
    renderCurrentSpread();
    updatePageInfo();
    spread.classList.remove('turning');
  }, 180);
}

/** Hide all image overlays for the current spread. */
function hideSpreadOverlays(): void {
  for (const img of currentSpreadImages()) {
    img.el.classList.remove('visible');
  }
}

/** Show image overlays for the current spread (if any). */
function showSpreadOverlays(): void {
  const list = currentSpreadImages();
  for (const img of list) {
    img.el.classList.add('visible');
    // Re-append to DOM if not already there
    if (!img.el.parentElement) pageRight.appendChild(img.el);
  }
  // Update overflow based on whether this spread has images
  pageRight.style.overflow = list.length > 0 ? 'visible' : '';
}

// ── Page sizing ──
const PAGE_PAD_X = 52;
const PAGE_PAD_Y = 56;
const PAGE_PAD_BOTTOM = 40;

function computePageDimensions(): { width: number; height: number; lineWidth: number } {
  const surface = document.querySelector('.reading-surface') as HTMLElement;
  const availH = surface.clientHeight - 56;
  const availW = surface.clientWidth - 48;

  // Book proportions: roughly A5 / bunkobon (≈ 1:1.45)
  const ratio = 1.45;
  let h = Math.min(availH, 780);
  let w = Math.round(h / ratio);

  // Each page is w wide; spread is 2w. Ensure it fits.
  if (w * 2 > availW) {
    w = Math.floor(availW / 2);
    h = Math.round(w * ratio);
  }

  w = Math.max(w, 280);
  h = Math.max(h, 400);

  const lineWidth = h - PAGE_PAD_Y - PAGE_PAD_BOTTOM;
  return { width: w, height: h, lineWidth };
}

function contentWidth(): number {
  return pageRight.clientWidth - PAGE_PAD_X * 2;
}

function applyPageSize(): void {
  const { width, height } = computePageDimensions();
  for (const page of [pageRight, pageLeft]) {
    page.style.width = `${width}px`;
    page.style.height = `${height}px`;
  }

  const contentH = height - PAGE_PAD_Y - PAGE_PAD_BOTTOM;
  pageContentRight.style.height = `${contentH}px`;
  pageContentLeft.style.height = `${contentH}px`;
}

// ── Font ──
function applyFont(el: HTMLElement): void {
  el.style.fontSize = `${fontSizeInput.value}px`;
  el.style.fontFamily = fontFamilySelect.value;
  el.style.lineHeight = lineSpacingInput.value;
}

// ── Heading styles per level (matching mejiro.css) ──
const HEADING_SCALES: Record<number, number> = {
  1: 1.6,
  2: 1.4,
  3: 1.2,
  4: 1.1,
  5: 1.0,
  6: 1.0,
};
const DEFAULT_HEADING_SCALE = 1.4;

function headingScaleFor(level?: number): number {
  if (level == null) return 1;
  return HEADING_SCALES[level] ?? DEFAULT_HEADING_SCALE;
}

// ── Shared heading style options for MeasureOptions ──
import type { HeadingStyle } from '@libraz/mejiro/render';

const DEMO_HEADING_STYLES: Record<number, HeadingStyle> = {
  1: { scale: 1.6, gapAfterEm: 1.4 },
  2: { scale: 1.4, gapAfterEm: 1.2 },
  3: { scale: 1.2, gapAfterEm: 1.0 },
  4: { scale: 1.1, gapAfterEm: 0.8 },
};

function measureOptions(): {
  fontSize: number;
  lineHeight: number;
  headingStyles: Record<number, HeadingStyle>;
} {
  return {
    fontSize: Number(fontSizeInput.value),
    lineHeight: Number(lineSpacingInput.value),
    headingStyles: DEMO_HEADING_STYLES,
  };
}

// ── Pagination ──
function computePages(): void {
  const measures = buildParagraphMeasures(renderEntries, measureOptions());

  pages = paginate(contentWidth(), measures);
  totalPages = Math.max(1, pages.length);
}

// ── Rendering ──
function renderSegmentToDOM(parent: Node, segment: RenderSegment): void {
  if (segment.type === 'text') {
    parent.appendChild(document.createTextNode(segment.text));
  } else {
    const ruby = document.createElement('ruby');
    ruby.appendChild(document.createTextNode(segment.base));
    const rt = document.createElement('rt');
    rt.textContent = segment.rubyText;
    ruby.appendChild(rt);
    parent.appendChild(ruby);
  }
}

function renderPageToDOM(contentEl: HTMLElement, renderPage: RenderPage): void {
  for (const paragraph of renderPage.paragraphs) {
    const paraDiv = document.createElement('div');
    let paraClass = 'mejiro-paragraph';
    if (paragraph.headingLevel != null) {
      paraClass += ` mejiro-paragraph--h${paragraph.headingLevel}`;
    } else if (paragraph.isHeading) {
      paraClass += ' mejiro-paragraph--heading';
    }
    paraDiv.className = paraClass;
    contentEl.appendChild(paraDiv);

    for (let li = 0; li < paragraph.lines.length; li++) {
      if (li > 0) paraDiv.appendChild(document.createElement('br'));
      for (const segment of paragraph.lines[li].segments) {
        renderSegmentToDOM(paraDiv, segment);
      }
    }
  }
}

function renderPage(contentEl: HTMLElement, pageIndex: number): void {
  contentEl.innerHTML = '';
  applyFont(contentEl);

  if (pageIndex < 0 || pageIndex >= totalPages) return;

  const slices = pages[pageIndex];
  if (!slices) return;

  const page = buildRenderPage(slices, renderEntries);
  renderPageToDOM(contentEl, page);
}

function renderCurrentSpread(): void {
  if (spreadImageMap.size > 0) {
    renderExclusionSpread();
    return;
  }
  // Restore normal styles if switching back from exclusion mode
  pageContentRight.style.writingMode = '';
  pageContentRight.style.position = '';
  pageContentLeft.style.writingMode = '';
  pageContentLeft.style.position = '';
  pageRight.style.overflow = '';
  renderPage(pageContentRight, currentPage);
  renderPage(pageContentLeft, currentPage + 1);
}

function updatePageInfo(): void {
  if (!currentBook) return;
  const chapter = currentBook.chapters[currentChapter];
  const chTitle = chapter?.title ?? `${currentChapter + 1}`;

  const headerText = currentBook.author
    ? `${currentBook.author}  ${currentBook.title}`
    : currentBook.title;

  // Right page: title header + page number
  runningTitleRight.textContent = headerText;
  runningPageRight.textContent = `${currentPage + 1}`;

  // Left page: chapter title + page number (if left page exists)
  if (currentPage + 1 < totalPages) {
    runningTitleLeft.textContent = chTitle;
    runningPageLeft.textContent = `${currentPage + 2}`;
  } else {
    runningTitleLeft.textContent = '';
    runningPageLeft.textContent = '';
  }

  // Spread indicator
  const totalSpreads = Math.ceil(totalPages / 2);
  const currentSpread = Math.floor(currentPage / 2) + 1;
  pageIndicator.textContent = `${currentSpread} / ${totalSpreads}`;
}

// ── EPUB Loading ──
async function loadEpubFile(file: File): Promise<void> {
  const buffer = await file.arrayBuffer();
  await loadEpubBuffer(buffer);
}

async function loadEpubBuffer(buffer: ArrayBuffer): Promise<void> {
  dropZone.classList.add('hidden');
  bookEl.classList.remove('visible');
  loadingEl.classList.add('visible');
  stats.textContent = '';

  try {
    currentBook = await parseEpub(buffer);
    currentChapter = 0;
    currentPage = 0;

    chapterSelect.innerHTML = '';
    currentBook.chapters.forEach((ch, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = ch.title ?? `Chapter ${i + 1}`;
      chapterSelect.appendChild(option);
    });
    chapterNav.classList.add('visible');

    loadingEl.classList.remove('visible');
    bookEl.classList.add('visible');
    render();
  } catch (err) {
    loadingEl.classList.remove('visible');
    dropZone.classList.remove('hidden');
    console.error('Failed to parse EPUB:', err);
    alert(`Failed to parse EPUB: ${err instanceof Error ? err.message : err}`);
  }
}

// ── Image exclusion reflow (real-time during drag) ──

const spreadEngine = new SpreadExclusionEngine({
  pageWidth: 0,
  pagePaddingX: PAGE_PAD_X,
  pagePaddingY: PAGE_PAD_Y,
  lineWidth: 0,
  linePitch: 0,
});

function reflowWithExclusion(): void {
  if (!currentBook || cachedParagraphs.length === 0) return;

  const fontSize = Number(fontSizeInput.value);
  const lineHeight = Number(lineSpacingInput.value);
  const linePitch = fontSize * lineHeight;
  const cw = contentWidth();

  // Normal spread: estimated lines per page (no gaps)
  const normalLinesPerPage = Math.floor(cw / linePitch);
  const normalLinesPerSpread = normalLinesPerPage * 2;

  // Pre-compute line offsets from pre-reflow entries (for image coordinate adjustment)
  const opts = measureOptions();
  const preReflowMetrics = buildLineMetrics(renderEntries, opts);

  // Pre-compute exclusion for each spread that has images
  const exclusionBySpread = new Map<number, ReturnType<SpreadExclusionEngine['compute']>>();
  const inlineMargin = fontSize;
  for (const [spreadIdx, imgs] of spreadImageMap) {
    if (imgs.length === 0) continue;
    spreadEngine.setGeometry({
      pageWidth: pageRight.clientWidth,
      pagePaddingX: PAGE_PAD_X,
      pagePaddingY: PAGE_PAD_Y,
      lineWidth: cachedLineWidth,
      linePitch,
    });
    spreadEngine.clearImages();
    for (const img of imgs) {
      // Only adjust x for RIGHT page images (img center within page bounds).
      // Left page images don't need heading offset adjustment since
      // the title/heading is on the right page.
      const imgCenter = img.x + img.w / 2;
      const isOnRightPage = imgCenter > 0 && imgCenter < pageRight.clientWidth;
      let xAdj = 0;
      if (isOnRightPage) {
        const fromContentRight = pageRight.clientWidth - PAGE_PAD_X - imgCenter;
        const centerCol = Math.max(0, Math.floor(fromContentRight / linePitch));
        const spreadStartLine = spreadIdx * normalLinesPerSpread;
        xAdj = getImageXOffset(preReflowMetrics.offsets, spreadStartLine, centerCol);
      }
      spreadEngine.addImage({
        x: img.x + xAdj,
        y: img.y,
        w: img.w,
        h: img.h,
        inlineMargin,
      });
    }
    exclusionBySpread.set(spreadIdx, spreadEngine.compute());
  }

  // Build lineWidths for computeBreaks (approximate, using fixed slot counts)
  const totalChars = cachedParagraphs.reduce((s, p) => s + p.text.length, 0);
  const maxSpreads = Math.ceil(totalChars / Math.max(normalLinesPerSpread, 1)) + 10;
  const widthsList: number[] = [];
  for (let s = 0; s < maxSpreads; s++) {
    const excl = exclusionBySpread.get(s);
    if (excl) {
      for (let i = 0; i < excl.lineWidths.length; i++) {
        widthsList.push(excl.lineWidths[i]);
      }
    } else {
      for (let i = 0; i < normalLinesPerSpread; i++) {
        widthsList.push(cachedLineWidth);
      }
    }
  }
  const tiledWidths = new Float32Array(widthsList);

  // Layout all paragraphs with per-spread lineWidths
  let globalLineIndex = 0;
  const entries: RenderEntry[] = [];
  for (const para of cachedParagraphs) {
    const remaining = tiledWidths.length - globalLineIndex;
    const paraLineWidths =
      remaining > 0 ? tiledWidths.slice(globalLineIndex, globalLineIndex + remaining) : undefined;

    const breakResult = computeBreaks({
      text: para.text,
      advances: para.advances,
      lineWidth: cachedLineWidth,
      lineWidths: paraLineWidths,
      mode: cachedMode,
      enableHanging: cachedHanging,
    });

    globalLineIndex += breakResult.breakPoints.length + 1;
    entries.push({
      chars: para.chars,
      breakPoints: breakResult.breakPoints,
      rubyAnnotations: para.rubyAnnotations,
      headingLevel: para.headingLevel,
    });
  }

  // Flatten all lines and compute post-reflow metrics
  const allSlices: PageSlice[] = entries.map((entry, i) => ({
    paragraphIndex: i,
    lineStart: 0,
    lineEnd: entry.breakPoints.length + 1,
  }));
  const fullPage = buildRenderPage(allSlices, entries);
  const postMetrics = buildLineMetrics(entries, opts);
  const { metrics: lm } = postMetrics;

  const allLines: { segments: RenderSegment[]; headingLevel?: number }[] = [];
  for (const para of fullPage.paragraphs) {
    for (const line of para.lines) {
      allLines.push({ segments: line.segments, headingLevel: para.headingLevel });
    }
  }

  // ── Gap-aware spread assignment using core helpers ──
  exclusionSpreadLayouts = [];
  let lineIdx = 0;
  while (lineIdx < allLines.length) {
    const spreadIdx = exclusionSpreadLayouts.length;
    const excl = exclusionBySpread.get(spreadIdx);

    if (excl) {
      const rightHasImage = excl.rightSlots.some((s) => s.height < cachedLineWidth - 0.5);
      const leftHasImage = excl.leftSlots.some((s) => s.height < cachedLineWidth - 0.5);

      let rightSlots: ColumnSlot[];
      let rightCount: number;
      if (rightHasImage) {
        rightSlots = adjustExclusionSlots(excl.rightSlots, lm, lineIdx, linePitch);
        rightCount = rightSlots.length;
      } else {
        rightCount = packPageLines(lm, lineIdx, cw);
        rightSlots = buildColumnSlots(lm, lineIdx, rightCount, cachedLineWidth);
      }

      let leftSlots: ColumnSlot[];
      let leftCount: number;
      if (leftHasImage) {
        leftSlots = adjustExclusionSlots(excl.leftSlots, lm, lineIdx + rightCount, linePitch);
        leftCount = leftSlots.length;
      } else {
        leftCount = packPageLines(lm, lineIdx + rightCount, cw);
        leftSlots = buildColumnSlots(lm, lineIdx + rightCount, leftCount, cachedLineWidth);
      }

      exclusionSpreadLayouts.push({
        lineStart: lineIdx,
        slotCount: rightCount + leftCount,
        rightSlotCount: rightCount,
        rightSlots,
        leftSlots,
        hasImages: true,
      });
      lineIdx += rightCount + leftCount;
    } else {
      const rightStart = lineIdx;
      const rightCount = packPageLines(lm, lineIdx, cw);
      lineIdx += rightCount;
      const leftCount = packPageLines(lm, lineIdx, cw);
      lineIdx += leftCount;

      exclusionSpreadLayouts.push({
        lineStart: rightStart,
        slotCount: rightCount + leftCount,
        rightSlotCount: rightCount,
        rightSlots: buildColumnSlots(lm, rightStart, rightCount, cachedLineWidth),
        leftSlots: buildColumnSlots(lm, rightStart + rightCount, leftCount, cachedLineWidth),
        hasImages: false,
      });
    }
  }

  exclusionLines = allLines;
  totalPages = Math.max(1, exclusionSpreadLayouts.length * 2);
  if (currentPage >= totalPages) currentPage = totalPages - 2;
  if (currentPage < 0) currentPage = 0;

  renderExclusionSpread();
}

/** Render the current spread from cached exclusion layout data. */
function renderExclusionSpread(): void {
  const spreadIdx = Math.floor(currentPage / 2);
  const sl = exclusionSpreadLayouts[spreadIdx];
  if (!sl) return;

  pageRight.style.overflow = sl.hasImages ? 'visible' : '';

  renderExclusionColumns(
    pageContentRight,
    exclusionLines,
    sl.lineStart,
    sl.lineStart + sl.rightSlotCount,
    sl.rightSlots,
  );
  renderExclusionColumns(
    pageContentLeft,
    exclusionLines,
    sl.lineStart + sl.rightSlotCount,
    sl.lineStart + sl.slotCount,
    sl.leftSlots,
  );
  updatePageInfo();
}

/**
 * Renders a range of lines as absolute-positioned columns.
 * Lines are taken from allLines[lineStart..lineEnd) and positioned using the given slots.
 */
function renderExclusionColumns(
  contentEl: HTMLElement,
  allLines: { segments: RenderSegment[]; headingLevel?: number }[],
  lineStart: number,
  lineEnd: number,
  slots: ColumnSlot[],
): void {
  contentEl.innerHTML = '';
  contentEl.style.writingMode = 'horizontal-tb';
  contentEl.style.position = 'relative';

  const fontSize = Number(fontSizeInput.value);
  const lineHeight = Number(lineSpacingInput.value);
  const count = Math.min(lineEnd - lineStart, slots.length);

  for (let i = 0; i < count; i++) {
    const lineIdx = lineStart + i;
    if (lineIdx >= allLines.length) break;

    const slot = slots[i];
    const line = allLines[lineIdx];
    if (slot.height <= 0) continue;

    const col = document.createElement('div');
    col.className = 'exclusion-column';
    col.style.right = `${slot.xPos}px`;
    col.style.top = `${slot.yStart}px`;
    col.style.height = `${slot.height}px`;
    const scale = headingScaleFor(line.headingLevel);
    col.style.fontSize = `${Math.round(fontSize * scale)}px`;
    col.style.fontFamily = fontFamilySelect.value;
    col.style.lineHeight = `${lineHeight}`;
    if (line.headingLevel != null) col.style.fontWeight = '700';

    for (const segment of line.segments) {
      renderSegmentToDOM(col, segment);
    }
    contentEl.appendChild(col);
  }
}

// ── Full layout + pagination ──
async function render(): Promise<void> {
  if (!currentBook) return;

  const chapter = currentBook.chapters[currentChapter];
  if (!chapter) return;

  applyPageSize();

  const fontFamily = fontFamilySelect.value;
  const fontSize = Number(fontSizeInput.value);
  const { lineWidth: rawLineWidth } = computePageDimensions();
  const lineWidth = verticalLineWidth(rawLineWidth, fontSize);
  const mode = modeSelect.value as 'strict' | 'loose';
  const enableHanging = hangingSelect.value === 'true';

  pageContentRight.innerHTML = '';
  pageContentLeft.innerHTML = '';
  applyFont(pageContentRight);
  applyFont(pageContentLeft);

  const t0 = performance.now();

  const chapterResult = await mejiro.layoutChapter({
    paragraphs: chapter.paragraphs.map((para) => ({
      text: para.text,
      rubyAnnotations: para.rubyAnnotations.length > 0 ? para.rubyAnnotations : undefined,
      fontSize: para.headingLevel
        ? Math.round(fontSize * headingScaleFor(para.headingLevel))
        : undefined,
    })),
    fontFamily,
    fontSize,
    lineWidth,
    mode,
    enableHanging,
  });

  renderEntries = chapter.paragraphs.map((para, i) => ({
    chars: chapterResult.paragraphs[i].chars,
    breakPoints: chapterResult.paragraphs[i].breakResult.breakPoints,
    rubyAnnotations: para.rubyAnnotations,
    headingLevel: para.headingLevel,
  }));

  // Cache paragraph data for real-time reflow
  const baseFontSpec = toFontSpec(fontFamily, fontSize);
  cachedParagraphs = chapter.paragraphs.map((para, i) => {
    const paraFontSize = para.headingLevel
      ? Math.round(fontSize * headingScaleFor(para.headingLevel))
      : fontSize;
    const fontSpec =
      paraFontSize === fontSize ? baseFontSpec : toFontSpec(fontFamily, paraFontSize);
    const codepoints = toCodepoints(para.text);
    const advances = charMeasurer.measureAll(fontSpec, codepoints);
    return {
      text: codepoints,
      advances,
      chars: chapterResult.paragraphs[i].chars,
      rubyAnnotations: para.rubyAnnotations,
      headingLevel: para.headingLevel,
    };
  });
  cachedLineWidth = lineWidth;
  cachedMode = mode;
  cachedHanging = enableHanging;

  const totalChars = chapter.paragraphs.reduce((s, p) => s + p.text.length, 0);
  const totalRuby = chapter.paragraphs.reduce((s, p) => s + p.rubyAnnotations.length, 0);

  const elapsed = performance.now() - t0;

  // Compute pages from layout results
  computePages();
  currentPage = 0;
  if (spreadImageMap.size > 0) {
    reflowWithExclusion();
  } else {
    renderCurrentSpread();
  }
  updatePageInfo();

  const fontName = fontFamilySelect.options[fontFamilySelect.selectedIndex].text;
  stats.textContent = [
    `${totalChars}ch`,
    `${totalPages}pp`,
    totalRuby > 0 ? `${totalRuby}ruby` : null,
    `${fontName} ${fontSizeInput.value}px`,
    `${elapsed.toFixed(0)}ms`,
  ]
    .filter(Boolean)
    .join(' / ');
}

function debouncedRender(): void {
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = setTimeout(render, 200);
}

// ── Window resize ──
window.addEventListener('resize', () => {
  if (!currentBook) return;
  debouncedRender();
});

// ── Load default EPUB if available ──
fetch('/neko.epub')
  .then((res) => {
    if (!res.ok) return;
    return res.arrayBuffer();
  })
  .then((buf) => {
    if (buf) loadEpubBuffer(buf);
  })
  .catch(() => {
    // Default EPUB not available — show drop zone
  });
