import type { PageSlice } from '@libraz/mejiro';
import { paginate } from '@libraz/mejiro';
import { MejiroBrowser, verticalLineWidth } from '@libraz/mejiro/browser';
import type { EpubBook } from '@libraz/mejiro/epub';
import { parseEpub } from '@libraz/mejiro/epub';
import type { RenderEntry, RenderPage, RenderSegment } from '@libraz/mejiro/render';
import { buildParagraphMeasures, buildRenderPage } from '@libraz/mejiro/render';

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

// ── State ──
const mejiro = new MejiroBrowser();
let currentBook: EpubBook | null = null;
let currentChapter = 0;
// currentPage = index of the right page in the spread (always even: 0, 2, 4, ...)
let currentPage = 0;
let totalPages = 0;
let updateTimer: ReturnType<typeof setTimeout> | null = null;

// ── Layout results & page map ──
let renderEntries: RenderEntry[] = [];
let pages: PageSlice[][] = [];

// ── Settings toggle ──
settingsToggle.addEventListener('click', () => {
  settingsPanel.classList.toggle('open');
  settingsToggle.classList.toggle('active');
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
    currentPage = next;
    renderCurrentSpread();
    updatePageInfo();
    spread.classList.remove('turning');
  }, 180);
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

// ── CSS constants matching index.html ──
const HEADING_SCALE = 1.4;

// ── Pagination ──
function computePages(): void {
  const measures = buildParagraphMeasures(renderEntries, {
    fontSize: Number(fontSizeInput.value),
    lineHeight: Number(lineSpacingInput.value),
    headingScale: HEADING_SCALE,
  });

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
    paraDiv.className = paragraph.isHeading
      ? 'mejiro-paragraph mejiro-paragraph--heading'
      : 'mejiro-paragraph';
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

  const headingFontSize = Math.round(fontSize * HEADING_SCALE);

  pageContentRight.innerHTML = '';
  pageContentLeft.innerHTML = '';
  applyFont(pageContentRight);
  applyFont(pageContentLeft);

  const t0 = performance.now();

  const chapterResult = await mejiro.layoutChapter({
    paragraphs: chapter.paragraphs.map((para) => ({
      text: para.text,
      rubyAnnotations: para.rubyAnnotations.length > 0 ? para.rubyAnnotations : undefined,
      fontSize: para.headingLevel ? headingFontSize : undefined,
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
    isHeading: !!para.headingLevel,
  }));

  const totalChars = chapter.paragraphs.reduce((s, p) => s + p.text.length, 0);
  const totalRuby = chapter.paragraphs.reduce((s, p) => s + p.rubyAnnotations.length, 0);

  const elapsed = performance.now() - t0;

  // Compute pages from layout results
  computePages();
  currentPage = 0;
  renderCurrentSpread();
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
