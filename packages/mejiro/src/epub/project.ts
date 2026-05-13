import JSZip from 'jszip';
import type { InlineAnnotation } from '../browser/types.js';
import {
  type ManuscriptDialect,
  type ParseManuscriptOptions,
  parseManuscript,
  parseManuscriptRuby,
} from '../manuscript.js';
import { type EpubExportOptions, generateZip, throwIfAborted } from './editor.js';

export type { ManuscriptDialect, ParseManuscriptOptions };
export { parseManuscript, parseManuscriptRuby };

/**
 * EPUB 3 package metadata. Most fields map directly onto `<dc:*>` and
 * `<meta>` entries in `package.opf`.
 *
 * `author` is kept as a convenience shortcut: when present it is folded into
 * `creators[0]` with `role: 'aut'` during export. Prefer `creators` for new
 * code.
 */
export interface EpubProjectMetadata {
  /** Book title. Required. */
  title: string;
  /** Optional subtitle (`<dc:title id="subtitle">`). */
  subtitle?: string;
  /** Long-form description (`<dc:description>`). */
  description?: string;
  /** BCP-47 language tag (defaults to `'ja'`). */
  language?: string;
  /** Unique identifier (`<dc:identifier>`). Auto-generated UUID if omitted. */
  identifier?: string;
  /** Publisher name (`<dc:publisher>`). */
  publisher?: string;
  /** Rights statement (`<dc:rights>`). */
  rights?: string;
  /** Publication date (`<dc:date>`). */
  date?: Date;
  /** Last-modified date (`<meta property="dcterms:modified">`). Defaults to now. */
  modified?: Date;
  /**
   * Primary creators. Folded into `<dc:creator>` entries with optional
   * `opf:role` and `opf:file-as` refinements.
   */
  creators?: EpubContributor[];
  /** Additional contributors (`<dc:contributor>`). */
  contributors?: EpubContributor[];
  /** Subject keywords / tags / genres (`<dc:subject>`). */
  subjects?: string[];
  /** calibre series metadata. */
  series?: { name: string; index?: number };
  /** EPUB 3 collection metadata (`<meta property="belongs-to-collection">`). */
  collections?: EpubCollection[];
  /**
   * Legacy single-author shortcut. Mapped to `creators[0]` with role `'aut'`
   * during export. Prefer `creators` in new code.
   */
  author?: string;
}

/** Person responsible for the work — author, illustrator, translator, etc. */
export interface EpubContributor {
  /** Display name. */
  name: string;
  /**
   * MARC relator role code (`'aut' | 'trl' | 'ill' | 'edt' | 'ann' | …`) or a
   * free-form value preserved as-is.
   */
  role?: string;
  /** Sort-by name (`opf:file-as`). */
  fileAs?: string;
}

/** EPUB 3 collection (series or set). */
export interface EpubCollection {
  name: string;
  type?: 'series' | 'set';
  /** Position within the collection. */
  index?: number;
}

export interface ManuscriptChapterInput {
  id?: string;
  title: string;
  body: string;
}

export interface EpubProjectAsset {
  id?: string;
  href: string;
  mediaType?: string;
  /**
   * Binary asset data. Either this or {@link EpubProjectAsset.url} must be
   * set. When both are present, `data` wins.
   */
  data?: Uint8Array | ArrayBuffer;
  /**
   * External URL fetched at export time via the
   * {@link EpubExportOptions.assetResolver} (or the runtime `fetch` when no
   * resolver is supplied).
   */
  url?: string;
  properties?: string;
}

export interface EpubProjectOptions {
  metadata: EpubProjectMetadata;
  chapters?: ManuscriptChapterInput[];
  cover?: EpubProjectAsset;
  stylesheet?: string;
  /** Include a title page before the first manuscript chapter. @defaultValue true */
  includeTitlePage?: boolean;
  /** Place the book title at the beginning of the first chapter. @defaultValue false */
  includeTitleInFirstChapter?: boolean;
}

interface ProjectChapter {
  id: string;
  title: string;
  body: string;
}

const DEFAULT_STYLESHEET = `html, body {
  margin: 0;
  padding: 0;
}
body {
  writing-mode: vertical-rl;
  line-height: 1.9;
}
p {
  margin: 0 0 0 1em;
}
.title-page h1 {
  font-size: 1.6em;
  margin: 0 0 0 1.6em;
}
.title-page-author,
.title-page-publisher {
  margin: 0 0 0 1em;
}
rt {
  font-size: 50%;
}`;

/** Builds a new EPUB package from manuscript chapters and assets. */
export class EpubProject {
  readonly metadata: EpubProjectMetadata;
  readonly chapters: ProjectChapter[] = [];
  readonly assets: EpubProjectAsset[] = [];
  readonly includeTitlePage: boolean;
  readonly includeTitleInFirstChapter: boolean;
  stylesheet: string;

  constructor(options: EpubProjectOptions) {
    this.metadata = {
      language: 'ja',
      identifier: `urn:uuid:${crypto.randomUUID()}`,
      modified: new Date(),
      ...options.metadata,
    };
    this.includeTitlePage = options.includeTitlePage ?? true;
    this.includeTitleInFirstChapter = options.includeTitleInFirstChapter ?? false;
    this.stylesheet = options.stylesheet ?? DEFAULT_STYLESHEET;
    for (const chapter of options.chapters ?? []) this.addChapter(chapter);
    if (options.cover) this.setCover(options.cover);
  }

  static fromManuscript(options: EpubProjectOptions): EpubProject {
    return new EpubProject(options);
  }

  addChapter(chapter: ManuscriptChapterInput): void {
    this.chapters.push({
      id: uniqueManifestId(
        toManifestId(
          chapter.id ?? `chapter-${this.chapters.length + 1}`,
          `chapter-${this.chapters.length + 1}`,
        ),
        projectManifestIds(this),
      ),
      title: chapter.title,
      body: chapter.body,
    });
  }

  /**
   * Updates a chapter's title and/or body. Pass a partial patch — omitted
   * fields keep their previous value.
   */
  updateChapter(index: number, patch: Partial<Omit<ManuscriptChapterInput, 'id'>>): void {
    const chapter = this.chapters[index];
    if (!chapter) throw new Error(`Missing chapter: ${index}`);
    if (patch.title !== undefined) chapter.title = patch.title;
    if (patch.body !== undefined) chapter.body = patch.body;
  }

  /** Removes a chapter by index. */
  removeChapter(index: number): void {
    if (index < 0 || index >= this.chapters.length) throw new Error(`Missing chapter: ${index}`);
    this.chapters.splice(index, 1);
  }

  /** Moves a chapter from `from` to `to` (clamped to the chapter list bounds). */
  reorderChapters(from: number, to: number): void {
    if (from < 0 || from >= this.chapters.length) throw new Error(`Missing chapter: ${from}`);
    const [chapter] = this.chapters.splice(from, 1);
    const target = Math.max(0, Math.min(this.chapters.length, to));
    this.chapters.splice(target, 0, chapter);
  }

  /**
   * Inserts an inline image asset and embeds an internal manuscript reference
   * in the chapter body at `atParagraphIndex`. The marker is rendered as a
   * `<figure>` during the chapter XHTML pass.
   */
  addInlineImage(
    chapterIndex: number,
    atParagraphIndex: number,
    asset: EpubProjectAsset & { alt?: string },
  ): void {
    const chapter = this.chapters[chapterIndex];
    if (!chapter) throw new Error(`Missing chapter: ${chapterIndex}`);
    const storedAsset = this.addAsset(asset);

    const paragraphs = chapter.body.replace(/\r\n?/gu, '\n').split(/\n[ \t　]*\n+/u);
    const insertAt = Math.max(0, Math.min(paragraphs.length, atParagraphIndex));
    paragraphs.splice(insertAt, 0, manuscriptImageBlock({ ...asset, href: storedAsset.href }));
    chapter.body = paragraphs.join('\n\n');
  }

  setCover(asset: EpubProjectAsset): void {
    const href = asset.href || 'OPS/Images/cover.jpg';
    assertProjectAssetHref(href);
    const nonCoverAssets = this.assets.filter((existing) => existing.properties !== 'cover-image');
    const stored: EpubProjectAsset = {
      ...asset,
      id: uniqueManifestId(
        toManifestId(asset.id ?? 'cover-image'),
        projectManifestIds(this, nonCoverAssets),
      ),
      href: uniqueAssetHref(
        href,
        nonCoverAssets.map((existing) => existing.href),
      ),
      mediaType: asset.mediaType ?? mediaTypeFromHref(href),
      properties: 'cover-image',
    };
    this.assets.splice(0, this.assets.length, ...nonCoverAssets, stored);
  }

  addAsset(asset: EpubProjectAsset): EpubProjectAsset {
    assertProjectAssetHref(asset.href);
    const stored: EpubProjectAsset = {
      ...asset,
      id: uniqueManifestId(
        toManifestId(asset.id ?? manifestIdFromHref(asset.href)),
        projectManifestIds(this),
      ),
      href: uniqueAssetHref(
        asset.href,
        this.assets.map((existing) => existing.href),
      ),
      mediaType: asset.mediaType ?? mediaTypeFromHref(asset.href),
    };
    this.assets.push(stored);
    return stored;
  }

  async export(options: EpubExportOptions = {}): Promise<ArrayBuffer> {
    const { onProgress, signal } = options;
    throwIfAborted(signal);

    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', {
      binary: true,
      compression: 'STORE',
      createFolders: false,
    });

    zip.file('META-INF/container.xml', containerXml());
    zip.file('OPS/package.opf', packageOpf(this));
    zip.file('OPS/nav.xhtml', navXhtml(this));
    zip.file('OPS/Styles/style.css', this.stylesheet);
    if (this.includeTitlePage) {
      zip.file('OPS/Text/titlepage.xhtml', titlePageXhtml(this));
    }
    const totalChapters = Math.max(1, this.chapters.length);
    this.chapters.forEach((chapter, index) => {
      throwIfAborted(signal);
      zip.file(`OPS/Text/${chapterFileName(index)}`, chapterXhtml(this, chapter, index));
      onProgress?.('serialize', (index + 1) / totalChapters);
    });
    for (const asset of this.assets) {
      throwIfAborted(signal);
      zip.file(asset.href, toUint8Array(asset.data));
    }

    return generateZip(zip, onProgress, signal);
  }
}

function assertProjectAssetHref(href: string): void {
  if (!href || href.endsWith('/')) throw new Error('Asset href must point to a file');
  let decodedHref: string;
  try {
    decodedHref = decodeURIComponent(href);
  } catch {
    throw new Error(`Asset href must be a valid URI path: ${href}`);
  }
  if (
    decodedHref.includes('\\') ||
    decodedHref.includes('#') ||
    decodedHref.includes('?') ||
    decodedHref.endsWith('/')
  ) {
    throw new Error(`Asset href must be a clean EPUB file path: ${href}`);
  }
  if (decodedHref.startsWith('/') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(decodedHref)) {
    throw new Error(`Asset href must be a relative EPUB path: ${href}`);
  }
  if (decodedHref.split('/').some((part) => part === '..')) {
    throw new Error(`Asset href must not contain parent directory segments: ${href}`);
  }
}

function titlePageXhtml(project: EpubProject): string {
  const creators = normalizeCreators(project.metadata);
  const subtitle = project.metadata.subtitle
    ? `    <p class="title-page-subtitle">${escapeText(project.metadata.subtitle)}</p>`
    : '';
  const author = creators[0]
    ? `    <p class="title-page-author">${escapeText(creators[0].name)}</p>`
    : '';
  const publisher = project.metadata.publisher
    ? `    <p class="title-page-publisher">${escapeText(project.metadata.publisher)}</p>`
    : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeAttribute(
    project.metadata.language ?? 'ja',
  )}" lang="${escapeAttribute(project.metadata.language ?? 'ja')}">
<head>
  <title>${escapeText(project.metadata.title)}</title>
  <link rel="stylesheet" type="text/css" href="../Styles/style.css" />
</head>
<body>
  <section id="title-page" class="title-page">
    <h1>${escapeText(project.metadata.title)}</h1>
${subtitle}
${author}
${publisher}
  </section>
</body>
</html>`;
}

function chapterXhtml(project: EpubProject, chapter: ProjectChapter, index: number): string {
  const paragraphs = manuscriptParagraphs(chapter.body)
    .map((paragraph) => {
      const image = parseInlineImageMarker(paragraph);
      if (image) return inlineImageFigure(image);
      return `<p>${serializeManuscriptParagraph(paragraph)}</p>`;
    })
    .join('\n');
  const frontmatter =
    index === 0 && project.includeTitleInFirstChapter
      ? firstChapterFrontmatter(project, chapter.title)
      : `    <h1>${escapeText(chapter.title)}</h1>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeAttribute(
    project.metadata.language ?? 'ja',
  )}" lang="${escapeAttribute(project.metadata.language ?? 'ja')}">
<head>
  <title>${escapeText(chapter.title)}</title>
  <link rel="stylesheet" type="text/css" href="../Styles/style.css" />
</head>
<body>
  <section id="${escapeAttribute(chapter.id)}">
${frontmatter}
${paragraphs}
  </section>
</body>
</html>`;
}

function firstChapterFrontmatter(project: EpubProject, chapterTitle: string): string {
  return `    <h1>${escapeText(project.metadata.title)}</h1>
    <span id="chapter-title" hidden="">${escapeText(chapterTitle)}</span>`;
}

function serializeManuscriptParagraph(text: string): string {
  const parsed = parseManuscript(text);
  const chars = [...parsed.text];
  // Sort by start, then by widest span first so the outer markup wraps the
  // inner one cleanly. Overlapping ranges of the same start point can occur
  // when ruby + emphasis cover the same characters.
  const annotations = [...parsed.inlineAnnotations].sort(
    (a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex,
  );
  let pos = 0;
  let out = '';
  for (const ann of annotations) {
    if (ann.startIndex < pos) continue;
    out += escapeTextWithBreaks(chars.slice(pos, ann.startIndex).join(''));
    out += renderInlineAnnotation(ann, chars.slice(ann.startIndex, ann.endIndex).join(''));
    pos = ann.endIndex;
  }
  out += escapeTextWithBreaks(chars.slice(pos).join(''));
  return out;
}

function renderInlineAnnotation(ann: InlineAnnotation, body: string): string {
  const escaped = escapeText(body);
  switch (ann.kind) {
    case 'ruby':
      return `<ruby>${escaped}<rt>${escapeText(ann.rubyText)}</rt></ruby>`;
    case 'emphasis':
      return `<em class="mejiro-emphasis" data-style="${escapeAttribute(ann.style ?? 'sesame')}">${escaped}</em>`;
    case 'tcy':
      return `<span class="mejiro-tcy">${escaped}</span>`;
    case 'em':
      return `<em>${escaped}</em>`;
    case 'strong':
      return `<strong>${escaped}</strong>`;
    case 'link':
      return `<a href="${escapeAttribute(ann.href)}"${ann.title ? ` title="${escapeAttribute(ann.title)}"` : ''}>${escaped}</a>`;
    case 'footnote':
      return `<a class="mejiro-footnote-ref" href="#${escapeAttribute(ann.noteId)}">${escaped}</a>`;
    default:
      return escaped;
  }
}

function manuscriptParagraphs(body: string): string[] {
  return body
    .replace(/\r\n?/gu, '\n')
    .split(/\n[ \t　]*\n+/u)
    .map((block) =>
      block
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n'),
    )
    .filter(Boolean);
}

const INLINE_IMAGE_MARKER = /^\[\[mejiro-image:([^:|\]]+)(?:\|([^\]]*))?\]\]$/u;

/** Builds the manuscript marker for an inline image inserted via `addInlineImage`. */
function manuscriptImageBlock(asset: EpubProjectAsset & { alt?: string }): string {
  const src = relativeZipPath('OPS/Text/', asset.href);
  const altPart = asset.alt ? `|${encodeURIComponent(asset.alt)}` : '';
  return `[[mejiro-image:${encodeURIComponent(src)}${altPart}]]`;
}

function parseInlineImageMarker(paragraph: string): { src: string; alt: string } | null {
  const match = INLINE_IMAGE_MARKER.exec(paragraph.trim());
  if (!match) return null;
  const value = decodeMarkerPart(match[1]);
  const src = value.includes('/') ? value : `../Images/${value}`;
  return { src, alt: match[2] ? decodeMarkerPart(match[2]) : '' };
}

function decodeMarkerPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function inlineImageFigure(image: { src: string; alt: string }): string {
  return `<figure><img src="${escapeAttribute(image.src)}" alt="${escapeAttribute(
    image.alt,
  )}" /></figure>`;
}

function escapeTextWithBreaks(value: string): string {
  return escapeText(value).replace(/\n/gu, '<br />');
}

function packageOpf(project: EpubProject): string {
  const metadata = project.metadata;
  const modified = (metadata.modified ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const coverMeta = project.assets.find((asset) => asset.properties === 'cover-image');
  const assetItems = project.assets
    .map(
      (asset) =>
        `<item id="${escapeAttribute(asset.id ?? manifestIdFromHref(asset.href))}" href="${escapeAttribute(
          relativeZipPath('OPS/', asset.href),
        )}" media-type="${escapeAttribute(asset.mediaType ?? mediaTypeFromHref(asset.href))}"${
          asset.properties ? ` properties="${escapeAttribute(asset.properties)}"` : ''
        } />`,
    )
    .join('\n    ');
  const chapterItems = project.chapters
    .map(
      (chapter, index) =>
        `<item id="${escapeAttribute(chapter.id)}" href="Text/${chapterFileName(
          index,
        )}" media-type="application/xhtml+xml" />`,
    )
    .join('\n    ');
  const titlePageItem = project.includeTitlePage
    ? '<item id="title-page" href="Text/titlepage.xhtml" media-type="application/xhtml+xml" />'
    : '';
  const spineItems = [
    project.includeTitlePage ? '<itemref idref="title-page" />' : '',
    ...project.chapters.map((chapter) => `<itemref idref="${escapeAttribute(chapter.id)}" />`),
  ]
    .filter(Boolean)
    .join('\n    ');

  const metadataLines = buildMetadataLines(metadata, modified, coverMeta?.id);

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
${metadataLines}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="style" href="Styles/style.css" media-type="text/css" />
    ${titlePageItem}
    ${chapterItems}
    ${assetItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`;
}

function buildMetadataLines(
  metadata: EpubProjectMetadata,
  modified: string,
  coverImageId: string | undefined,
): string {
  const lines: string[] = [];
  const push = (line: string): void => {
    lines.push(`    ${line}`);
  };

  push(`<dc:identifier id="pub-id">${escapeText(metadata.identifier ?? '')}</dc:identifier>`);
  push(`<dc:title id="title">${escapeText(metadata.title)}</dc:title>`);
  if (metadata.subtitle) {
    push(`<dc:title id="subtitle">${escapeText(metadata.subtitle)}</dc:title>`);
    push('<meta refines="#subtitle" property="title-type">subtitle</meta>');
  }
  push(`<dc:language>${escapeText(metadata.language ?? 'ja')}</dc:language>`);

  if (metadata.description) {
    push(`<dc:description>${escapeText(metadata.description)}</dc:description>`);
  }
  if (metadata.rights) {
    push(`<dc:rights>${escapeText(metadata.rights)}</dc:rights>`);
  }
  if (metadata.date) {
    push(`<dc:date>${escapeText(metadata.date.toISOString().replace(/\.\d{3}Z$/, 'Z'))}</dc:date>`);
  }

  const creators = normalizeCreators(metadata);
  creators.forEach((creator, index) => {
    const id = `creator-${index + 1}`;
    push(`<dc:creator id="${id}">${escapeText(creator.name)}</dc:creator>`);
    if (creator.role) {
      push(
        `<meta refines="#${id}" property="role" scheme="marc:relators">${escapeText(creator.role)}</meta>`,
      );
    }
    if (creator.fileAs) {
      push(`<meta refines="#${id}" property="file-as">${escapeText(creator.fileAs)}</meta>`);
    }
  });

  (metadata.contributors ?? []).forEach((contributor, index) => {
    const id = `contributor-${index + 1}`;
    push(`<dc:contributor id="${id}">${escapeText(contributor.name)}</dc:contributor>`);
    if (contributor.role) {
      push(
        `<meta refines="#${id}" property="role" scheme="marc:relators">${escapeText(contributor.role)}</meta>`,
      );
    }
    if (contributor.fileAs) {
      push(`<meta refines="#${id}" property="file-as">${escapeText(contributor.fileAs)}</meta>`);
    }
  });

  for (const subject of metadata.subjects ?? []) {
    push(`<dc:subject>${escapeText(subject)}</dc:subject>`);
  }

  if (metadata.publisher) {
    push(`<dc:publisher>${escapeText(metadata.publisher)}</dc:publisher>`);
  }

  (metadata.collections ?? []).forEach((collection, index) => {
    const id = `collection-${index + 1}`;
    push(`<meta property="belongs-to-collection" id="${id}">${escapeText(collection.name)}</meta>`);
    push(
      `<meta refines="#${id}" property="collection-type">${escapeText(collection.type ?? 'series')}</meta>`,
    );
    if (collection.index !== undefined) {
      push(`<meta refines="#${id}" property="group-position">${collection.index}</meta>`);
    }
  });

  if (metadata.series) {
    push(`<meta name="calibre:series" content="${escapeAttribute(metadata.series.name)}" />`);
    if (metadata.series.index !== undefined) {
      push(
        `<meta name="calibre:series_index" content="${escapeAttribute(String(metadata.series.index))}" />`,
      );
    }
  }

  push(`<meta property="dcterms:modified">${modified}</meta>`);
  if (coverImageId) {
    push(`<meta name="cover" content="${escapeAttribute(coverImageId)}" />`);
  }

  return lines.join('\n');
}

/**
 * Resolves the effective creator list. Falls back to `metadata.author` when
 * `creators` is empty so the legacy single-author shortcut keeps working.
 */
function normalizeCreators(metadata: EpubProjectMetadata): EpubContributor[] {
  if (metadata.creators?.length) return metadata.creators;
  if (metadata.author) return [{ name: metadata.author, role: 'aut' }];
  return [];
}

function navXhtml(project: EpubProject): string {
  const items = [
    project.includeTitlePage
      ? `<li><a href="Text/titlepage.xhtml">${escapeText(project.metadata.title)}</a></li>`
      : '',
    ...project.chapters.map(
      (chapter, index) =>
        `<li><a href="Text/${chapterFileName(index)}">${escapeText(chapter.title)}</a></li>`,
    ),
  ]
    .filter(Boolean)
    .join('\n      ');

  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeAttribute(
    project.metadata.language ?? 'ja',
  )}" lang="${escapeAttribute(project.metadata.language ?? 'ja')}">
<head><title>Navigation</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>${escapeText(project.metadata.title)}</h1>
    <ol>
      ${items}
    </ol>
  </nav>
</body>
</html>`;
}

function containerXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`;
}

function chapterFileName(index: number): string {
  return `chapter-${String(index + 1).padStart(3, '0')}.xhtml`;
}

function mediaTypeFromHref(href: string): string {
  const lower = href.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.css')) return 'text/css';
  return 'application/octet-stream';
}

function manifestIdFromHref(href: string): string {
  return toManifestId(href);
}

function uniqueAssetHref(href: string, existing: readonly string[]): string {
  const used = new Set(existing);
  if (!used.has(href)) return href;
  let index = 2;
  const slashIndex = href.lastIndexOf('/');
  const dir = slashIndex >= 0 ? href.slice(0, slashIndex + 1) : '';
  const filename = slashIndex >= 0 ? href.slice(slashIndex + 1) : href;
  const extIndex = filename.lastIndexOf('.');
  const stem = extIndex > 0 ? filename.slice(0, extIndex) : filename;
  const ext = extIndex > 0 ? filename.slice(extIndex) : '';
  let candidate = `${dir}${stem}-${index}${ext}`;
  while (used.has(candidate)) {
    index++;
    candidate = `${dir}${stem}-${index}${ext}`;
  }
  return candidate;
}

const RESERVED_PACKAGE_IDS = ['nav', 'style', 'title-page', 'pub-id', 'title', 'subtitle'];

function projectManifestIds(
  project: EpubProject,
  assets: readonly EpubProjectAsset[] = project.assets,
): (string | undefined)[] {
  return [
    ...RESERVED_PACKAGE_IDS,
    ...projectMetadataIds(project.metadata),
    ...project.chapters.map((chapter) => chapter.id),
    ...assets.map((asset) => asset.id ?? manifestIdFromHref(asset.href)),
  ];
}

function projectMetadataIds(metadata: EpubProjectMetadata): string[] {
  const ids: string[] = [];
  normalizeCreators(metadata).forEach((_creator, index) => {
    ids.push(`creator-${index + 1}`);
  });
  (metadata.contributors ?? []).forEach((_contributor, index) => {
    ids.push(`contributor-${index + 1}`);
  });
  (metadata.collections ?? []).forEach((_collection, index) => {
    ids.push(`collection-${index + 1}`);
  });
  return ids;
}

function toManifestId(value: string, fallback = 'asset'): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  const base = sanitized || fallback;
  return /^[a-zA-Z_]/.test(base) ? base : `id-${base}`;
}

function uniqueManifestId(base: string, existing: readonly (string | undefined)[]): string {
  const used = new Set(existing.filter((id): id is string => Boolean(id)));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index++;
  return `${base}-${index}`;
}

function relativeZipPath(fromDir: string, target: string): string {
  const from = fromDir.split('/').filter(Boolean);
  const to = target.split('/').filter(Boolean);
  while (from.length > 0 && to.length > 0 && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return `${'../'.repeat(from.length)}${to.join('/')}`;
}

function toUint8Array(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;');
}
