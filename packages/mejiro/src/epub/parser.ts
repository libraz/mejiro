import JSZip from 'jszip';
import { extractRubyContent } from './ruby-extractor.js';
import type { EpubBook, EpubChapter } from './types.js';

/**
 * Parses an EPUB file from an ArrayBuffer.
 *
 * Reads the ZIP structure, extracts OPF metadata (title, author),
 * follows the spine order, and extracts ruby-annotated paragraphs
 * from each XHTML content document.
 *
 * @param data - EPUB file contents as ArrayBuffer.
 * @returns Parsed book with chapters and ruby annotations.
 */
export async function parseEpub(data: ArrayBuffer): Promise<EpubBook> {
  const zip = await JSZip.loadAsync(data);

  // 1. Read container.xml to find rootfile path
  const containerXml = await readZipText(zip, 'META-INF/container.xml');
  const rootfilePath = extractRootfilePath(containerXml);

  // 2. Parse OPF
  const opfXml = await readZipText(zip, rootfilePath);
  const opfDir = rootfilePath.includes('/')
    ? rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1)
    : '';
  const { title, author, spineHrefs } = parseOpf(opfXml, opfDir);

  // 3. Extract chapters from spine items
  const chapters: EpubChapter[] = [];
  for (const href of spineHrefs) {
    const xhtml = await readZipText(zip, href);
    const paragraphs = extractRubyContent(xhtml);
    const chapterTitle = extractChapterTitle(xhtml);

    if (paragraphs.length > 0) {
      chapters.push({ title: chapterTitle, paragraphs });
    }
  }

  return { title, author, chapters };
}

/** Reads a text file from the ZIP archive. */
async function readZipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`Missing file in EPUB: ${path}`);
  return file.async('string');
}

/** Parses XML string into a Document. */
function parseXml(xml: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(xml, 'application/xml');
}

/** Extracts the rootfile path from container.xml. */
function extractRootfilePath(containerXml: string): string {
  const doc = parseXml(containerXml);
  const rootfile = doc.querySelector('rootfile');
  const fullPath = rootfile?.getAttribute('full-path');
  if (!fullPath) throw new Error('Cannot find rootfile path in container.xml');
  return fullPath;
}

/** Extracts chapter title from XHTML heading elements. */
function extractChapterTitle(xhtml: string): string | undefined {
  const doc = parseXml(xhtml);
  for (const tag of ['h1', 'h2', 'h3']) {
    const el = doc.getElementsByTagName(tag)[0];
    if (el?.textContent?.trim()) {
      return el.textContent.trim();
    }
  }
  return undefined;
}

/** Parses OPF to extract metadata and spine item hrefs. */
function parseOpf(
  opfXml: string,
  opfDir: string,
): {
  title: string;
  author?: string;
  spineHrefs: string[];
} {
  const doc = parseXml(opfXml);

  // Extract title — getElementsByTagNameNS handles the dc: namespace
  const titleEl = doc.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'title')[0];
  const title = titleEl?.textContent?.trim() || 'Unknown Title';

  // Extract author
  const creatorEl = doc.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'creator')[0];
  const author = creatorEl?.textContent?.trim() || undefined;

  // Build manifest id → href map
  const manifest = new Map<string, string>();
  const items = doc.querySelectorAll('manifest > item');
  for (const item of Array.from(items)) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) {
      manifest.set(id, opfDir + href);
    }
  }

  // Extract spine itemrefs in order
  const spineHrefs: string[] = [];
  const itemrefs = doc.querySelectorAll('spine > itemref');
  for (const itemref of Array.from(itemrefs)) {
    const idref = itemref.getAttribute('idref');
    if (idref) {
      const href = manifest.get(idref);
      if (href) spineHrefs.push(href);
    }
  }

  return { title, author, spineHrefs };
}
