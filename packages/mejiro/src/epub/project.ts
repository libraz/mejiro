import JSZip from 'jszip';
import {
  type ManuscriptDialect,
  type ParseManuscriptOptions,
  parseManuscript,
  parseManuscriptRuby,
} from '../manuscript.js';
import { buildInlineNodes, type InlineNode } from '../render/inline-tree.js';
import { type EpubExportOptions, generateZip, resolveAssetData, throwIfAborted } from './editor.js';
import {
  insertManuscriptParagraph,
  manuscriptParagraphs,
  parseInlineImageMarker,
} from './manuscript-source.js';

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
  /** Collection name, emitted as the `belongs-to-collection` meta value. */
  name: string;
  /** Collection kind refinement (`collection-type`). @defaultValue 'series' */
  type?: 'series' | 'set';
  /** Position within the collection. */
  index?: number;
}

/** A chapter authored as manuscript notation, as accepted by {@link EpubProject.addChapter}. */
export interface ManuscriptChapterInput {
  /**
   * Preferred manifest / section id. Sanitized to an XML-safe id and suffixed
   * when it collides with a reserved or already-used id, so the value stored on
   * the project may differ from the one passed here. Defaults to
   * `chapter-<position>`.
   */
  id?: string;
  /** Chapter title. Used for the chapter `<h1>`, its `<title>` and its nav entry. */
  title: string;
  /**
   * Manuscript notation source. Split into paragraphs on blank lines and parsed
   * with the project's {@link EpubProject.dialect} at export time, so ruby and
   * the other inline notations become real EPUB markup rather than literal text.
   */
  body: string;
}

/** A binary file packaged alongside the chapters — cover, inline image, extra stylesheet. */
export interface EpubProjectAsset {
  /**
   * Preferred manifest item id. Sanitized and de-duplicated like
   * {@link ManuscriptChapterInput.id}; defaults to an id derived from `href`.
   */
  id?: string;
  /**
   * Destination path inside the EPUB ZIP, relative to the archive root
   * (e.g. `'OPS/Images/cover.jpg'`). Must be a clean relative file path:
   * {@link EpubProject.addAsset} and {@link EpubProject.setCover} throw on an
   * absolute path, a URI scheme, a `..` segment, a `#`/`?`/`\` character or a
   * trailing slash. A path that collides with another asset or with a document
   * `export()` generates is renamed, so read the stored href back from the value
   * `addAsset()` returns rather than assuming this one was kept.
   */
  href: string;
  /**
   * OPF media type. Inferred from the `href` extension when omitted, falling
   * back to `application/octet-stream` for unknown extensions.
   */
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
  /**
   * OPF manifest `properties` attribute. {@link EpubProject.setCover} sets
   * `'cover-image'`, which also marks the asset as the one the cover `<meta>`
   * entry points at and exempts it from unreferenced-asset cleanup.
   */
  properties?: string;
}

/** Constructor options for {@link EpubProject}. */
export interface EpubProjectOptions {
  /** Package metadata. Only `title` is required; the rest is defaulted at export. */
  metadata: EpubProjectMetadata;
  /**
   * Initial chapters, appended in order through {@link EpubProject.addChapter}
   * — so their ids go through the same sanitizing and de-duplication.
   */
  chapters?: ManuscriptChapterInput[];
  /** Manuscript notation dialect used when serializing chapters. @defaultValue `'mejiro'` */
  dialect?: ManuscriptDialect;
  /**
   * Cover image, registered through {@link EpubProject.setCover} after
   * `chapters`. Its href defaults to `'OPS/Images/cover.jpg'` when empty.
   */
  cover?: EpubProjectAsset;
  /**
   * CSS written to `OPS/Styles/style.css` and linked from every generated
   * document. Defaults to a minimal vertical-writing stylesheet.
   */
  stylesheet?: string;
  /** Spine page progression direction. @defaultValue 'rtl' for vertical Japanese books. */
  pageProgressionDirection?: 'rtl' | 'ltr' | 'default';
  /** Include a title page before the first manuscript chapter. @defaultValue true */
  includeTitlePage?: boolean;
  /** Place the book title at the beginning of the first chapter. @defaultValue false */
  includeTitleInFirstChapter?: boolean;
}

/**
 * A chapter as it is stored on a project — the resolved form of
 * {@link ManuscriptChapterInput}, with the manifest id already assigned and
 * de-duplicated. Element type of {@link EpubProject.chapters}.
 */
export interface ProjectChapter {
  /**
   * Manifest / section id in effect, derived from the input id. Assigned once
   * at insert time and never rewritten, so reordering chapters does not
   * renumber them.
   */
  id: string;
  /** Chapter title, as given. */
  title: string;
  /** Manuscript notation source, as given. */
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
  /**
   * Package metadata with the defaults already applied: `language` falls back to
   * `'ja'`, a blank or missing `identifier` is replaced by a fresh
   * `urn:uuid:` value, and `modified` defaults to construction time. The object
   * itself stays mutable, so metadata can be edited in place after construction.
   */
  readonly metadata: EpubProjectMetadata;
  /**
   * Chapters in spine order, each carrying the manifest id assigned at insert
   * time. Edit through {@link EpubProject.addChapter},
   * {@link EpubProject.updateChapter}, {@link EpubProject.removeChapter} and
   * {@link EpubProject.reorderChapters} so ids stay unique and inline image
   * assets stay in sync with the bodies that reference them.
   */
  readonly chapters: ProjectChapter[] = [];
  /**
   * Manifest assets in insertion order, with the resolved id, href and media
   * type rather than the values originally passed in. A cover set through
   * {@link EpubProject.setCover} is always the last entry.
   */
  readonly assets: EpubProjectAsset[] = [];
  /** Whether `export()` writes a generated title page ahead of the chapters. */
  readonly includeTitlePage: boolean;
  /**
   * Whether the first chapter opens with the book title as its `<h1>`, keeping
   * its own title only as a hidden `chapter-title` span.
   */
  readonly includeTitleInFirstChapter: boolean;
  /** Value of the spine's `page-progression-direction` attribute. */
  readonly pageProgressionDirection: 'rtl' | 'ltr' | 'default';
  /** Manuscript notation dialect chapter bodies are parsed with during export. */
  readonly dialect: ManuscriptDialect;
  /** CSS written to `OPS/Styles/style.css`. Replaceable at any point before export. */
  stylesheet: string;

  /**
   * Applies the {@link EpubProjectOptions} defaults, then registers `chapters`
   * and `cover` through {@link EpubProject.addChapter} and
   * {@link EpubProject.setCover} — so an invalid cover href throws here rather
   * than at export time.
   */
  constructor(options: EpubProjectOptions) {
    this.metadata = {
      language: 'ja',
      identifier: `urn:uuid:${crypto.randomUUID()}`,
      modified: new Date(),
      ...options.metadata,
    };
    if (!this.metadata.identifier?.trim()) {
      this.metadata.identifier = `urn:uuid:${crypto.randomUUID()}`;
    }
    this.includeTitlePage = options.includeTitlePage ?? true;
    this.includeTitleInFirstChapter = options.includeTitleInFirstChapter ?? false;
    this.pageProgressionDirection = options.pageProgressionDirection ?? 'rtl';
    this.dialect = options.dialect ?? 'mejiro';
    this.stylesheet = options.stylesheet ?? DEFAULT_STYLESHEET;
    for (const chapter of options.chapters ?? []) this.addChapter(chapter);
    if (options.cover) this.setCover(options.cover);
  }

  /**
   * Reads as a named constructor at call sites that build a book straight from
   * manuscript chapters. Equivalent to `new EpubProject(options)` in every
   * respect.
   */
  static fromManuscript(options: EpubProjectOptions): EpubProject {
    return new EpubProject(options);
  }

  /**
   * Appends a chapter to the end of the spine. Its id is sanitized to an
   * XML-safe manifest id and suffixed when it collides with a reserved id or one
   * already in use, so the stored id may differ from `chapter.id`.
   */
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
   * fields keep their previous value. Inline image assets the new body no
   * longer references are dropped from the project, exactly as
   * {@link EpubProject.removeChapter} drops them.
   */
  updateChapter(index: number, patch: Partial<Omit<ManuscriptChapterInput, 'id'>>): void {
    const chapter = this.chapters[index];
    if (!chapter) throw new Error(`Missing chapter: ${index}`);
    if (patch.title !== undefined) chapter.title = patch.title;
    if (patch.body === undefined) return;
    const previousAssetHrefs = markerAssetHrefs(chapter);
    chapter.body = patch.body;
    this.removeUnreferencedAssets(previousAssetHrefs);
  }

  /** Removes a chapter by index. */
  removeChapter(index: number): void {
    if (index < 0 || index >= this.chapters.length) throw new Error(`Missing chapter: ${index}`);
    const removedAssetHrefs = markerAssetHrefs(this.chapters[index]);
    this.chapters.splice(index, 1);
    this.removeUnreferencedAssets(removedAssetHrefs);
  }

  /**
   * Moves a chapter from `from` to `to`. An out-of-range `from` selects no
   * chapter and leaves the list untouched; `to` is clamped to the chapter list
   * bounds. Drag-and-drop reorder UIs routinely emit both, so neither is an
   * error.
   */
  reorderChapters(from: number, to: number): void {
    if (from < 0 || from >= this.chapters.length) return;
    const [chapter] = this.chapters.splice(from, 1);
    const target = Math.max(0, Math.min(this.chapters.length, to));
    this.chapters.splice(target, 0, chapter);
  }

  /**
   * Inserts an inline image asset and embeds an internal manuscript reference
   * in the chapter body at `atParagraphIndex`, counted in the same paragraph
   * space the chapter XHTML pass and `manuscriptToEpubBook()` use. The marker is
   * rendered as a `<figure>` during the chapter XHTML pass.
   */
  addInlineImage(
    chapterIndex: number,
    atParagraphIndex: number,
    asset: EpubProjectAsset & { alt?: string },
  ): void {
    const chapter = this.chapters[chapterIndex];
    if (!chapter) throw new Error(`Missing chapter: ${chapterIndex}`);
    const storedAsset = this.addAsset(asset);

    chapter.body = insertManuscriptParagraph(
      chapter.body,
      atParagraphIndex,
      manuscriptImageBlock({ ...asset, href: storedAsset.href }),
    );
  }

  /**
   * Registers `asset` as the cover image, replacing any previous one. The href
   * defaults to `'OPS/Images/cover.jpg'` when empty and is validated like every
   * other asset href, so an absolute path or one escaping the archive throws.
   * The stored asset is marked `properties: 'cover-image'` and moved to the end
   * of {@link EpubProject.assets}, which is what makes `export()` emit the cover
   * `<meta>` entry for it.
   */
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

  /**
   * Adds a manifest asset and returns the stored copy, which carries the
   * resolved id, href and media type. The href is renamed with a `-2`, `-3`, …
   * suffix when it collides with an existing asset or with a document
   * `export()` generates, so link the returned `href` rather than the one passed
   * in.
   *
   * @throws If `asset.href` is not a clean relative path inside the archive.
   */
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

  private removeUnreferencedAssets(candidates: ReadonlySet<string>): void {
    if (candidates.size === 0) return;
    const referencedHrefs = new Set<string>();
    for (const chapter of this.chapters) {
      for (const href of markerAssetHrefs(chapter)) referencedHrefs.add(href);
    }
    for (let i = this.assets.length - 1; i >= 0; i--) {
      const asset = this.assets[i];
      if (
        asset.properties === 'cover-image' ||
        !candidates.has(asset.href) ||
        referencedHrefs.has(asset.href)
      )
        continue;
      this.assets.splice(i, 1);
    }
  }

  /**
   * Serializes the project into an EPUB 3 ZIP: `mimetype` first and
   * uncompressed, then the container, the OPF package, the nav document, the
   * stylesheet, the optional title page, one XHTML document per chapter, and
   * finally every asset.
   *
   * Asset bytes are taken from {@link EpubProjectAsset.data}, or fetched from
   * {@link EpubProjectAsset.url} through `options.assetResolver` (the runtime
   * `fetch` when no resolver is given). `options.signal` is checked between
   * chapters and assets as well as during compression, and `options.onProgress`
   * reports the `'serialize'` phase per chapter and the `'zip'` phase from JSZip.
   *
   * @throws If the project has no chapters, if an asset cannot be resolved, or
   *   with an `AbortError` when `options.signal` is triggered.
   */
  async export(options: EpubExportOptions = {}): Promise<ArrayBuffer> {
    const { onProgress, signal, assetResolver } = options;
    throwIfAborted(signal);
    if (this.chapters.length === 0) {
      throw new Error('Cannot export an EPUB project without at least one chapter');
    }

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
      const bytes = await resolveAssetData(asset.href, asset, assetResolver, signal);
      zip.file(asset.href, bytes);
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
      return `<p>${serializeManuscriptParagraph(paragraph, project.dialect)}</p>`;
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

function serializeManuscriptParagraph(text: string, dialect: ManuscriptDialect): string {
  const parsed = parseManuscript(text, { dialect });
  return buildInlineNodes([...parsed.text], parsed.inlineAnnotations)
    .map(renderInlineNode)
    .join('');
}

function renderInlineNode(node: InlineNode): string {
  switch (node.type) {
    case 'text':
      return escapeTextWithBreaks(node.text);
    case 'ruby':
      return `<ruby>${renderInlineChildren(node)}<rt>${escapeText(node.rubyText)}</rt></ruby>`;
    case 'emphasis':
      return `<em class="mejiro-emphasis" data-style="${escapeAttribute(
        node.style,
      )}">${renderInlineChildren(node)}</em>`;
    case 'tcy':
      return `<span class="mejiro-tcy">${renderInlineChildren(node)}</span>`;
    case 'em':
      return `<em>${renderInlineChildren(node)}</em>`;
    case 'strong':
      return `<strong>${renderInlineChildren(node)}</strong>`;
    case 'link':
      return `<a href="${escapeAttribute(node.href)}"${
        node.title ? ` title="${escapeAttribute(node.title)}"` : ''
      }>${renderInlineChildren(node)}</a>`;
    case 'footnote-ref':
      return `<a class="mejiro-footnote-ref" href="#${escapeAttribute(
        node.noteId,
      )}">${renderInlineChildren(node)}</a>`;
  }
}

function renderInlineChildren(node: Exclude<InlineNode, { type: 'text' }>): string {
  return node.children.length > 0
    ? node.children.map(renderInlineNode).join('')
    : escapeTextWithBreaks(node.type === 'ruby' ? node.base : node.text);
}

/** Builds the manuscript marker for an inline image inserted via `addInlineImage`. */
function manuscriptImageBlock(asset: EpubProjectAsset & { alt?: string }): string {
  const src = relativeZipPath('OPS/Text/', asset.href);
  const altPart = asset.alt ? `|${encodeURIComponent(asset.alt)}` : '';
  return `[[mejiro-image:${encodeURIComponent(src)}${altPart}]]`;
}

function resolveMarkerHref(src: string): string {
  const parts = `OPS/Text/${src}`.split('/');
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') normalized.pop();
    else normalized.push(part);
  }
  return normalized.join('/');
}

function markerAssetHrefs(chapter: ProjectChapter): Set<string> {
  const hrefs = new Set<string>();
  for (const paragraph of manuscriptParagraphs(chapter.body)) {
    const marker = parseInlineImageMarker(paragraph);
    if (marker) hrefs.add(resolveMarkerHref(marker.src));
  }
  return hrefs;
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
  <spine page-progression-direction="${escapeAttribute(project.pageProgressionDirection)}">
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
  const taken = (candidate: string): boolean =>
    used.has(candidate) || isReservedPackagePath(candidate);
  if (!taken(href)) return href;
  let index = 2;
  const slashIndex = href.lastIndexOf('/');
  const dir = slashIndex >= 0 ? href.slice(0, slashIndex + 1) : '';
  const filename = slashIndex >= 0 ? href.slice(slashIndex + 1) : href;
  const extIndex = filename.lastIndexOf('.');
  const stem = extIndex > 0 ? filename.slice(0, extIndex) : filename;
  const ext = extIndex > 0 ? filename.slice(extIndex) : '';
  let candidate = `${dir}${stem}-${index}${ext}`;
  while (taken(candidate)) {
    index++;
    candidate = `${dir}${stem}-${index}${ext}`;
  }
  return candidate;
}

const RESERVED_PACKAGE_IDS = ['nav', 'style', 'title-page', 'pub-id', 'title', 'subtitle'];

/** ZIP paths `export()` writes itself, whatever the project contains. */
const RESERVED_PACKAGE_PATHS = [
  'mimetype',
  'META-INF/container.xml',
  'OPS/package.opf',
  'OPS/nav.xhtml',
  'OPS/Styles/style.css',
  'OPS/Text/titlepage.xhtml',
];

/** Chapter documents are named from the chapter index, so the whole shape is reserved. */
const RESERVED_CHAPTER_PATH = /^OPS\/Text\/chapter-\d{3,}\.xhtml$/u;

/**
 * Reports whether a ZIP path belongs to a file `export()` generates. Assets are
 * moved off such a path so a generated document is never overwritten and the
 * OPF manifest never lists the same href twice.
 */
function isReservedPackagePath(href: string): boolean {
  return RESERVED_PACKAGE_PATHS.includes(href) || RESERVED_CHAPTER_PATH.test(href);
}

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

/**
 * Characters XML 1.0 forbids in document content: the C0 controls other than
 * tab / line feed / carriage return, lone surrogates, and the two BMP
 * non-characters. They cannot be expressed as character references either, so
 * the only way to keep a well-formed document is to drop them.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the characters XML forbids is the point
const XML_ILLEGAL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu;

function escapeText(text: string): string {
  return text
    .replace(XML_ILLEGAL_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(text: string): string {
  // Attribute-value normalization would otherwise turn these into plain spaces.
  return escapeText(text)
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');
}
