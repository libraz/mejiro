/** @jsxImportSource react */
// #region doc:client
// app/works/[slug]/ReaderClient.tsx — client component
'use client';

import { MejiroReader } from '@libraz/mejiro-react';

// `initialHtml` must come from a trusted source (your own server, via
// renderEpubStatic). For user-supplied HTML, sanitize with DOMPurify
// before passing it into the fallback wrapper below.
function StaticFallback({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

interface Props {
  slug: string;
  initialHtml: string;
}

export function ReaderClient({ slug, initialHtml }: Props) {
  return (
    <MejiroReader
      epubUrl={`/api/works/${slug}/epub`}
      fallback={<StaticFallback html={initialHtml} />}
    />
  );
}
// #endregion doc:client
