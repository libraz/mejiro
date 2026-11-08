import JSZip from 'jszip';
import { MejiroError } from '../errors.js';
import {
  type ManuscriptDialect,
  type ParseManuscriptOptions,
  parseManuscript,
} from '../manuscript.js';
import { mergeDefined } from '../merge.js';
import type { BinaryInput, ManuscriptChapter } from '../types.js';
import {
  CHAPTER_TITLE_ID,
  chapterTitleCarrierMarkup,
  escapeAttribute,
  escapeText,
  figureMarkup,
  inlineContentMarkup,
} from './chapter-markup.js';
import { type EpubExportOptions, generateZip, resolveAssetData } from './editor.js';
import { throwIfAborted } from './limits.js';
import {
  insertManuscriptParagraph,
  manuscriptParagraphs,
  parseInlineImageMarker,
} from './manuscript-source.js';
import {
  mediaTypeFromPath,
  relativeZipPath,
  uniqueManifestId,
  zipPathToHref,
} from './package-paths.js';

export type { ManuscriptDialect, ParseManuscriptOptions };
export { parseManuscript };

/**
 * EPUB 3 package metadata. Most fields map directly onto `<dc:*>` and
 * `<meta>` entries in `package.opf`. Authors are listed in `creators`.
 */
export interface EpubProjectMetadata {
  /** Book title. Required. */
  title: string;
  /** Optional subtitle (`<dc:title id="subtitle">`). */
  subtitle?: string;
  /** Long-form description (`<dc:description>`). */
  description?: string;
  /** BCP-47 language tag. @defaultValue 'ja' */
  language?: string;
  /** Unique identifier (`<dc:identifier>`). Auto-generated UUID if omitted or blank. */
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
  creators?: readonly EpubContributor[];
  /** Additional contributors (`<dc:contributor>`). */
  contributors?: readonly EpubContributor[];
  /** Subject keywords / tags / genres (`<dc:subject>`). */
  subjects?: readonly string[];
  /** EPUB 3 collection metadata (`<meta property="belongs-to-collection">`). */
  collections?: readonly EpubCollection[];
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

/**
 * A binary file packaged alongside the chapters — an extra stylesheet, an
 * inline image, the cover. Carries its bytes in `data` or names a `url` to
 * fetch them from at export time, never both.
 *
 * The copy {@link EpubProject.addAsset} returns and {@link EpubProject.assets}
 * lists has `id`, `href` and `mediaType` resolved.
 */
export type EpubProjectAsset =
  | {
      /**
       * Preferred manifest item id. Sanitized and de-duplicated like the id of
       * {@link EpubProject.addChapter}; defaults to an id derived from `href`.
       */
      id?: string;
      /**
       * Destination path inside the EPUB ZIP, relative to the archive root
       * (e.g. `'OPS/Images/figure.png'`). Must be a clean relative file path:
       * {@link EpubProject.addAsset} throws a `TypeError` on an absolute path, a
       * URI scheme, a `..` segment, a `#`/`?`/`\` character or a trailing slash.
       * A path that collides with another asset or with a document `export()`
       * generates is renamed, so read the stored href back from the value
       * `addAsset()` returns rather than assuming this one was kept.
       */
      href: string;
      /**
       * OPF media type. Inferred from the `href` extension when omitted, falling
       * back to `application/octet-stream` for unknown extensions.
       */
      mediaType?: string;
      /**
       * OPF manifest `properties` attribute. The cover set through
       * {@link EpubProject.setCover} carries `'cover-image'`, which also marks
       * it as the asset the cover `<meta>` entry points at and exempts it from
       * unreferenced-asset cleanup.
       */
      properties?: string;
      /**
       * Binary asset data. A `Uint8Array` is read through its own view, and the
       * project keeps a copy, so later changes to the input do not reach it.
       */
      data: BinaryInput;
      /** Never set on this variant — it is what makes the union discriminate. */
      url?: never;
    }
  | {
      /** Preferred manifest item id. See the `data` variant. */
      id?: string;
      /** Destination path inside the EPUB ZIP. See the `data` variant. */
      href: string;
      /** OPF media type. See the `data` variant. */
      mediaType?: string;
      /** OPF manifest `properties` attribute. See the `data` variant. */
      properties?: string;
      /** Never set on this variant — it is what makes the union discriminate. */
      data?: never;
      /**
       * External URL fetched at export time via the
       * {@link EpubExportOptions.assetResolver} (or the runtime `fetch` when no
       * resolver is supplied).
       */
      url: string;
    };

/**
 * Cover image accepted by {@link EpubProject.setCover} and
 * {@link EpubProjectOptions.cover}. Carries its bytes in `data` or names a
 * `url` to fetch them from at export time, never both. The class decides the
 * stored path, `OPS/Images/<filename>`.
 */
export type CoverInput =
  | {
      /** Image bytes. A `Uint8Array` is read through its own view and copied. */
      data: BinaryInput;
      /** Never set on this variant — it is what makes the union discriminate. */
      url?: never;
      /** OPF media type of the image (e.g. `'image/jpeg'`). */
      mediaType: string;
      /**
       * File name inside `OPS/Images/`, without a directory. Renamed with a
       * `-2`, `-3`, … suffix when taken. @defaultValue 'cover.jpg'
       */
      filename?: string;
    }
  | {
      /** Never set on this variant — it is what makes the union discriminate. */
      data?: never;
      /**
       * External URL fetched at export time via the
       * {@link EpubExportOptions.assetResolver} (or the runtime `fetch`).
       */
      url: string;
      /** OPF media type of the image (e.g. `'image/jpeg'`). */
      mediaType: string;
      /** File name inside `OPS/Images/`. See the `data` variant. @defaultValue 'cover.jpg' */
      filename?: string;
    };

/**
 * Inline image accepted by {@link EpubProject.addImage}. Carries its bytes in
 * `data` or names a `url` to fetch them from at export time, never both. The
 * class decides the stored path, `OPS/Images/<filename>`.
 */
export type EpubProjectImageInput =
  | {
      /**
       * File name inside `OPS/Images/`, without a directory. Renamed with a
       * `-2`, `-3`, … suffix when taken.
       */
      filename: string;
      /** Image bytes. A `Uint8Array` is read through its own view and copied. */
      data: BinaryInput;
      /** Never set on this variant — it is what makes the union discriminate. */
      url?: never;
      /** OPF media type. Inferred from the `filename` extension when omitted. */
      mediaType?: string;
      /** Alternative text of the generated `<img>`. */
      alt?: string;
      /**
       * Paragraph position the image is inserted at, counted in the paragraph
       * space of the chapter body (blank-line separated blocks, images
       * included). Values past the end append.
       */
      atParagraphIndex: number;
    }
  | {
      /** File name inside `OPS/Images/`. See the `data` variant. */
      filename: string;
      /** Never set on this variant — it is what makes the union discriminate. */
      data?: never;
      /**
       * External URL fetched at export time via the
       * {@link EpubExportOptions.assetResolver} (or the runtime `fetch`).
       */
      url: string;
      /** OPF media type. Inferred from the `filename` extension when omitted. */
      mediaType?: string;
      /** Alternative text of the generated `<img>`. */
      alt?: string;
      /** Paragraph position the image is inserted at. See the `data` variant. */
      atParagraphIndex: number;
    };

/** Constructor options for {@link EpubProject}. */
export interface EpubProjectOptions {
  /** Package metadata. Only `title` is required; the rest is defaulted at export. */
  metadata: EpubProjectMetadata;
  /**
   * Initial chapters, appended in order through {@link EpubProject.addChapter}
   * — so their ids go through the same sanitizing and de-duplication.
   */
  chapters?: readonly ManuscriptChapter[];
  /** Manuscript notation dialect used when serializing chapters. @defaultValue `'mejiro'` */
  dialect?: ManuscriptDialect;
  /** Cover image, registered through {@link EpubProject.setCover} after `chapters`. */
  cover?: CoverInput;
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
 * {@link ManuscriptChapter}, with the manifest id already assigned and
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

/**
 * A `urn:uuid:` package identifier. Falls back to a `Math.random` v4 UUID where
 * `crypto.randomUUID` is missing (insecure origins, older runtimes).
 */
function packageIdentifier(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `urn:uuid:${globalThis.crypto.randomUUID()}`;
  }
  const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const digit = Math.floor(Math.random() * 16);
    return (ch === 'x' ? digit : (digit & 0x3) | 0x8).toString(16);
  });
  return `urn:uuid:${uuid}`;
}

/** Directory of the ZIP that images and the cover are stored in. */
const IMAGE_DIRECTORY = 'OPS/Images/';

/** File name a cover without `filename` is stored under. */
const DEFAULT_COVER_FILENAME = 'cover.jpg';

/** Builds a new EPUB package from manuscript chapters and assets. */
export class EpubProject {
  private currentMetadata: EpubProjectMetadata;
  private currentStylesheet: string;
  private readonly chapterList: ProjectChapter[] = [];
  private readonly assetList: EpubProjectAsset[] = [];

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

  /**
   * Applies the {@link EpubProjectOptions} defaults, then registers `chapters`
   * and `cover` through {@link EpubProject.addChapter} and
   * {@link EpubProject.setCover} — so an invalid cover filename throws here
   * rather than at export time.
   *
   * @throws {TypeError} When `cover` is not a valid {@link CoverInput}.
   */
  constructor(options: EpubProjectOptions) {
    this.currentMetadata = mergeDefined<EpubProjectMetadata>(
      {
        title: options.metadata.title,
        language: 'ja',
        identifier: packageIdentifier(),
        modified: new Date(),
      },
      options.metadata,
    );
    if (!this.currentMetadata.identifier?.trim()) {
      this.currentMetadata.identifier = packageIdentifier();
    }
    this.includeTitlePage = options.includeTitlePage ?? true;
    this.includeTitleInFirstChapter = options.includeTitleInFirstChapter ?? false;
    this.pageProgressionDirection = options.pageProgressionDirection ?? 'rtl';
    this.dialect = options.dialect ?? 'mejiro';
    this.currentStylesheet = options.stylesheet ?? DEFAULT_STYLESHEET;
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
   * Package metadata with the defaults already applied: `language` falls back to
   * `'ja'`, a blank or missing `identifier` is replaced by a fresh
   * `urn:uuid:` value, and `modified` defaults to construction time. Each
   * {@link EpubProject.updateMetadata} call replaces the object, so a reference
   * read earlier keeps the values it had.
   */
  get metadata(): Readonly<EpubProjectMetadata> {
    return this.currentMetadata;
  }

  /**
   * Chapters in spine order, each carrying the manifest id assigned at insert
   * time. Edit through {@link EpubProject.addChapter},
   * {@link EpubProject.updateChapter}, {@link EpubProject.removeChapter} and
   * {@link EpubProject.reorderChapters} so ids stay unique and inline image
   * assets stay in sync with the bodies that reference them.
   */
  get chapters(): readonly Readonly<ProjectChapter>[] {
    return this.chapterList;
  }

  /**
   * Manifest assets in insertion order, with the resolved id, href and media
   * type rather than the values originally passed in. A cover set through
   * {@link EpubProject.setCover} is always the last entry.
   */
  get assets(): readonly Readonly<EpubProjectAsset>[] {
    return this.assetList;
  }

  /** CSS written to `OPS/Styles/style.css`. Replace it with {@link EpubProject.setStylesheet}. */
  get stylesheet(): string {
    return this.currentStylesheet;
  }

  /**
   * Merges `patch` into the package metadata. Fields left out or set to
   * `undefined` keep their value, and a blank `identifier` is replaced by a
   * fresh `urn:uuid:` value as in the constructor.
   */
  updateMetadata(patch: Partial<EpubProjectMetadata>): void {
    const next = mergeDefined(this.currentMetadata, patch);
    if (!next.identifier?.trim()) next.identifier = packageIdentifier();
    this.currentMetadata = next;
  }

  /**
   * Replaces the stylesheet written to `OPS/Styles/style.css`.
   *
   * @throws {TypeError} When `css` is not a string.
   */
  setStylesheet(css: string): void {
    if (typeof css !== 'string') throw new TypeError('Stylesheet must be a string');
    this.currentStylesheet = css;
  }

  /**
   * Appends a chapter to the end of the spine and returns it as stored. Its id
   * is sanitized to an XML-safe manifest id and suffixed when it collides with a
   * reserved id or one already in use, so the stored id may differ from
   * `chapter.id`.
   */
  addChapter(chapter: ManuscriptChapter): Readonly<ProjectChapter> {
    const stored: ProjectChapter = {
      id: uniqueManifestId(
        toManifestId(
          chapter.id ?? `chapter-${this.chapterList.length + 1}`,
          `chapter-${this.chapterList.length + 1}`,
        ),
        projectManifestIds(this),
      ),
      title: chapter.title,
      body: chapter.body,
    };
    this.chapterList.push(stored);
    return stored;
  }

  /**
   * Updates a chapter's title and/or body. Pass a partial patch — omitted
   * fields keep their previous value. Inline image assets the new body no
   * longer references are dropped from the project, exactly as
   * {@link EpubProject.removeChapter} drops them.
   *
   * @throws {RangeError} When `index` names no chapter.
   */
  updateChapter(index: number, patch: Partial<Omit<ManuscriptChapter, 'id'>>): void {
    const chapter = this.requireChapter(index);
    if (patch.title !== undefined) chapter.title = patch.title;
    if (patch.body === undefined) return;
    const previousAssetHrefs = markerAssetHrefs(chapter);
    chapter.body = patch.body;
    this.removeUnreferencedAssets(previousAssetHrefs);
  }

  /**
   * Removes a chapter by index, together with the inline image assets only it
   * referenced.
   *
   * @throws {RangeError} When `index` names no chapter.
   */
  removeChapter(index: number): void {
    const removedAssetHrefs = markerAssetHrefs(this.requireChapter(index));
    this.chapterList.splice(index, 1);
    this.removeUnreferencedAssets(removedAssetHrefs);
  }

  /**
   * Moves a chapter from `from` to `to`. An out-of-range `from` selects no
   * chapter and leaves the list untouched; `to` is clamped to the chapter list
   * bounds. Drag-and-drop reorder UIs routinely emit both, so neither is an
   * error.
   */
  reorderChapters(from: number, to: number): void {
    if (from < 0 || from >= this.chapterList.length) return;
    const [chapter] = this.chapterList.splice(from, 1);
    const target = Math.max(0, Math.min(this.chapterList.length, to));
    this.chapterList.splice(target, 0, chapter);
  }

  /**
   * Stores an image under `OPS/Images/<filename>` and embeds a reference to it
   * in the chapter body at `atParagraphIndex`, counted in the same paragraph
   * space the chapter XHTML pass and `manuscriptToEpubBook()` use. The
   * reference is rendered as a `<figure>` during the chapter XHTML pass.
   *
   * @returns The stored asset. Its `href` is the one linked from the chapter;
   *   it carries a `-2`, `-3`, … suffix when `filename` was taken.
   * @throws {RangeError} When `chapterIndex` names no chapter, or
   *   `atParagraphIndex` is not an integer.
   * @throws {TypeError} When `filename` is not a plain file name, or the image
   *   carries neither valid `data` nor a `url`.
   */
  addImage(chapterIndex: number, image: EpubProjectImageInput): Readonly<EpubProjectAsset> {
    const chapter = this.requireChapter(chapterIndex);
    if (!Number.isInteger(image.atParagraphIndex)) {
      throw new RangeError('Image atParagraphIndex must be an integer');
    }
    const stored = this.addAsset({
      href: imageHref(image.filename),
      ...(image.mediaType !== undefined ? { mediaType: image.mediaType } : {}),
      ...(image.data !== undefined ? { data: image.data } : { url: image.url as string }),
    });
    chapter.body = insertManuscriptParagraph(
      chapter.body,
      image.atParagraphIndex,
      manuscriptImageBlock(stored.href, image.alt),
    );
    return stored;
  }

  /**
   * Registers `cover` as the cover image, replacing any previous one, and
   * returns it as stored. It is written to `OPS/Images/<filename>` and carries
   * `properties: 'cover-image'`; it moves to the end of
   * {@link EpubProject.assets}, which is what makes `export()` emit the cover
   * `<meta>` entry for it.
   *
   * @throws {TypeError} When `filename` is not a plain file name, or `cover`
   *   carries neither valid `data` nor a `url`.
   */
  setCover(cover: CoverInput): Readonly<EpubProjectAsset> {
    const nonCoverAssets = this.assetList.filter(
      (existing) => existing.properties !== 'cover-image',
    );
    const stored = this.buildAsset(
      {
        href: imageHref(cover.filename ?? DEFAULT_COVER_FILENAME),
        mediaType: cover.mediaType,
        properties: 'cover-image',
        data: cover.data,
        url: cover.url,
      },
      nonCoverAssets,
      'cover-image',
    );
    this.assetList.splice(0, this.assetList.length, ...nonCoverAssets, stored);
    return stored;
  }

  /**
   * Adds a manifest asset and returns the stored copy, which carries the
   * resolved id, href and media type. The href is renamed with a `-2`, `-3`, …
   * suffix when it collides with an existing asset or with a document
   * `export()` generates, so link the returned `href` rather than the one passed
   * in.
   *
   * @throws {TypeError} When `asset.href` is not a clean relative path inside
   *   the archive, or the asset carries neither valid `data` nor a `url`.
   */
  addAsset(asset: EpubProjectAsset): Readonly<EpubProjectAsset> {
    const stored = this.buildAsset(asset, this.assetList);
    this.assetList.push(stored);
    return stored;
  }

  /**
   * Validates `asset` and resolves its stored form against `others`, the assets
   * it must not collide with.
   */
  private buildAsset(
    asset: AssetDraft,
    others: readonly EpubProjectAsset[],
    defaultId?: string,
  ): EpubProjectAsset {
    assertProjectAssetHref(asset.href);
    const source = copyAssetSource(asset);
    return {
      ...(asset.properties !== undefined ? { properties: asset.properties } : {}),
      ...source,
      id: uniqueManifestId(
        toManifestId(asset.id ?? defaultId ?? manifestIdFromHref(asset.href)),
        projectManifestIds(this, others),
      ),
      href: uniqueAssetHref(
        asset.href,
        others.map((existing) => existing.href),
      ),
      mediaType: asset.mediaType ?? mediaTypeFromPath(asset.href),
    };
  }

  private requireChapter(index: number): ProjectChapter {
    const chapter = this.chapterList[index];
    if (!chapter) throw new RangeError(`Missing chapter: ${index}`);
    return chapter;
  }

  private removeUnreferencedAssets(candidates: ReadonlySet<string>): void {
    if (candidates.size === 0) return;
    const referencedHrefs = new Set<string>();
    for (const chapter of this.chapterList) {
      for (const href of markerAssetHrefs(chapter)) referencedHrefs.add(href);
    }
    for (let i = this.assetList.length - 1; i >= 0; i--) {
      const asset = this.assetList[i];
      if (
        asset.properties === 'cover-image' ||
        !candidates.has(asset.href) ||
        referencedHrefs.has(asset.href)
      )
        continue;
      this.assetList.splice(i, 1);
    }
  }

  /**
   * Serializes the project into an EPUB 3 ZIP: `mimetype` first and
   * uncompressed, then the container, the OPF package, the nav document, the
   * stylesheet, the optional title page, one XHTML document per chapter, and
   * finally every asset.
   *
   * Asset bytes are taken from the asset's `data`, or fetched from its `url`
   * through `options.assetResolver` (the runtime `fetch` when no resolver is
   * given). `options.signal` is checked between chapters and assets as well as
   * during compression, and `options.onProgress` reports the `'serialize'`
   * phase per chapter and the `'zip'` phase from JSZip.
   *
   * @returns The EPUB file contents.
   * @throws {MejiroError} `epub-invalid-package` when the project has no
   *   chapters, `asset-fetch-failed` when the default fetch of an asset fails.
   * @throws {TypeError} When `options.signal` is not an `AbortSignal`, or an
   *   asset resolver returns something other than bytes.
   * @throws The `signal.reason` when `options.signal` aborts.
   */
  async export(options: EpubExportOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
    const { onProgress, signal, assetResolver } = options;
    throwIfAborted(signal);
    if (this.chapterList.length === 0) {
      throw new MejiroError(
        'epub-invalid-package',
        'Cannot export an EPUB project without at least one chapter',
      );
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
    zip.file('OPS/Styles/style.css', this.currentStylesheet);
    if (this.includeTitlePage) {
      zip.file('OPS/Text/titlepage.xhtml', titlePageXhtml(this));
    }
    const totalChapters = this.chapterList.length;
    this.chapterList.forEach((chapter, index) => {
      throwIfAborted(signal);
      zip.file(`OPS/Text/${chapterFileName(index)}`, chapterXhtml(this, chapter, index));
      onProgress?.('serialize', (index + 1) / totalChapters);
    });
    for (const asset of this.assetList) {
      throwIfAborted(signal);
      const bytes = await resolveAssetData(asset.href, asset, assetResolver, signal);
      zip.file(asset.href, bytes);
    }

    return generateZip(zip, onProgress, signal);
  }
}

/** The fields {@link EpubProject} validates before it stores an asset. */
interface AssetDraft {
  id?: string;
  href: string;
  mediaType?: string;
  properties?: string;
  data?: unknown;
  url?: unknown;
}

/** The bytes or URL of a stored asset. */
type AssetSource = { data: Uint8Array; url?: never } | { url: string; data?: never };

/**
 * Takes the source of `asset` for storage. Bytes are copied through the range
 * of their view; `data` wins when both are present.
 */
function copyAssetSource(asset: AssetDraft): AssetSource {
  if (asset.data !== undefined) {
    const tag = Object.prototype.toString.call(asset.data);
    if (tag === '[object Uint8Array]') return { data: (asset.data as Uint8Array).slice() };
    if (tag === '[object ArrayBuffer]')
      return { data: new Uint8Array(asset.data as ArrayBuffer).slice() };
    throw new TypeError('Asset data must be an ArrayBuffer or a Uint8Array');
  }
  if (typeof asset.url !== 'string') {
    throw new TypeError('Asset must include either `data` or `url`');
  }
  return { url: asset.url };
}

/**
 * The ZIP path an image or cover named `filename` is stored under.
 *
 * @throws {TypeError} When `filename` is not a plain file name.
 */
function imageHref(filename: string): string {
  if (typeof filename !== 'string' || /[\\/]|^\.{0,2}$/u.test(filename)) {
    throw new TypeError('Image filename must be a plain file name without a directory');
  }
  return `${IMAGE_DIRECTORY}${filename}`;
}

/**
 * Validates an asset href as the unencoded ZIP path the exporter writes it to;
 * manifest hrefs and `src` attributes are percent-encoded from it on output.
 */
function assertProjectAssetHref(href: string): void {
  if (typeof href !== 'string' || !href || href.endsWith('/')) {
    throw new TypeError('Asset href must point to a file');
  }
  if (href.includes('\\') || href.includes('#') || href.includes('?')) {
    throw new TypeError(`Asset href must be a clean EPUB file path: ${href}`);
  }
  if (href.startsWith('/') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(href)) {
    throw new TypeError(`Asset href must be a relative EPUB path: ${href}`);
  }
  if (href.split('/').some((part) => part === '..')) {
    throw new TypeError(`Asset href must not contain parent directory segments: ${href}`);
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
    ${chapterTitleCarrierMarkup(chapterTitle)}`;
}

function serializeManuscriptParagraph(text: string, dialect: ManuscriptDialect): string {
  const parsed = parseManuscript(text, { dialect });
  return inlineContentMarkup(parsed.text, parsed.inlineAnnotations);
}

/** Builds the manuscript marker for an inline image inserted via `addImage`. */
function manuscriptImageBlock(href: string, alt: string | undefined): string {
  const relative = relativeZipPath('OPS/Text/', href);
  // A bare filename reads back as `../Images/<name>`, so a same-directory asset
  // keeps an explicit `./` to resolve to itself.
  const src = relative.includes('/') ? relative : `./${relative}`;
  const altPart = alt ? `|${encodeURIComponent(alt)}` : '';
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
  return figureMarkup({ src: zipPathToHref(image.src), alt: image.alt });
}

function packageOpf(project: EpubProject): string {
  const metadata = project.metadata;
  const modified = (metadata.modified ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const coverMeta = project.assets.find((asset) => asset.properties === 'cover-image');
  const assetItems = project.assets
    .map(
      (asset) =>
        `<item id="${escapeAttribute(asset.id ?? manifestIdFromHref(asset.href))}" href="${escapeAttribute(
          zipPathToHref(relativeZipPath('OPS/', asset.href)),
        )}" media-type="${escapeAttribute(asset.mediaType ?? mediaTypeFromPath(asset.href))}"${
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

  const metadataLines = buildMetadataLines(
    metadata,
    modified,
    coverMeta?.id,
    allocateMetadataIds(metadata, projectManifestIds(project, project.assets, false)),
  );

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
  ids: MetadataIds,
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
    const id = ids.creators[index];
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
    const id = ids.contributors[index];
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
    const id = ids.collections[index];
    push(`<meta property="belongs-to-collection" id="${id}">${escapeText(collection.name)}</meta>`);
    push(
      `<meta refines="#${id}" property="collection-type">${escapeText(collection.type ?? 'series')}</meta>`,
    );
    if (collection.index !== undefined) {
      push(`<meta refines="#${id}" property="group-position">${collection.index}</meta>`);
    }
  });

  push(`<meta property="dcterms:modified">${modified}</meta>`);
  if (coverImageId) {
    push(`<meta name="cover" content="${escapeAttribute(coverImageId)}" />`);
  }

  return lines.join('\n');
}

function normalizeCreators(metadata: EpubProjectMetadata): readonly EpubContributor[] {
  return metadata.creators ?? [];
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

/** Ids `export()` writes itself, in the OPF or in every chapter document. */
const RESERVED_PACKAGE_IDS = [
  'nav',
  'style',
  'title-page',
  'pub-id',
  'title',
  'subtitle',
  CHAPTER_TITLE_ID,
];

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

/**
 * Every id the exported package already holds. With `withMetadata`, the
 * metadata entry ids as they would be generated with no collision are included
 * too, so a chapter or asset added after the metadata steers clear of them.
 */
function projectManifestIds(
  project: EpubProject,
  assets: readonly EpubProjectAsset[] = project.assets,
  withMetadata = true,
): (string | undefined)[] {
  const metadataIds = withMetadata ? allocateMetadataIds(project.metadata, []) : undefined;
  return [
    ...RESERVED_PACKAGE_IDS,
    ...(metadataIds
      ? [...metadataIds.creators, ...metadataIds.contributors, ...metadataIds.collections]
      : []),
    ...project.chapters.map((chapter) => chapter.id),
    ...assets.map((asset) => asset.id ?? manifestIdFromHref(asset.href)),
  ];
}

/** Ids of the generated `<dc:creator>`, `<dc:contributor>` and collection entries. */
interface MetadataIds {
  creators: string[];
  contributors: string[];
  collections: string[];
}

/**
 * Allocates the metadata entry ids against `taken`, so they stay unique however
 * metadata, chapters and assets were set or reordered.
 */
function allocateMetadataIds(
  metadata: EpubProjectMetadata,
  taken: readonly (string | undefined)[],
): MetadataIds {
  const used = [...taken];
  const allocate = (base: string): string => {
    const id = uniqueManifestId(base, used);
    used.push(id);
    return id;
  };
  return {
    creators: normalizeCreators(metadata).map((_, index) => allocate(`creator-${index + 1}`)),
    contributors: (metadata.contributors ?? []).map((_, index) =>
      allocate(`contributor-${index + 1}`),
    ),
    collections: (metadata.collections ?? []).map((_, index) =>
      allocate(`collection-${index + 1}`),
    ),
  };
}

function toManifestId(value: string, fallback = 'asset'): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  const base = sanitized || fallback;
  return /^[a-zA-Z_]/.test(base) ? base : `id-${base}`;
}
