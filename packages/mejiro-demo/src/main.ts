import '@libraz/mejiro/render/mejiro-reader.css';
import type { TextAnalyzer } from '@libraz/mejiro/analysis';
import { createSuzumeAnalyzer } from '@libraz/mejiro/analysis';
import type { ChapterLayout, ChapterLayoutSnapshot, PageResult } from '@libraz/mejiro/book';
import { DEFAULT_HEADING_STYLES, MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { parseEpub } from '@libraz/mejiro/epub';
import type { RenderPage, RenderSegment } from '@libraz/mejiro/render';
import suzumeWasmUrl from '@libraz/suzume/wasm?url';

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
const readerHeader = document.getElementById('readerHeader') as HTMLElement;
const openFileBtn = document.getElementById('openFile') as HTMLButtonElement;
const settingsToggle = document.getElementById('settingsToggle') as HTMLButtonElement;
const settingsPanel = document.getElementById('settingsPanel') as HTMLDivElement;
const readerBody = document.getElementById('readerBody') as HTMLDivElement;
const chapterNav = document.getElementById('chapterNav') as HTMLDivElement;
const chapterSelect = document.getElementById('chapterSelect') as HTMLSelectElement;
const chapterPanel = document.getElementById('chapterPanel') as HTMLElement;
const readerOptionInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('[data-reader-option]'),
);
const chapterNavModeControls = document.getElementById('chapterNavModeControls') as HTMLDivElement;
const readerOptionsCode = document.getElementById('readerOptionsCode') as HTMLPreElement;
const fontFamilySelect = document.getElementById('fontFamily') as HTMLSelectElement;
const fontSizeInput = document.getElementById('fontSize') as HTMLInputElement;
const modeSelect = document.getElementById('mode') as HTMLSelectElement;
const hangingSelect = document.getElementById('hanging') as HTMLSelectElement;
const lineSpacingInput = document.getElementById('lineSpacing') as HTMLInputElement;
const pageNumbersSelect = document.getElementById('pageNumbers') as HTMLSelectElement;
const imageToggle = document.getElementById('imageToggle') as HTMLButtonElement;
const wordAwareControls = document.getElementById('wordAwareControls') as HTMLDivElement;
const wordAwareNote = document.getElementById('wordAwareNote') as HTMLSpanElement;

// ── Analysis stage state ──

/** Stage of analysis-driven line breaking, mirroring `BookOptions.wordAwareBreaking`. */
type WordAwareBreaking = 'off' | 'clusters' | 'full';

/** One-line explanation of each stage, shown under the stage control. */
const WORD_AWARE_NOTES: Record<WordAwareBreaking, string> = {
  off: 'Character-class rules only — no analysis is run.',
  clusters: 'Hard clusters only: removes wrong breaks, moves none.',
  full: 'Clusters plus break penalties, which do move break positions.',
};

let wordAwareBreaking: WordAwareBreaking = 'off';
let analyzer: TextAnalyzer | null = null;
let analyzerPromise: Promise<TextAnalyzer> | null = null;
let wordAwareBusy = false;

/**
 * Builds a book from the current typography controls and the current analysis
 * stage.
 *
 * The stage cannot be patched onto a live book: `wordAwareBreaking` and
 * `analyzer` are read when a chapter is laid out and `MejiroBook.setOptions()`
 * deliberately refuses them, so changing the stage means a new book.
 */
function createBook(): MejiroBook {
  return new MejiroBook({
    fontFamily: fontFamilySelect.value,
    fontSize: Number(fontSizeInput.value),
    lineSpacing: Number(lineSpacingInput.value),
    mode: modeSelect.value as 'strict' | 'loose',
    enableHanging: hangingSelect.value === 'true',
    headingStyles: DEFAULT_HEADING_STYLES,
    wordAwareBreaking,
    ...(analyzer ? { analyzer } : {}),
  });
}

// ── State ──
let book = createBook();

let currentBook: EpubBook | null = null;
let currentChapter = 0;
let currentPage = 0;
let totalPages = 0;
let layout: ChapterLayout | null = null;
// Chapter `layout` belongs to, so a re-layout of the same chapter can restore
// the reading position while a chapter switch starts at the beginning.
let layoutChapterIndex = -1;
let updateTimer: ReturnType<typeof setTimeout> | null = null;
let chapterNavMode: 'select' | 'panel' | 'both' | 'none' = 'panel';
const readerOptions: Record<string, boolean> = Object.fromEntries(
  readerOptionInputs.map((input) => [input.dataset.readerOption ?? '', input.checked]),
);
const headerDependentOptions = new Set(['enableSettings', 'enableImageOverlay', 'enableStats']);

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
  settingsPanel.classList.toggle('is-open');
  settingsToggle.classList.toggle('is-active');
});

function textPreview(text: string, max = 72): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}...`;
}

function renderChapterPanel(): void {
  if (!currentBook) {
    chapterPanel.replaceChildren();
    return;
  }

  const head = document.createElement('div');
  head.className = 'mejiro-reader-chapter-panel-head';
  const kicker = document.createElement('span');
  kicker.className = 'mejiro-reader-chapter-panel-kicker';
  kicker.textContent = 'Contents';
  const title = document.createElement('strong');
  title.textContent = currentBook.title;
  head.append(kicker, title);
  if (currentBook.author) {
    const author = document.createElement('span');
    author.textContent = currentBook.author;
    head.appendChild(author);
  }

  const list = document.createElement('ol');
  list.className = 'mejiro-reader-chapter-list';

  currentBook.chapters.forEach((ch, i) => {
    const chTitle = ch.title ?? `Chapter ${i + 1}`;
    const preview = ch.paragraphs.find((p) => !p.headingLevel && p.text.trim())?.text;
    const headings = ch.paragraphs
      .filter((p) => p.headingLevel && p.text.trim() && p.text.trim() !== chTitle)
      .slice(0, 3);

    const item = document.createElement('li');
    item.className = 'mejiro-reader-chapter-list-item';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `mejiro-reader-chapter-card${i === currentChapter ? ' is-active' : ''}`;
    if (i === currentChapter) button.setAttribute('aria-current', 'true');
    button.addEventListener('click', () => {
      currentChapter = i;
      currentPage = 0;
      chapterSelect.value = String(i);
      renderChapterPanel();
      updateReaderOptionsDemo();
      render();
    });

    const number = document.createElement('span');
    number.className = 'mejiro-reader-chapter-number';
    number.textContent = String(i + 1).padStart(2, '0');

    const main = document.createElement('span');
    main.className = 'mejiro-reader-chapter-main';
    const titleEl = document.createElement('span');
    titleEl.className = 'mejiro-reader-chapter-title';
    titleEl.textContent = chTitle;
    main.appendChild(titleEl);

    if (preview) {
      const previewEl = document.createElement('span');
      previewEl.className = 'mejiro-reader-chapter-preview';
      previewEl.textContent = textPreview(preview);
      main.appendChild(previewEl);
    }

    if (headings.length > 0) {
      const subheads = document.createElement('span');
      subheads.className = 'mejiro-reader-chapter-subheads';
      for (const heading of headings) {
        const subhead = document.createElement('span');
        subhead.textContent = textPreview(heading.text, 30);
        subheads.appendChild(subhead);
      }
      main.appendChild(subheads);
    }

    button.append(number, main);
    item.appendChild(button);
    list.appendChild(item);
  });

  chapterPanel.replaceChildren(head, list);
}

function optionEnabled(key: string): boolean {
  return readerOptions[key] ?? true;
}

function optionDisabled(key: string): boolean {
  return headerDependentOptions.has(key) && !optionEnabled('enableHeader');
}

function effectiveOption(key: string): boolean {
  return optionDisabled(key) ? false : optionEnabled(key);
}

function effectiveChapterNavMode(): typeof chapterNavMode {
  if (!optionEnabled('enableChapterNav')) return 'none';
  if (!optionEnabled('enableHeader') && chapterNavMode === 'select') return 'none';
  if (!optionEnabled('enableHeader') && chapterNavMode === 'both') return 'panel';
  return chapterNavMode;
}

function modeDisabled(mode: typeof chapterNavMode): boolean {
  return (
    !optionEnabled('enableChapterNav') ||
    (!optionEnabled('enableHeader') && (mode === 'select' || mode === 'both'))
  );
}

function updateReaderOptionsDemo(): void {
  const chapterEnabled = optionEnabled('enableChapterNav');
  const activeChapterNavMode = effectiveChapterNavMode();
  const showSelect = Boolean(
    currentBook &&
      chapterEnabled &&
      (activeChapterNavMode === 'select' || activeChapterNavMode === 'both'),
  );
  const showPanel = Boolean(
    currentBook &&
      chapterEnabled &&
      (activeChapterNavMode === 'panel' || activeChapterNavMode === 'both'),
  );

  readerHeader.hidden = !effectiveOption('enableHeader');
  openFileBtn.hidden = !effectiveOption('enableDropZone');
  dropZone.hidden = Boolean(
    currentBook || loadingEl.hidden === false || !effectiveOption('enableDropZone'),
  );
  chapterNav.hidden = !showSelect;
  chapterPanel.hidden = !showPanel;
  readerBody.classList.toggle('has-chapter-panel', showPanel);
  settingsToggle.hidden = !effectiveOption('enableSettings');
  if (!effectiveOption('enableSettings')) {
    settingsPanel.classList.remove('is-open');
    settingsToggle.classList.remove('is-active');
  }
  imageToggle.hidden = !effectiveOption('enableImageOverlay');
  stats.hidden = !effectiveOption('enableStats');
  pageIndicator.hidden = !effectiveOption('enablePageIndicator');
  readerOptionsCode.textContent = `<MejiroReader
  enableHeader={${effectiveOption('enableHeader')}}
  enableDropZone={${effectiveOption('enableDropZone')}}
  enableChapterNav={${chapterEnabled}}
  chapterNavMode="${activeChapterNavMode}"
  enableSettings={${effectiveOption('enableSettings')}}
  enableImageOverlay={${effectiveOption('enableImageOverlay')}}
  enableStats={${effectiveOption('enableStats')}}
  enableKeyboard={${effectiveOption('enableKeyboard')}}
  enablePageIndicator={${effectiveOption('enablePageIndicator')}}
/>`;

  for (const input of readerOptionInputs) {
    const key = input.dataset.readerOption ?? '';
    input.disabled = optionDisabled(key);
    input.closest('label')?.classList.toggle('is-disabled', optionDisabled(key));
  }
  for (const button of chapterNavModeControls.querySelectorAll('button')) {
    const mode = button.getAttribute('data-mode') as typeof chapterNavMode;
    button.disabled = modeDisabled(mode);
    button.classList.toggle('is-active', mode === chapterNavMode);
  }
}

for (const input of readerOptionInputs) {
  input.addEventListener('change', () => {
    const key = input.dataset.readerOption;
    if (!key) return;
    readerOptions[key] = input.checked;
    updateReaderOptionsDemo();
  });
}
chapterNavModeControls.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]');
  if (!(button && !button.disabled)) return;
  chapterNavMode = button.dataset.mode as typeof chapterNavMode;
  updateReaderOptionsDemo();
});
updateReaderOptionsDemo();

// ── Analysis-driven line breaking ──

/** Break positions of an `off` layout, kept to measure a later stage against. */
interface BreakBaseline {
  /** Layout inputs the positions were produced from, per {@link layoutKey}. */
  key: string;
  /** Ascending break positions, one array per paragraph. */
  breaks: number[][];
}

let breakBaseline: BreakBaseline | null = null;

/**
 * Loads the suzume analyzer once and reuses it for every later stage change.
 *
 * Not loaded at start-up on purpose: the analyzer pulls in a ~567 KB
 * WebAssembly module, which a reader that stays at `off` should never pay for.
 * The wasm URL is resolved through the bundler so the binary is emitted as a
 * demo asset instead of being looked for next to the bundled chunk.
 */
function loadAnalyzer(): Promise<TextAnalyzer> {
  analyzerPromise ??= createSuzumeAnalyzer({ wasmPath: suzumeWasmUrl });
  return analyzerPromise;
}

/** Reflects the active stage and the busy state on the segmented control. */
function renderWordAwareControls(): void {
  for (const button of wordAwareControls.querySelectorAll('button')) {
    const stage = button.dataset.wordAware as WordAwareBreaking;
    button.classList.toggle('is-active', stage === wordAwareBreaking);
    button.disabled = wordAwareBusy;
  }
  wordAwareControls.setAttribute('aria-busy', String(wordAwareBusy));
}

/** Writes the note under the stage control, in its plain or error tone. */
function setWordAwareNote(text: string, isError = false): void {
  wordAwareNote.textContent = text;
  wordAwareNote.classList.toggle('is-error', isError);
}

/**
 * Switches the analysis stage and re-lays out the current chapter with it.
 *
 * A failing analyzer is not fatal: the stage stays at `off`, the reader keeps
 * working on the character-class rules, and the note says what happened.
 */
async function applyWordAwareBreaking(stage: WordAwareBreaking): Promise<void> {
  if (stage === wordAwareBreaking || wordAwareBusy) return;

  wordAwareBusy = true;
  renderWordAwareControls();
  try {
    // An analyzer already created stays alive across a return to `off`, so
    // coming back to a hinted stage costs nothing.
    if (stage !== 'off' && !analyzer) {
      setWordAwareNote('Loading analyzer…');
      analyzer = await loadAnalyzer();
    }
  } catch (err) {
    console.error('Failed to load the suzume analyzer:', err);
    // Drop the rejected promise so a later attempt retries instead of
    // replaying the same failure.
    analyzerPromise = null;
    wordAwareBusy = false;
    renderWordAwareControls();
    setWordAwareNote('Analyzer unavailable — line breaking stays at off.', true);
    return;
  }

  captureBreakBaseline();
  wordAwareBreaking = stage;
  book = createBook();
  renderWordAwareControls();
  setWordAwareNote('Laying out…');
  try {
    await render();
  } finally {
    wordAwareBusy = false;
    renderWordAwareControls();
    setWordAwareNote(WORD_AWARE_NOTES[wordAwareBreaking]);
  }
}

/**
 * Identifies every layout input except the analysis stage, so break positions
 * are only ever compared across layouts the analysis alone can explain.
 */
function layoutKey(snapshot: ChapterLayoutSnapshot, chapter: number): string {
  const { config, size } = snapshot;
  return [
    chapter,
    // The font family is not part of the snapshot config, but it changes the
    // advances the breaks were computed from.
    fontFamilySelect.value,
    config.fontSize,
    config.lineSpacing,
    config.mode,
    config.enableHanging,
    size.pageWidth,
    size.lineWidth,
  ].join('|');
}

/**
 * Records the break positions of the layout on screen while it is still an
 * `off` one — the only moment the demo holds a baseline to compare against.
 */
function captureBreakBaseline(): void {
  if (!layout || wordAwareBreaking !== 'off' || layoutChapterIndex !== currentChapter) return;
  const snapshot = layout.snapshot();
  breakBaseline = {
    key: layoutKey(snapshot, currentChapter),
    breaks: snapshot.paragraphs.map((p) => p.breakPoints),
  };
}

/**
 * Counts how many break positions of `current` the `off` baseline does not
 * contain.
 *
 * Returns `null` when no baseline describes the same chapter, typography and
 * page geometry, because a count taken across different inputs would credit
 * the analysis with differences a font or a resize caused.
 */
function countMovedBreaks(current: ChapterLayout): { moved: number; total: number } | null {
  if (wordAwareBreaking === 'off' || !breakBaseline) return null;
  const snapshot = current.snapshot();
  if (layoutKey(snapshot, currentChapter) !== breakBaseline.key) return null;
  if (snapshot.paragraphs.length !== breakBaseline.breaks.length) return null;

  let moved = 0;
  let total = 0;
  for (let i = 0; i < snapshot.paragraphs.length; i++) {
    const breaks = snapshot.paragraphs[i].breakPoints;
    total += breaks.length;
    moved += countMissing(breaks, breakBaseline.breaks[i]);
  }
  return { moved, total };
}

/** Counts entries of the ascending list `a` that the ascending list `b` lacks. */
function countMissing(a: readonly number[], b: readonly number[]): number {
  let missing = 0;
  let j = 0;
  for (const value of a) {
    while (j < b.length && b[j] < value) j++;
    if (j < b.length && b[j] === value) j++;
    else missing++;
  }
  return missing;
}

wordAwareControls.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    'button[data-word-aware]',
  );
  if (!(button && !button.disabled)) return;
  void applyWordAwareBreaking(button.dataset.wordAware as WordAwareBreaking);
});
renderWordAwareControls();
setWordAwareNote(WORD_AWARE_NOTES[wordAwareBreaking]);

// ── Image overlay management ──
function createImageOverlay(x: number, y: number): ImagePlacement {
  const el = document.createElement('div');
  el.className = 'mejiro-reader-image-overlay';
  el.innerHTML = `
    <div class="mejiro-reader-image-overlay-label"><div class="mejiro-reader-image-overlay-icon"></div><span>Image</span></div>
    <div class="mejiro-reader-image-overlay-resize"></div>
    <div class="mejiro-reader-image-overlay-close" role="button" tabindex="0" aria-label="Remove image" title="Remove image"></div>
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
    imageToggle.classList.remove('is-active');
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
  const resizeEl = placement.el.querySelector(
    '.mejiro-reader-image-overlay-resize',
  ) as HTMLDivElement;
  const closeEl = placement.el.querySelector(
    '.mejiro-reader-image-overlay-close',
  ) as HTMLDivElement;
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

  closeEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
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
    placement.el.classList.add('is-dragging');
    resizeEl.setPointerCapture(e.pointerId);
  });

  placement.el.addEventListener('pointerdown', (e) => {
    if (resizing) return;
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startVal = { x: placement.x, y: placement.y, w: placement.w, h: placement.h };
    placement.el.classList.add('is-dragging');
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
    placement.el.classList.remove('is-dragging');
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
  imageToggle.classList.add('is-active');
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
  dropZone.classList.add('is-dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('is-dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('is-dragover');
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
// Page-number visibility is pure chrome — no relayout needed.
pageNumbersSelect.addEventListener('change', updatePageInfo);

chapterSelect.addEventListener('change', () => {
  currentChapter = Number(chapterSelect.value);
  currentPage = 0;
  renderChapterPanel();
  updateReaderOptionsDemo();
  render();
});

// ── Page navigation (2 pages per spread) ──
navPrev.addEventListener('click', () => navigateSpread(-1));
navNext.addEventListener('click', () => navigateSpread(1));

document.addEventListener('keydown', (e) => {
  if (!(currentBook && effectiveOption('enableKeyboard'))) return;
  if (e.key === 'ArrowLeft') navigateSpread(1);
  else if (e.key === 'ArrowRight') navigateSpread(-1);
});

function navigateSpread(delta: number): void {
  const next = currentPage + delta * 2;
  if (next < 0 || next >= totalPages) return;

  spread.classList.add('is-turning');
  setTimeout(() => {
    hideSpreadOverlays();
    currentPage = next;
    showSpreadOverlays();
    renderCurrentSpread();
    spread.classList.remove('is-turning');
  }, 180);
}

function hideSpreadOverlays(): void {
  for (const img of currentSpreadImages()) {
    img.el.hidden = true;
  }
}

function showSpreadOverlays(): void {
  const list = currentSpreadImages();
  for (const img of list) {
    img.el.hidden = false;
    if (!img.el.parentElement) pageRight.appendChild(img.el);
  }
  pageRight.style.overflow = list.length > 0 ? 'visible' : '';
}

// ── Page sizing ──

function applyPageSize(): void {
  const surface = document.querySelector('.mejiro-reader-surface') as HTMLElement;
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
  switch (segment.type) {
    case 'text':
    case 'tcy':
      parent.appendChild(document.createTextNode(segment.text));
      return;
    case 'ruby': {
      const ruby = document.createElement('ruby');
      ruby.appendChild(document.createTextNode(segment.base));
      const rt = document.createElement('rt');
      rt.textContent = segment.rubyText;
      ruby.appendChild(rt);
      parent.appendChild(ruby);
      return;
    }
    case 'emphasis': {
      const span = document.createElement('span');
      span.className = `mejiro-emphasis mejiro-emphasis--${segment.style}`;
      span.textContent = segment.text;
      parent.appendChild(span);
      return;
    }
    case 'em': {
      const em = document.createElement('em');
      em.textContent = segment.text;
      parent.appendChild(em);
      return;
    }
    case 'strong': {
      const strong = document.createElement('strong');
      strong.textContent = segment.text;
      parent.appendChild(strong);
      return;
    }
    case 'link': {
      const link = document.createElement('a');
      link.href = segment.href;
      if (segment.title) link.title = segment.title;
      link.textContent = segment.text;
      parent.appendChild(link);
      return;
    }
    case 'footnote-ref': {
      const ref = document.createElement('a');
      ref.className = 'mejiro-footnote-ref';
      ref.href = `#${segment.noteId}`;
      ref.textContent = segment.text;
      parent.appendChild(ref);
    }
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
    col.className = 'mejiro-reader-exclusion-column';
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

  const pageNumbers = pageNumbersSelect.value as 'both' | 'right' | 'left' | 'none';
  const showRightNum = pageNumbers === 'both' || pageNumbers === 'right';
  const showLeftNum = pageNumbers === 'both' || pageNumbers === 'left';

  runningTitleRight.textContent = headerText;
  runningPageRight.textContent = showRightNum ? `${currentPage + 1}` : '';

  if (currentPage + 1 < totalPages) {
    runningTitleLeft.textContent = chTitle;
    runningPageLeft.textContent = showLeftNum ? `${currentPage + 2}` : '';
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
  dropZone.hidden = true;
  bookEl.hidden = true;
  loadingEl.hidden = false;
  stats.textContent = '';

  try {
    currentBook = await parseEpub(buffer);
    currentChapter = 0;
    currentPage = 0;
    // Nothing from the previous book describes this one: its anchors and its
    // break positions are keyed by chapter index, which now means another text.
    layoutChapterIndex = -1;
    breakBaseline = null;

    chapterSelect.innerHTML = '';
    currentBook.chapters.forEach((ch, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = ch.title ?? `Chapter ${i + 1}`;
      chapterSelect.appendChild(option);
    });
    renderChapterPanel();
    updateReaderOptionsDemo();

    loadingEl.hidden = true;
    bookEl.hidden = false;
    render();
  } catch (err) {
    loadingEl.hidden = true;
    currentBook = null;
    updateReaderOptionsDemo();
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

  // An anchor is a paragraph plus a code point offset, so it survives a
  // re-break that moves every page boundary — which is what keeps the reader
  // on the same passage across a font, geometry or analysis-stage change.
  const keptAnchor =
    layout && layoutChapterIndex === currentChapter
      ? layout.anchorAt(Math.floor(currentPage / 2))
      : null;

  const t0 = performance.now();
  layout = await book.layoutChapter(chapter);
  layoutChapterIndex = currentChapter;

  if (spreadImageMap.size > 0) {
    syncImagesToLayout();
  }

  const elapsed = performance.now() - t0;
  totalPages = layout.totalPages;
  const restored = keptAnchor ? layout.locateAnchor(keptAnchor) : null;
  currentPage = restored ? restored.spreadIdx * 2 : 0;

  const movedBreaks = countMovedBreaks(layout);

  renderCurrentSpread();

  const totalChars = chapter.paragraphs.reduce((s, p) => s + p.text.length, 0);
  const totalRuby = chapter.paragraphs.reduce(
    (s, p) => s + p.inlineAnnotations.filter((a) => a.kind === 'ruby').length,
    0,
  );
  const fontName = fontFamilySelect.options[fontFamilySelect.selectedIndex].text;
  stats.textContent = [
    `${totalChars}ch`,
    `${totalPages}pp`,
    totalRuby > 0 ? `${totalRuby}ruby` : null,
    wordAwareBreaking !== 'off' ? `wordAware ${wordAwareBreaking}` : null,
    movedBreaks ? `Δ${movedBreaks.moved}/${movedBreaks.total} breaks` : null,
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
