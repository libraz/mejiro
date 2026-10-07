export { page };

import type { RenderEntry } from '@libraz/mejiro/render';

const entries: RenderEntry[] = [
  {
    chars: [...'漢字を読む'],
    breakPoints: new Uint32Array(),
    inlineAnnotations: [
      { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'かんじ', type: 'group' },
    ],
  },
];

// #region doc:segments
import { paginate } from '@libraz/mejiro';
import { buildParagraphMeasures, buildRenderPage } from '@libraz/mejiro/render';

// After layout, with one RenderEntry per paragraph...
const measures = buildParagraphMeasures(entries, { fontSize: 16, lineSpacing: 1.8 });
const pages = paginate(400, measures);
const page = buildRenderPage(pages[0], entries);

for (const para of page.paragraphs) {
  for (const line of para.lines) {
    for (const segment of line.segments) {
      if (segment.type === 'ruby') {
        // segment.base     -- base text string
        // segment.rubyText -- ruby text string
        // segment.children -- annotations nested inside the base, if any
        // Render as: <ruby>base<rt>rubyText</rt></ruby>
      } else {
        // Not ruby: 'text', 'emphasis', 'tcy', 'em', 'strong', 'link' or
        // 'footnote-ref'. Every one of these carries a `text` field.
      }
    }
  }
}

// #endregion doc:segments
