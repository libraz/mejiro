/** @jsxImportSource react */
export { CustomPreview };

// #region doc:custom-preview
import type { ManuscriptChapter } from '@libraz/mejiro/book';
import { MejiroSpread, useManuscriptLayout, useMejiroBook } from '@libraz/mejiro-react';
import { useRef } from 'react';

function CustomPreview({ chapter }: { chapter: ManuscriptChapter }) {
  const { book } = useMejiroBook({ fontFamily: '"Noto Serif JP"', fontSize: 16 });
  const surface = useRef<HTMLDivElement>(null);
  const layout = useManuscriptLayout(book, chapter, surface);
  return (
    <div ref={surface} style={{ height: '100%' }}>
      {layout.layout && (
        <MejiroSpread
          spread={layout.layout.getSpread(0)}
          pageWidth={layout.pageWidth}
          pageHeight={layout.pageHeight}
          contentHeight={layout.contentHeight}
        />
      )}
    </div>
  );
}

// #endregion doc:custom-preview
