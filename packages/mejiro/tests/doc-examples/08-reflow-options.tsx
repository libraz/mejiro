/** @jsxImportSource react */
import type { MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { useChapterLayout } from '@libraz/mejiro-react';
import { useRef, useState } from 'react';

/** Hosts the React reading-position options printed in the re-flow section. */
export function ReflowReader({
  book,
  epub,
  chapter,
}: {
  book: MejiroBook;
  epub: EpubBook;
  chapter: number;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [spreadIdx, setSpreadIdx] = useState(0);
  // #region doc:react
  const layout = useChapterLayout(book, epub, chapter, surface, {
    capturePosition: (l) => l.anchorAt(spreadIdx, 'right'),
    restorePosition: (l, anchor) => setSpreadIdx(l.locateAnchor(anchor)?.spreadIdx ?? 0),
  });
  // #endregion doc:react
  return <div ref={surface}>{layout.layout ? `spread ${spreadIdx}` : 'Loading'}</div>;
}
