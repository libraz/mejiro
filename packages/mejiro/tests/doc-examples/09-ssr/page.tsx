/** @jsxImportSource react */

// #region doc:server
// app/works/[slug]/page.tsx — server component
import { parseEpub } from '@libraz/mejiro/epub';
import { renderEpubStatic } from '@libraz/mejiro/render';
import { ReaderClient } from './ReaderClient';

export default async function ReaderPage({ params }: { params: { slug: string } }) {
  // fetchEpubBuffer() stands for however your server loads the EPUB bytes.
  const buf = await fetchEpubBuffer(params.slug);
  const book = await parseEpub(buf);
  // renderEpubStatic() output is built from parseEpub() results with text and
  // attributes escaped, and link hrefs restricted to safe URL schemes.
  const initialHtml = renderEpubStatic(book.chapters[0], { ariaLabel: book.title });
  return <ReaderClient slug={params.slug} initialHtml={initialHtml} />;
}

// #endregion doc:server

// Imports are hoisted; kept below the region so the printed example stays whole.
import { fetchEpubBuffer } from './storage';
