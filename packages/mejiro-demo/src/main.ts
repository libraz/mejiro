import type { ChapterLayout, PageResult } from '@libraz/mejiro/book';
import { DEFAULT_HEADING_STYLES, MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { parseEpub } from '@libraz/mejiro/epub';
import type { RenderPage, RenderSegment } from '@libraz/mejiro/render';

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
const book = new MejiroBook({
  fontFamily: fontFamilySelect.value,
  fontSize: Number(fontSizeInput.value),
  lineSpacing: Number(lineSpacingInput.value),
  mode: modeSelect.value as 'strict' | 'loose',
  enableHanging: hangingSelect.value === 'true',
  headingStyles: DEFAULT_HEADING_STYLES,
});

let currentBook: EpubBook | null = null;
let currentChapter = 0;
let currentPage = 0;
let totalPages = 0;
let layout: ChapterLayout | null = null;
let updateTimer: ReturnType<typeof setTimeout> | null = null;

// ── Image overlay state ──
interface ImagePlacement {
  x: number;
  y: number;
  w: number;
  h: number;
  el: HTMLDivElement;
}
const spreadImageMap = new Map<number, ImagePlacement[]>();

function currentSpreadImages(): ImagePlacement[] {
  const key = Math.floor(currentPage / 2);
  let list = spreadImageMap.get(key);
  if (!list) {
    list = [];
    spreadImageMap.set(key, list);
  }
  return list;
}

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
  if (list.length === 0) {
    spreadImageMap.delete(Math.floor(currentPage / 2));
  }
  if (spreadImageMap.size === 0) {
    imageToggle.classList.remove('active');
    pageRight.style.overflow = '';
  }
  syncImagesToLayout();
  renderCurrentSpread();
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

function syncImagesToLayout(): void {
  if (!layout) return;
  layout.clearImages();
  const fontSize = Number(fontSizeInput.value);
  for (const [si, placements] of spreadImageMap) {
    if (placements.length > 0) {
      layout.setImages(
        si,
        placements.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h, margin: fontSize })),
      );
    }
  }
}

let reflowRafId = 0;
function scheduleReflow(): void {
  cancelAnimationFrame(reflowRafId);
  reflowRafId = requestAnimationFrame(() => {
    syncImagesToLayout();
    renderCurrentSpread();
  });
}

// ── Image toggle button ──
imageToggle.addEventListener('click', () => {
  if (!currentBook) return;
  imageToggle.classList.add('active');
  pageRight.style.overflow = 'visible';
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
  if (e.key === 'ArrowLeft') navigateSpread(1);
  else if (e.key === 'ArrowRight') navigateSpread(-1);
});

function navigateSpread(delta: number): void {
  const next = currentPage + delta * 2;
  if (next < 0 || next >= totalPages) return;

  spread.classList.add('turning');
  setTimeout(() => {
    hideSpreadOverlays();
    currentPage = next;
    showSpreadOverlays();
    renderCurrentSpread();
    spread.classList.remove('turning');
  }, 180);
}

function hideSpreadOverlays(): void {
  for (const img of currentSpreadImages()) {
    img.el.classList.remove('visible');
  }
}

function showSpreadOverlays(): void {
  const list = currentSpreadImages();
  for (const img of list) {
    img.el.classList.add('visible');
    if (!img.el.parentElement) pageRight.appendChild(img.el);
  }
  pageRight.style.overflow = list.length > 0 ? 'visible' : '';
}

// ── Page sizing ──

function applyPageSize(): void {
  const surface = document.querySelector('.reading-surface') as HTMLElement;
  const { pageWidth, pageHeight, contentHeight } = book.computePageSize(surface);
  for (const page of [pageRight, pageLeft]) {
    page.style.width = `${pageWidth}px`;
    page.style.height = `${pageHeight}px`;
  }
  pageContentRight.style.height = `${contentHeight}px`;
  pageContentLeft.style.height = `${contentHeight}px`;
}

// ── Font ──
function applyFont(el: HTMLElement): void {
  el.style.fontSize = `${fontSizeInput.value}px`;
  el.style.fontFamily = fontFamilySelect.value;
  el.style.lineHeight = lineSpacingInput.value;
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

function renderNormalPage(contentEl: HTMLElement, result: PageResult): void {
  contentEl.innerHTML = '';
  contentEl.style.writingMode = '';
  contentEl.style.position = '';
  applyFont(contentEl);
  renderPageToDOM(contentEl, result.page);
}

function renderSlotPage(contentEl: HTMLElement, result: PageResult): void {
  contentEl.innerHTML = '';
  contentEl.style.writingMode = 'horizontal-tb';
  contentEl.style.position = 'relative';

  const count = Math.min(result.lines.length, result.slots.length);
  for (let i = 0; i < count; i++) {
    const line = result.lines[i];
    const slot = result.slots[i];
    if (slot.height <= 0) continue;

    const col = document.createElement('div');
    col.className = 'exclusion-column';
    col.style.right = `${slot.xPos}px`;
    col.style.top = `${slot.yStart}px`;
    col.style.height = `${slot.height}px`;
    col.style.fontSize = `${line.fontSize}px`;
    col.style.fontFamily = fontFamilySelect.value;
    col.style.lineHeight = lineSpacingInput.value;
    if (line.headingLevel != null) col.style.fontWeight = '700';

    for (const seg of line.segments) renderSegmentToDOM(col, seg);
    contentEl.appendChild(col);
  }
}

function renderCurrentSpread(): void {
  if (!layout) return;

  const spreadIdx = Math.floor(currentPage / 2);
  const result = layout.getSpread(spreadIdx);
  totalPages = result.totalPages;

  const hasImg = layout.hasImages;
  pageRight.style.overflow = hasImg ? 'visible' : '';

  if (hasImg) {
    renderSlotPage(pageContentRight, result.right);
    renderSlotPage(pageContentLeft, result.left);
  } else {
    renderNormalPage(pageContentRight, result.right);
    renderNormalPage(pageContentLeft, result.left);
  }
  updatePageInfo();
}

function updatePageInfo(): void {
  if (!currentBook) return;
  const chapter = currentBook.chapters[currentChapter];
  const chTitle = chapter?.title ?? `${currentChapter + 1}`;

  const headerText = currentBook.author
    ? `${currentBook.author}  ${currentBook.title}`
    : currentBook.title;

  runningTitleRight.textContent = headerText;
  runningPageRight.textContent = `${currentPage + 1}`;

  if (currentPage + 1 < totalPages) {
    runningTitleLeft.textContent = chTitle;
    runningPageLeft.textContent = `${currentPage + 2}`;
  } else {
    runningTitleLeft.textContent = '';
    runningPageLeft.textContent = '';
  }

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

// ── Full layout + pagination ──
async function render(): Promise<void> {
  if (!currentBook) return;

  const chapter = currentBook.chapters[currentChapter];
  if (!chapter) return;

  const fontSize = Number(fontSizeInput.value);

  book.setOptions({
    fontFamily: fontFamilySelect.value,
    fontSize,
    lineSpacing: Number(lineSpacingInput.value),
    mode: modeSelect.value as 'strict' | 'loose',
    enableHanging: hangingSelect.value === 'true',
  });

  // computePageSize calculates dimensions, sets page size internally, and returns metrics
  applyPageSize();

  pageContentRight.innerHTML = '';
  pageContentLeft.innerHTML = '';
  applyFont(pageContentRight);
  applyFont(pageContentLeft);

  const t0 = performance.now();
  layout = await book.layoutChapter(chapter);

  if (spreadImageMap.size > 0) {
    syncImagesToLayout();
  }

  const elapsed = performance.now() - t0;
  totalPages = layout.totalPages;
  currentPage = 0;

  renderCurrentSpread();

  const totalChars = chapter.paragraphs.reduce((s, p) => s + p.text.length, 0);
  const totalRuby = chapter.paragraphs.reduce((s, p) => s + p.rubyAnnotations.length, 0);
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
