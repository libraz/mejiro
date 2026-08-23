import JSZip from 'jszip';
import {
  assertEpubArchiveWithinLimits,
  EpubExpansionBudget,
  type EpubParseOptions,
  resolveEpubParseLimits,
} from './limits.js';
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
 * Requires host DOM globals (`DOMParser`, `XMLSerializer`, `Node`). Node and
 * SSR runtimes must register a DOM implementation (happy-dom, jsdom) first.
 *
 * @param data - EPUB file contents as ArrayBuffer.
 * @param options - Resource limits applied while reading the archive.
 * @returns Parsed book with chapters and ruby annotations.
 * @throws When the host has no DOM implementation, or the archive is not a readable EPUB.
 */
export async function parseEpub(
  data: ArrayBuffer,
  options: EpubParseOptions = {},
): Promise<EpubBook> {
  const limits = resolveEpubParseLimits(options);
  if (data.byteLength > limits.maxInputBytes) {
    throw new Error(`EPUB exceeds the compressed input limit (${limits.maxInputBytes} bytes)`);
  }
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
  assertEpubArchiveWithinLimits(data, zip, limits);
  const budget = new EpubExpansionBudget(limits);

  // 1. Read container.xml to find rootfile path
  const containerXml = await readZipText(zip, budget, 'META-INF/container.xml');
  const rootfilePath = extractRootfilePath(containerXml);

  // 2. Parse OPF
  const opfXml = await readZipText(zip, budget, rootfilePath);
  const opfDir = rootfilePath.includes('/')
    ? rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1)
    : '';
  const { title, author, spineHrefs, navHref, pageProgressionDirection } = parseOpfPackage(
    opfXml,
    opfDir,
  );
  const navTitles = navHref ? await readNavTitles(zip, budget, navHref) : new Map<string, string>();

  // 3. Extract chapters from spine items
  const chapters: EpubChapter[] = [];
  for (const href of spineHrefs) {
    const xhtml = await readZipTextOrNull(zip, budget, href);
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

/** Reads a text file from the ZIP archive, charged against the expansion budget. */
async function readZipText(zip: JSZip, budget: EpubExpansionBudget, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`Missing file in EPUB: ${path}`);
  return budget.readText(file);
}

async function readZipTextOrNull(
  zip: JSZip,
  budget: EpubExpansionBudget,
  path: string,
): Promise<string | null> {
  const file = zip.file(path);
  return file ? budget.readText(file) : null;
}

/**
 * @internal
 * Fails with a mejiro error naming the missing host globals, so a Node or SSR
 * caller sees what to register instead of a bare `ReferenceError`.
 *
 * @throws When the host provides no DOM implementation.
 */
export function assertEpubDomAvailable(): void {
  const missing: string[] = [];
  if (typeof DOMParser === 'undefined') missing.push('DOMParser');
  if (typeof XMLSerializer === 'undefined') missing.push('XMLSerializer');
  if (typeof Node === 'undefined') missing.push('Node');
  if (missing.length === 0) return;
  throw new Error(
    `EPUB parsing requires a DOM implementation providing ${missing.join(', ')}. Node and SSR runtimes must register one globally (for example from happy-dom or jsdom) before calling mejiro/epub.`,
  );
}

/** Parses XML string into a Document. */
function parseXml(xml: string): Document {
  assertEpubDomAvailable();
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

/**
 * @internal
 * Chapter title from the document's own headings, or `undefined` when the
 * document has none or cannot be parsed. Shared with the editor so both
 * import paths label chapters identically.
 *
 * @param xhtml - Chapter XHTML source.
 * @returns Trimmed heading text, or `undefined`.
 */
export function extractChapterTitleOrUndefined(xhtml: string): string | undefined {
  try {
    return extractChapterTitle(xhtml);
  } catch {
    return undefined;
  }
}

async function readNavTitles(
  zip: JSZip,
  budget: EpubExpansionBudget,
  navHref: string,
): Promise<Map<string, string>> {
  const navXhtml = await readZipTextOrNull(zip, budget, navHref);
  if (navXhtml == null) return new Map();
  return collectNavTitles(navXhtml, navHref);
}

/**
 * @internal
 * Maps resolved chapter ZIP paths to the title a reader sees in the table of
 * contents. Only anchors inside the TOC navigation contribute, and the first
 * anchor in document order wins for a given path, so nested `<ol>` sections do
 * not overwrite the chapter title they belong to.
 *
 * @param navXhtml - Navigation document source.
 * @param navHref - ZIP path of the navigation document, used to resolve hrefs.
 * @returns Chapter ZIP path → table-of-contents title.
 */
export function collectNavTitles(navXhtml: string, navHref: string): Map<string, string> {
  const navDir = navHref.includes('/') ? navHref.substring(0, navHref.lastIndexOf('/') + 1) : '';
  const doc = parseXml(stripStylesheetLinks(navXhtml));
  const titles = new Map<string, string>();
  for (const root of tocNavRoots(doc)) {
    for (const anchor of Array.from(root.getElementsByTagName('*'))) {
      if (anchor.localName !== 'a' && anchor.tagName !== 'a') continue;
      const href = anchor.getAttribute('href');
      const text = anchor.textContent?.trim();
      // A same-document fragment names a section of the nav itself, not a
      // spine document, so it must not bind a title.
      if (!(href && text) || href.startsWith('#')) continue;
      const key = resolveZipPath(navDir, href);
      if (!key || titles.has(key)) continue;
      titles.set(key, text);
    }
  }
  return titles;
}

const EPUB_OPS_NS = 'http://www.idpf.org/2007/ops';

/** `epub:type` values whose anchors never name a chapter. */
const NON_TOC_NAV_TYPES = new Set(['landmarks', 'page-list', 'lot', 'loi']);

/** Picks the navigation subtrees whose anchors bind chapter titles. */
function tocNavRoots(doc: Document): Element[] {
  const navs = Array.from(doc.getElementsByTagName('*')).filter(
    (el) => el.localName === 'nav' || el.tagName === 'nav',
  );
  if (navs.length === 0) return doc.documentElement ? [doc.documentElement] : [];
  const explicitToc = navs.filter((nav) => navTypes(nav).includes('toc'));
  if (explicitToc.length > 0) return explicitToc;
  // Documents that omit `epub:type` still have exactly one usable list; only
  // the well-known auxiliary navigations are excluded.
  return navs.filter((nav) => !navTypes(nav).some((type) => NON_TOC_NAV_TYPES.has(type)));
}

function navTypes(nav: Element): string[] {
  const value = nav.getAttributeNS(EPUB_OPS_NS, 'type') ?? nav.getAttribute('epub:type') ?? '';
  return value.split(/\s+/u).filter(Boolean);
}

/**
 * @internal
 * One OPF manifest entry, resolved against the package document's directory.
 */
export interface OpfManifestItem {
  /** Manifest `id` attribute. */
  id: string;
  /** Normalized ZIP path of the referenced file. */
  href: string;
  /** Href exactly as written in the OPF, preserving percent encoding. */
  packageHref: string;
  /** Declared `media-type`, when the entry has one. */
  mediaType?: string;
  /** Tokens of the `properties` attribute. */
  properties: ReadonlySet<string>;
}

/**
 * @internal
 * Metadata read from an OPF package document.
 */
export interface OpfPackage {
  /** `dc:title`, or `'Unknown Title'` when the package declares none. */
  title: string;
  /** `dc:creator`, when the package declares one. */
  author?: string;
  /** ZIP paths of the readable spine documents, in reading order. */
  spineHrefs: string[];
  /** Every manifest entry, keyed by its normalized ZIP path. */
  manifestItems: Map<string, OpfManifestItem>;
  /** ZIP path of the navigation document, when the manifest declares one. */
  navHref?: string;
  /** Spine `page-progression-direction`, when declared. */
  pageProgressionDirection?: 'rtl' | 'ltr' | 'default';
}

/**
 * @internal
 * Parses an OPF package document into the metadata every EPUB entry point
 * needs. Reading and editing share this so both accept the same spine
 * documents: an itemref contributes a chapter when it is linear, resolves to a
 * manifest entry, carries an XHTML media type (or an `.xhtml`/`.html` path
 * when the media type is missing), and is neither the navigation document nor
 * the cover image.
 *
 * @param opfXml - Package document source.
 * @param opfDir - Directory of the package document inside the ZIP.
 * @returns Package metadata with resolved manifest and spine paths.
 */
export function parseOpfPackage(opfXml: string, opfDir: string): OpfPackage {
  const doc = parseXml(opfXml);

  // Extract title — prefer namespace-aware lookup, then fall back for DOMParser implementations
  // that do not preserve XML namespaces consistently.
  const titleEl = findElementByName(doc, 'title');
  const title = titleEl?.textContent?.trim() || 'Unknown Title';

  // Extract author
  const creatorEl = findElementByName(doc, 'creator');
  const author = creatorEl?.textContent?.trim() || undefined;

  const manifestById = new Map<string, OpfManifestItem>();
  const manifestItems = new Map<string, OpfManifestItem>();
  let navHref: string | undefined;
  const manifestEl = firstElementByName(doc, 'manifest');
  for (const item of childElementsByName(manifestEl, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (!(id && href)) continue;
    const entry: OpfManifestItem = {
      id,
      href: resolveZipPath(opfDir, href),
      packageHref: href,
      mediaType: item.getAttribute('media-type') ?? undefined,
      properties: new Set((item.getAttribute('properties') ?? '').split(/\s+/u).filter(Boolean)),
    };
    manifestById.set(id, entry);
    manifestItems.set(entry.href, entry);
    if (entry.properties.has('nav')) navHref = entry.href;
  }

  // Extract spine itemrefs in order
  const spineHrefs: string[] = [];
  const spineEl = firstElementByName(doc, 'spine');
  const pageProgressionDirection = parsePageProgressionDirection(
    spineEl?.getAttribute('page-progression-direction'),
  );
  for (const itemref of childElementsByName(spineEl, 'itemref')) {
    if (itemref.getAttribute('linear') === 'no') continue;
    const idref = itemref.getAttribute('idref');
    if (!idref) continue;
    const item = manifestById.get(idref);
    if (item && isReadableSpineItem(item)) spineHrefs.push(item.href);
  }

  return { title, author, spineHrefs, manifestItems, navHref, pageProgressionDirection };
}

function parsePageProgressionDirection(
  value: string | null | undefined,
): 'rtl' | 'ltr' | 'default' | undefined {
  return value === 'rtl' || value === 'ltr' || value === 'default' ? value : undefined;
}

function isReadableSpineItem(item: OpfManifestItem): boolean {
  const mediaType = item.mediaType ?? '';
  if (
    mediaType !== 'application/xhtml+xml' &&
    (mediaType !== '' || !/\.x?html$/iu.test(item.href))
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

/**
 * @internal
 * Resolves an EPUB href against a directory into a normalized ZIP path,
 * dropping any fragment/query and decoding percent escapes.
 *
 * @param baseDir - Directory the href is relative to, with a trailing slash.
 * @param href - Href as written in the source document.
 * @returns Normalized ZIP path.
 * @throws When the href contains invalid percent encoding.
 */
export function resolveZipPath(baseDir: string, href: string): string {
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
