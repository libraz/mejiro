/**
 * Fetches 「吾輩は猫である」from Aozora Bunko and converts it to EPUB
 * with proper <ruby><rt> annotations.
 *
 * Usage: npx tsx scripts/fetch-demo-epub.ts
 *
 * Output: packages/mejiro-demo/public/neko.epub
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const AOZORA_URL = 'https://www.aozora.gr.jp/cards/000148/files/789_ruby_5639.zip';
const scriptDir = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(scriptDir, '..', 'packages', 'mejiro-demo', 'public', 'neko.epub');

/** Maximum number of paragraphs to include. */
const MAX_PARAGRAPHS = 60;
/** Maximum total character count to include. */
const MAX_CHARS = 15000;

async function main(): Promise<void> {
  console.info('Fetching Aozora Bunko text...');
  const res = await fetch(AOZORA_URL);
  if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);

  const arrayBuf = await res.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuf);

  // Find the .txt file inside the zip
  const txtFile = Object.values(zip.files).find((f) => f.name.endsWith('.txt'));
  if (!txtFile) throw new Error('No .txt file found in archive');

  const buf = await txtFile.async('nodebuffer');
  const decoder = new TextDecoder('shift_jis');
  const rawText = decoder.decode(buf);

  console.info('Converting Aozora ruby notation to XHTML...');
  const paragraphs = extractParagraphs(rawText);
  const xhtml = buildXhtml(paragraphs);

  console.info(`Extracted ${paragraphs.length} paragraphs`);

  console.info('Building EPUB...');
  const epub = buildEpub(xhtml);
  const epubBuf = await epub.generateAsync({ type: 'nodebuffer' });

  writeFileSync(OUTPUT_PATH, epubBuf);
  console.info(`Written to ${OUTPUT_PATH} (${epubBuf.length} bytes)`);
}

/**
 * Extracts paragraphs from Aozora Bunko text, skipping the header/footer.
 * Takes only the first MAX_PARAGRAPHS paragraphs.
 */
function extractParagraphs(rawText: string): string[] {
  const lines = rawText.split(/\r?\n/);

  // Find the start of actual content (after the dashed separator block)
  let contentStart = 0;
  let separatorCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('---')) {
      separatorCount++;
      if (separatorCount === 2) {
        contentStart = i + 1;
        break;
      }
    }
  }

  // Find the end of content (before 底本 or another separator)
  let contentEnd = lines.length;
  for (let i = contentStart; i < lines.length; i++) {
    if (lines[i].startsWith('底本：') || lines[i].startsWith('---')) {
      contentEnd = i;
      break;
    }
  }

  // Join consecutive non-blank lines into paragraphs.
  // Aozora Bunko wraps lines at ~70 chars for display; blank lines are real paragraph breaks.
  const paragraphs: string[] = [];
  let current = '';
  let totalChars = 0;
  for (
    let i = contentStart;
    i < contentEnd && paragraphs.length < MAX_PARAGRAPHS && totalChars < MAX_CHARS;
    i++
  ) {
    const line = lines[i].trim();
    if (line.startsWith('［＃')) continue;
    if (line.length === 0) {
      if (current.length > 0) {
        paragraphs.push(current);
        totalChars += current.length;
        current = '';
      }
      continue;
    }
    current += line;
  }
  if (current.length > 0 && paragraphs.length < MAX_PARAGRAPHS && totalChars < MAX_CHARS) {
    paragraphs.push(current);
  }

  return paragraphs;
}

/**
 * Converts Aozora Bunko ruby notation to XHTML with <ruby><rt> tags.
 *
 * Aozora notation:
 *   漢字《かんじ》  → <ruby>漢字<rt>かんじ</rt></ruby>
 *   ｜漢字列《かんじ》 → <ruby>漢字列<rt>かんじ</rt></ruby>
 */
function aozoraToHtml(text: string): string {
  // Remove ［＃...］ annotations (formatting instructions)
  let result = text.replace(/［＃[^］]*］/g, '');

  // Pattern 1: ｜base text《ruby》
  result = result.replace(/｜([^《]+)《([^》]+)》/g, '<ruby>$1<rt>$2</rt></ruby>');

  // Pattern 2: kanji《ruby》 (auto-detect kanji base)
  // Match one or more CJK characters immediately before 《
  result = result.replace(
    /([\u3400-\u9FFF\uF900-\uFAFF]+)《([^》]+)》/g,
    '<ruby>$1<rt>$2</rt></ruby>',
  );

  return result;
}

/** Builds an XHTML content document from paragraphs. */
function buildXhtml(paragraphs: string[]): string {
  const body = paragraphs.map((p) => `  <p>${aozoraToHtml(p)}</p>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja" lang="ja">
<head>
  <meta charset="UTF-8" />
  <title>吾輩は猫である</title>
</head>
<body>
  <h1>吾輩は猫である</h1>
${body}
</body>
</html>`;
}

/** Builds an EPUB ZIP archive. */
function buildEpub(xhtml: string): JSZip {
  const zip = new JSZip();

  // mimetype must be first and uncompressed
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // META-INF/container.xml
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`,
  );

  // OEBPS/content.opf
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">aozora-789</dc:identifier>
    <dc:title>吾輩は猫である</dc:title>
    <dc:creator>夏目漱石</dc:creator>
    <dc:language>ja</dc:language>
    <meta property="dcterms:modified">2024-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml" />
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
  </manifest>
  <spine>
    <itemref idref="chapter1" />
  </spine>
</package>`,
  );

  // OEBPS/nav.xhtml
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Navigation</title></head>
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="chapter1.xhtml">一</a></li>
    </ol>
  </nav>
</body>
</html>`,
  );

  // OEBPS/chapter1.xhtml
  zip.file('OEBPS/chapter1.xhtml', xhtml);

  return zip;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
