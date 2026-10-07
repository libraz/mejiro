export { container, headingSize, measures, result };

import { renderPageToDOM } from './07-render-dom.js';

const host = document.createElement('div');
host.id = 'reader';
document.body.appendChild(host);

// #region doc:pipeline
import { paginate } from '@libraz/mejiro';
import { DEFAULT_HEADING_STYLES } from '@libraz/mejiro/book';
import { MejiroBrowser } from '@libraz/mejiro/browser';
import { buildParagraphMeasures, buildRenderPage, type RenderEntry } from '@libraz/mejiro/render';
import '@libraz/mejiro/render/mejiro.css';

// 1. Create a MejiroBrowser instance
const fontSize = 16;
const mejiro = new MejiroBrowser({
  fixedFontFamily: '"Noto Serif JP"',
  fixedFontSize: fontSize,
});

// 2. Lay out a chapter. The level-1 heading is broken at the size
// buildParagraphMeasures() measures it at: its scale, rounded to whole pixels.
const headingSize = Math.round(fontSize * (DEFAULT_HEADING_STYLES[1].scale ?? 1));
const result = await mejiro.layoutChapter({
  paragraphs: [
    { text: '第一章', fontSize: headingSize },
    { text: '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。' },
  ],
  lineWidth: mejiro.verticalLineWidth(600),
});

// 3. Build render entries
const entries: RenderEntry[] = [
  {
    chars: result.paragraphs[0].chars,
    breakPoints: result.paragraphs[0].breakResult.breakPoints,
    inlineAnnotations: [],
    kind: 'heading',
    headingLevel: 1,
  },
  {
    chars: result.paragraphs[1].chars,
    breakPoints: result.paragraphs[1].breakResult.breakPoints,
    inlineAnnotations: [],
    kind: 'body',
  },
];

// 4. Build measures and paginate
const measures = buildParagraphMeasures(entries, {
  fontSize,
  lineSpacing: 1.8,
});
const pages = paginate(400, measures);

// 5. Render each page, drawing the heading at the size it was broken at
const container = document.getElementById('reader')!;
for (let i = 0; i < pages.length; i++) {
  const pageDiv = document.createElement('div');
  const renderPage = buildRenderPage(pages[i], entries);
  renderPageToDOM(pageDiv, {
    paragraphs: renderPage.paragraphs.map((p) =>
      p.headingLevel != null ? { ...p, scale: headingSize / fontSize } : p,
    ),
  });
  container.appendChild(pageDiv);
}

// #endregion doc:pipeline
