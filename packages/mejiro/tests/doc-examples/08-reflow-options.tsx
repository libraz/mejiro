/** @jsxImportSource react */
import type { MejiroBook } from '@libraz/mejiro/book';
import type { EpubBook } from '@libraz/mejiro/epub';
import { useChapterLayout } from '@libraz/mejiro-react';
import { useRef, useState } from 'react';

/** Hosts the React reading-position options printed in the re-flow section. */
export function ReflowReader({
  book,
  epub,
  chapterIndex,
}: {
  book: MejiroBook;
  epub: EpubBook;
  chapterIndex: number;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [spreadIndex, setSpreadIndex] = useState(0);
  // #region doc:react
  const layout = useChapterLayout(book, {
    epub,
    chapterIndex,
    surface,
    capturePosition: (l) => l.anchorAt(spreadIndex),
    restorePosition: (l, anchor) => setSpreadIndex(l.locateAnchor(anchor)?.spreadIndex ?? 0),
  });
  // #endregion doc:react
  return <div ref={surface}>{layout.layout ? `spread ${spreadIndex}` : 'Loading'}</div>;
}
