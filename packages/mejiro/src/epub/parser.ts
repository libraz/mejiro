import JSZip from 'jszip';
import { extractRubyContent } from './ruby-extractor.js';
import type { AnnotatedParagraph, EpubBook, EpubChapter } from './types.js';
import { stripStylesheetLinks } from './xml-utils.js';

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
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch (err) {
    // JSZip's native messages ("Can't find end of central directory…") leak
    // internal terminology. Wrap so the consumer sees a stable, user-friendly
    // failure mode for arbitrary non-EPUB input (corrupt buffer, wrong file
    // type, truncated upload).
    throw new Error(`Not a valid EPUB file: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 1. Read container.xml to find rootfile path
  const containerXml = await readZipText(zip, 'META-INF/container.xml');
  const rootfilePath = extractRootfilePath(containerXml);

  // 2. Parse OPF
  const opfXml = await readZipText(zip, rootfilePath);
  const opfDir = rootfilePath.includes('/')
    ? rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1)
    : '';
  const { title, author, spineItems, navHref, pageProgressionDirection } = parseOpf(opfXml, opfDir);
  const navTitles = navHref ? await readNavTitles(zip, navHref) : new Map<string, string>();

  // 3. Extract chapters from spine items
  const chapters: EpubChapter[] = [];
  for (const { href } of spineItems) {
    const xhtml = await readZipTextOrNull(zip, href);
    if (xhtml == null) continue;
    let paragraphs: AnnotatedParagraph[];
    try {
      paragraphs = extractRubyContent(xhtml);
    } catch (err) {
      // Wrap so the failing chapter is identifiable. Bare XHTML parser errors
      // would otherwise leave the consumer guessing which spine entry broke.
      throw new Error(
        `Failed to parse chapter XHTML: ${href} (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    const chapterTitle = extractChapterTitleOrUndefined(xhtml) ?? navTitles.get(href);

    if (paragraphs.length > 0) {
      chapters.push({ title: chapterTitle, paragraphs });
    }
  }

  if (chapters.length === 0) {
    throw new Error('EPUB has no readable chapters');
  }

  return {
    title,
    author,
    chapters,
    ...(pageProgressionDirection ? { pageProgressionDirection } : {}),
  };
}

/** Reads a text file from the ZIP archive. */
async function readZipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`Missing file in EPUB: ${path}`);
  return file.async('string');
}

async function readZipTextOrNull(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  return file ? file.async('string') : null;
}

/** Parses XML string into a Document. */
function parseXml(xml: string): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Failed to parse XML document');
  }
  return doc;
}

/** Extracts the rootfile path from container.xml. */
function extractRootfilePath(containerXml: string): string {
  const doc = parseXml(containerXml);
  const rootfile = firstElementByName(doc, 'rootfile');
  const fullPath = rootfile?.getAttribute('full-path');
  if (!fullPath) throw new Error('Cannot find rootfile path in container.xml');
  return fullPath;
}

/** Extracts chapter title from XHTML heading elements. */
function extractChapterTitle(xhtml: string): string | undefined {
  const doc = parseXml(stripStylesheetLinks(xhtml));
  const explicitTitle = doc.getElementById('chapter-title');
  if (explicitTitle?.textContent?.trim()) {
    return explicitTitle.textContent.trim();
  }
  for (const tag of ['h1', 'h2', 'h3']) {
    const el = firstElementByName(doc, tag);
    if (el?.textContent?.trim()) {
      return el.textContent.trim();
    }
  }
  return undefined;
}

function extractChapterTitleOrUndefined(xhtml: string): string | undefined {
  try {
    return extractChapterTitle(xhtml);
  } catch {
    return undefined;
  }
}

async function readNavTitles(zip: JSZip, navHref: string): Promise<Map<string, string>> {
  const navXhtml = await readZipTextOrNull(zip, navHref);
  if (navXhtml == null) return new Map();
  const navDir = navHref.includes('/') ? navHref.substring(0, navHref.lastIndexOf('/') + 1) : '';
  const doc = parseXml(stripStylesheetLinks(navXhtml));
  const titles = new Map<string, string>();
  for (const anchor of Array.from(doc.getElementsByTagName('*'))) {
    if (anchor.localName !== 'a' && anchor.tagName !== 'a') continue;
    const href = anchor.getAttribute('href');
    const text = anchor.textContent?.trim();
    if (!(href && text)) continue;
    titles.set(resolveZipPath(navDir, href), text);
  }
  return titles;
}

/** Parses OPF to extract metadata and spine item hrefs. */
function parseOpf(
  opfXml: string,
  opfDir: string,
): {
  title: string;
  author?: string;
  spineItems: Array<{ href: string }>;
  navHref?: string;
  pageProgressionDirection?: 'rtl' | 'ltr' | 'default';
} {
  const doc = parseXml(opfXml);

  // Extract title — prefer namespace-aware lookup, then fall back for DOMParser implementations
  // that do not preserve XML namespaces consistently.
  const titleEl = findElementByName(doc, 'title');
  const title = titleEl?.textContent?.trim() || 'Unknown Title';

  // Extract author
  const creatorEl = findElementByName(doc, 'creator');
  const author = creatorEl?.textContent?.trim() || undefined;

  // Build manifest id → spine-readable item map
  const manifest = new Map<string, { href: string; mediaType: string; properties: Set<string> }>();
  let navHref: string | undefined;
  const manifestEl = firstElementByName(doc, 'manifest');
  for (const item of childElementsByName(manifestEl, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    const mediaType = item.getAttribute('media-type') ?? '';
    if (id && href) {
      const entry = {
        href: resolveZipPath(opfDir, href),
        mediaType,
        properties: new Set((item.getAttribute('properties') ?? '').split(/\s+/u).filter(Boolean)),
      };
      manifest.set(id, entry);
      if (entry.properties.has('nav')) navHref = entry.href;
    }
  }

  // Extract spine itemrefs in order
  const spineItems: Array<{ href: string }> = [];
  const spineEl = firstElementByName(doc, 'spine');
  const pageProgressionDirection = parsePageProgressionDirection(
    spineEl?.getAttribute('page-progression-direction'),
  );
  for (const itemref of childElementsByName(spineEl, 'itemref')) {
    if (itemref.getAttribute('linear') === 'no') continue;
    const idref = itemref.getAttribute('idref');
    if (idref) {
      const item = manifest.get(idref);
      if (item && isReadableSpineItem(item)) spineItems.push({ href: item.href });
    }
  }

  return { title, author, spineItems, navHref, pageProgressionDirection };
}

function parsePageProgressionDirection(
  value: string | null | undefined,
): 'rtl' | 'ltr' | 'default' | undefined {
  return value === 'rtl' || value === 'ltr' || value === 'default' ? value : undefined;
}

function isReadableSpineItem(item: {
  href: string;
  mediaType: string;
  properties: ReadonlySet<string>;
}): boolean {
  if (
    item.mediaType !== 'application/xhtml+xml' &&
    (item.mediaType !== '' || !/\.x?html$/iu.test(item.href))
  ) {
    return false;
  }
  if (item.properties.has('nav') || item.properties.has('cover-image')) return false;
  return true;
}

function firstElementByName(parent: Document | Element, localName: string): Element | undefined {
  return Array.from(parent.getElementsByTagName('*')).find(
    (el) => el.localName === localName || el.tagName === localName,
  );
}

function childElementsByName(parent: Element | undefined, localName: string): Element[] {
  if (!parent) return [];
  return Array.from(parent.children).filter(
    (el) => el.localName === localName || el.tagName === localName,
  );
}

function resolveZipPath(baseDir: string, href: string): string {
  const hrefPath = href.split('#', 1)[0].split('?', 1)[0];
  let decodedHref: string;
  try {
    decodedHref = decodeURIComponent(hrefPath);
  } catch {
    throw new Error(`Invalid EPUB href: ${href}`);
  }
  const parts = `${baseDir}${decodedHref}`.split('/');
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      normalized.pop();
    } else {
      normalized.push(part);
    }
  }
  return normalized.join('/');
}

function findElementByName(doc: Document, localName: string): Element | undefined {
  const nsEl = doc.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', localName)[0];
  if (nsEl) return nsEl;

  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (el.localName === localName || el.tagName === `dc:${localName}`) {
      return el;
    }
  }
  return undefined;
}
