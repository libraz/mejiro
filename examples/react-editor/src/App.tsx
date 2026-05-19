// Opt in to the demo webfonts (Shippori Mincho / Noto Serif JP /
// Zen Kaku Gothic New). Skip this line for system fonts.
import '@libraz/mejiro/render/mejiro-fonts.css';
import { MejiroEditor } from '@libraz/mejiro-react';

/*
 * MejiroEditor is the author flow for editing an EXISTING EPUB:
 *
 *   - load an EPUB by URL or by drag-and-drop,
 *   - pick a paragraph, edit its text and ruby annotations,
 *   - insert images after the selected paragraph,
 *   - export the modified EPUB.
 *
 * For the "write a new book from a blank canvas" flow, see the
 * `react-manuscript` example (uses MejiroManuscriptEditor instead).
 */
export default function App() {
  return (
    <MejiroEditor
      epubUrl="/neko.epub"
      onLoad={(editor) => console.log('[editor] loaded', editor)}
      onExport={(buffer) => {
        // The editor also triggers a browser download. Use this hook to
        // upload to your backend, replace the URL, run a validator, etc.
        console.log('[editor] exported', buffer.byteLength, 'bytes');
      }}
    />
  );
}
