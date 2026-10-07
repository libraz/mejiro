export { measures, pages, renderPage };

import type { BookParagraph } from '@libraz/mejiro/book';
import { MejiroBrowser } from '@libraz/mejiro/browser';

// `chapter` and `result` stand for a chapter and its layoutChapter() output.
const chapter: { paragraphs: BookParagraph[] } = {
  paragraphs: [
    { text: '第一章', kind: 'heading', headingLevel: 1 },
    { text: '吾輩は猫である。名前はまだ無い。' },
  ],
};
const result = await new MejiroBrowser({
  fixedFontFamily: 'serif',
  fixedFontSize: 16,
}).layoutChapter({ paragraphs: chapter.paragraphs.map((p) => ({ text: p.text })), lineWidth: 400 });

// #region doc:entries
import type { RenderEntry } from '@libraz/mejiro/render';

const entries: RenderEntry[] = chapter.paragraphs.map((p, i) => ({
  chars: result.paragraphs[i].chars,
  breakPoints: result.paragraphs[i].breakResult.breakPoints,
  inlineAnnotations: p.inlineAnnotations ?? [],
  kind: p.kind,
  headingLevel: p.headingLevel,
}));

// #endregion doc:entries

// #region doc:measures
import { buildParagraphMeasures } from '@libraz/mejiro/render';

const measures = buildParagraphMeasures(entries, {
  fontSize: 16,
  lineSpacing: 1.8,
  headingScale: 1.4,
  paragraphGapEm: 0.4,
});

// #endregion doc:measures

// #region doc:paginate
import { paginate } from '@libraz/mejiro';

const pages = paginate(400, measures);

// pages[0] = [{ paragraphIndex: 0, lineStart: 0, lineEnd: 5 }, ...]
// pages[1] = [...]
// #endregion doc:paginate

// #region doc:render-page
import { buildRenderPage } from '@libraz/mejiro/render';

const renderPage = buildRenderPage(pages[0], entries);

// #endregion doc:render-page
