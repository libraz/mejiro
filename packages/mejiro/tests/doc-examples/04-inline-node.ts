export { node };

import type { RenderSegment } from '@libraz/mejiro/render';

const segment: RenderSegment = { type: 'ruby', base: '漢字', rubyText: 'かんじ' };

// #region doc:inline-node
import { segmentToInlineNode } from '@libraz/mejiro/render';

const node = segmentToInlineNode(segment);
// ruby -> { type: 'element', tag: 'ruby', children: [<base>, { tag: 'rt', ... }] }
// #endregion doc:inline-node
