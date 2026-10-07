export { renderPage, result };

// `buffer` comes from the loading examples printed above this one.
const buffer = await (await fetch('/books/example.epub')).arrayBuffer();

// #region doc:pipeline
import { paginate } from '@libraz/mejiro';
import { DEFAULT_HEADING_STYLES } from '@libraz/mejiro/book';
import { MejiroBrowser } from '@libraz/mejiro/browser';
import { parseEpub } from '@libraz/mejiro/epub';
import { buildParagraphMeasures, buildRenderPage, type RenderEntry } from '@libraz/mejiro/render';

const fontSize = 16;
const mejiro = new MejiroBrowser({
  fixedFontFamily: '"Noto Serif JP"',
  fixedFontSize: fontSize,
});

const book = await parseEpub(buffer);
const chapter = book.chapters[0];

// Break a heading at the size buildParagraphMeasures() measures it at: the level's
// DEFAULT_HEADING_STYLES scale, rounded to whole pixels.
const headingSize = (level: number) =>
  Math.round(fontSize * (DEFAULT_HEADING_STYLES[level]?.scale ?? 1));

const result = await mejiro.layoutChapter({
  paragraphs: chapter.paragraphs.map((p) => ({
    text: p.text,
    inlineAnnotations: p.inlineAnnotations,
    fontSize: p.headingLevel ? headingSize(p.headingLevel) : undefined,
  })),
  lineWidth: mejiro.verticalLineWidth(600),
});

const entries: RenderEntry[] = chapter.paragraphs.map((p, i) => ({
  chars: result.paragraphs[i].chars,
  breakPoints: result.paragraphs[i].breakResult.breakPoints,
  inlineAnnotations: p.inlineAnnotations,
  headingLevel: p.headingLevel,
}));

const measures = buildParagraphMeasures(entries, { fontSize, lineSpacing: 1.8 });
const pages = paginate(400, measures);
const renderPage = buildRenderPage(pages[0], entries);

// #endregion doc:pipeline
