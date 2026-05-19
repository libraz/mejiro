// Opt in to the demo webfonts (Shippori Mincho / Noto Serif JP /
// Zen Kaku Gothic New). Skip this line for system fonts.
import '@libraz/mejiro/render/mejiro-fonts.css';
import { MejiroReader } from '@libraz/mejiro-react';

export default function App() {
  // Common patterns:
  //   <MejiroReader epubUrl="/book.epub" />               // open a URL (this example)
  //   <MejiroReader epub={parsedBook} />                  // pre-parsed EPUB
  //   <MejiroReader epubUrl="/book.epub" bare />          // bare spread
  //   <MejiroReader logo={<img src="/logo.svg" />} />     // swap the logo
  //   <MejiroReader enableDropZone />                     // let users drop their own EPUB
  //
  // SaaS-style defaults: drop zone + image overlay are off; the host decides
  // which EPUB to deliver. Flip `enableDropZone` / `enableImageOverlay` when
  // you want a free-form viewer.
  //
  // v0.5 additions worth trying:
  //   theme="dark"                                       // 'light' | 'dark' | 'sepia' | 'high-contrast' | 'auto'
  //   mode="scroll"                                       // continuous vertical scroll
  //   spreadMode="auto"                                   // collapse to single page on portrait
  //   locale="en"                                         // 'ja' (default) | 'en'
  //   fetchOptions={{ headers: { Authorization: '…' } }}  // authenticated EPUB fetch
  //   fallback={<p>Loading…</p>}                          // shown until client layout is ready
  return <MejiroReader epubUrl="/neko.epub" subtitle="React Example" />;
}
