export { layout, pageEl, spread };

import { segmentToInlineNode } from '@libraz/mejiro/render';
import { appendInlineNode } from './07-render-dom.js';

const host = document.createElement('div');
host.id = 'reader';
document.body.appendChild(host);

// #region doc:dom
import { DEFAULT_HEADING_STYLES, MejiroBook } from '@libraz/mejiro/book';
import { parseEpub } from '@libraz/mejiro/epub';
import { paragraphClassName } from '@libraz/mejiro/render';
import '@libraz/mejiro/render/mejiro.css';

// 1. Create a MejiroBook instance
const book = new MejiroBook({
  fontFamily: '"Noto Serif JP", serif',
  fontSize: 16,
  lineSpacing: 1.8,
  headingStyles: DEFAULT_HEADING_STYLES,
});

// 2. Compute page size from a container element
const container = document.getElementById('reader')!;
const { pageWidth, pageHeight } = book.computePageSize(container);

// 3. Load and parse an EPUB file
const response = await fetch('/book.epub');
const epub = await parseEpub(await response.arrayBuffer());

// 4. Lay out the first chapter
const layout = await book.layoutChapter(epub.chapters[0]);

// 5. Get a two-page spread (right page + left page)
const spread = layout.getSpread(0);

// spread.right  — PageResult for the right page
// spread.left   — PageResult for the left page
// spread.totalPages — total page count

// 6. Render with DOM (example for the right page)
const pageEl = document.createElement('div');
pageEl.className = 'mejiro-page';
pageEl.style.width = `${pageWidth}px`;
pageEl.style.height = `${pageHeight}px`;
pageEl.style.fontFamily = '"Noto Serif JP", serif';
pageEl.style.fontSize = '16px';
pageEl.style.lineHeight = '1.8';

for (const para of spread.right.page.paragraphs) {
  const p = document.createElement('div');
  // The class and scale draw each heading at the size the layout measured.
  p.className = paragraphClassName(para.kind, para.headingLevel);
  if (para.scale != null) p.style.setProperty('--mejiro-paragraph-scale', String(para.scale));
  for (let i = 0; i < para.lines.length; i++) {
    // Each RenderLine is one column: a <br> ends the previous one.
    if (i > 0) p.appendChild(document.createElement('br'));
    for (const seg of para.lines[i].segments) {
      // Resolves every segment type: ruby, emphasis, tate-chu-yoko, em, strong,
      // links and footnote references, including nested annotations.
      appendInlineNode(p, segmentToInlineNode(seg));
    }
  }
  pageEl.appendChild(p);
}

container.appendChild(pageEl);

// #endregion doc:dom
