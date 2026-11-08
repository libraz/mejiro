# Migrating to 0.11

0.11 reshapes the public API of `@libraz/mejiro`, `@libraz/mejiro-react` and `@libraz/mejiro-vue` in one release, so that names, argument shapes and errors follow the same rules on every entry point ([API Conventions](02-core-concepts.md#6-api-conventions)). There are no compatibility aliases: code written for 0.10 fails to type-check where it uses a changed name, which is what this page is ordered by. Install the three packages at the same version.

The tables give each change as a 0.10 → 0.11 pair. [Behaviour changes](#behaviour-changes) lists what keeps its name but acts differently, and [Persisted formats](#persisted-formats) covers stored reading positions, annotations and layout snapshots.

## Errors, on every entry point

| 0.10 | 0.11 |
|---|---|
| `catch (e) { if (e.message.startsWith('Not a valid EPUB')) … }` | `catch (e) { if (e instanceof MejiroError && e.code === 'epub-invalid-archive') … }` |
| A failure thrown as `Error` (or `ReferenceError` for a missing DOM) | `MejiroError` with a `code` from `MejiroErrorCode`; argument errors are `TypeError` / `RangeError` |
| React / Vue hooks normalized errors to a new `Error` | The `MejiroError` arrives as thrown, `cause` included |
| `warnings: string[]` | `warnings: readonly MejiroWarning[]` (`{ code, message }`) |

`MejiroError` and its types are exported from every subpath and both framework packages. The codes are listed in [API Conventions](02-core-concepts.md#6-api-conventions); give a `switch` over them a `default` branch, because the union grows in minor releases.

## `@libraz/mejiro`

| 0.10 | 0.11 |
|---|---|
| `computeBreaks({ …, mode: 'loose' })` | `computeBreaks({ …, kinsoku: 'loose' })` |
| `computeBreaks({ …, kinsokuRules: rules })` | `computeBreaks({ …, kinsoku: rules })` |
| `canBreakAt(text, pos, clusterIds, 'loose', rules)` | `canBreakAt(text, pos, { clusterIds, kinsoku: 'loose' })` |
| `isLineStartProhibited(cp, 'loose', rules)` | `isLineStartProhibited(cp, { kinsoku: 'loose' })` |
| `isLineEndProhibited(cp, rules)` / `isUnbreakablePair(a, b, rules)` | `isLineEndProhibited(cp, { kinsoku: rules })` / `isUnbreakablePair(a, b, { kinsoku: rules })` |
| `buildKinsokuRules({ lineStartProhibited: [...defaults.lineStartProhibited, 0xff05], … })` | `extendKinsokuRules(getDefaultKinsokuRules(), { lineStartProhibited: [0xff05] })` |
| `rules.lineStartProhibitedSet.has(cp)` | `isLineStartProhibited(cp, { kinsoku: rules })`; `KinsokuRules` holds only the read-only lists |
| `isClusterBreakAllowed(clusterIds, pos, textLength)` | `isClusterBreakAllowed(clusterIds, pos)` |
| `resolveClusterBoundaries(text, clusterIds)` | `resolveClusterNoBreakFlags(text, clusterIds)` |
| `result.hangingAdjustments?.[i]` | `result.hangingAdjustments[i]` |
| `{ startIndex, endIndex, rubyText, rubyAdvances, type: 'group' }` (`RubyAnnotation`) | `{ startIndex, endIndex, rubyText, rubyAdvances, rubyType: 'group' }` |
| `{ kind: 'ruby', startIndex, endIndex, rubyText, type: 'group' }` | `{ type: 'ruby', startIndex, endIndex, rubyText, rubyType: 'group' }` |
| `{ kind: 'footnote', startIndex, endIndex, noteId }` | `{ type: 'footnote-ref', startIndex, endIndex, noteId }` |
| `ann.kind === 'tcy'` | `ann.type === 'tcy'` |
| `RubyInputAnnotation` | `InlineRubyAnnotation` |
| `headingLevel: number` | `headingLevel: HeadingLevel` (`1 \| 2 \| 3 \| 4 \| 5 \| 6`) |
| `{ chapter, paragraph, charIndex }` (`ReadingAnchor`) | `{ chapterIndex, paragraphIndex, charIndex }` |
| `{ paragraph, charIndex }` (`InChapterAnchor`) | `{ paragraphIndex, charIndex }` |
| `annotation.chapter` | `annotation.chapterIndex` |
| `ReadingPositionValue` | `ReadingAnchor` |
| `sortAnnotations(list)` | `toSortedAnnotations(list)` |
| `parseAnnotations(raw)` returned `[]` for unreadable data | It returns `null` for unreadable data and `[]` for no data |
| `morpheme.start` / `morpheme.end` (`MorphemeLike`) | `morpheme.startIndex` / `morpheme.endIndex` |
| `token.start` / `token.end` (`ManuscriptToken`) | `token.startOffset` / `token.endOffset` |
| `deriveTypographyHints(text, analysis, options)` | `deriveTypographyHints(analysis, options)` |
| `engine.addImage(a).addImage(b)` | `engine.addImage(a); engine.addImage(b);` (`addImage` returns `void`) |
| `{ x, y, w, h }` (`ImageRect`, `ImageOverlayRect`) | `{ x, y, width, height }` |
| `new SpreadExclusionEngine({ pageWidth, pagePaddingX, pagePaddingY, … })` (`SpreadGeometry`) | `new SpreadExclusionEngine({ pageWidth, paddingX, paddingY, … })`, the names `PageSize` uses |
| `spread.addImage(rect: ImageRect)` (`SpreadExclusionEngine`) | `spread.addImage(rect: SpreadImageRect)`, its own interface measured from the right page's top-left |
| `const { rightSlotCount } = spread.compute()` | `const { rightSlots } = spread.compute()`; the right page holds the first `rightSlots.length` lines |
| `computeExclusionSlots(geometry & { images })` returning an anonymous object | `computeExclusionSlots(input: ComputeExclusionSlotsInput): ExclusionResult` |
| `EditableSettings` with `mode` | `EditableSettings` with `kinsoku` |
| `enMessages.title = '…'` | The catalogs are frozen; pass overrides to `resolveMessages(locale, overrides)` |
| `parseManuscript` from `@libraz/mejiro/epub` only | Also exported from `@libraz/mejiro`, with `ParsedManuscript` |

## `@libraz/mejiro/browser`

| 0.10 | 0.11 |
|---|---|
| `new MejiroBrowser({ fixedFontFamily, fixedFontSize })` | `new MejiroBrowser({ fontFamily, fontSize })` |
| `mejiro.layoutChapter({ paragraphs, lineWidth })` | `mejiro.layoutParagraphs({ paragraphs, lineWidth })` |
| `ChapterLayoutResult` | `ParagraphsLayoutResult` |
| `mejiro.layout({ …, mode: 'strict' })` / `layoutText({ …, mode })` | `mejiro.layout({ …, kinsoku: 'strict' })` / `layoutText({ …, kinsoku })` |
| `mejiro.clearCache(fontKey)` / `cache.get(fontKey, cp)` | `mejiro.clearCache(fontSpec)` / `cache.get(fontSpec, cp)` |
| `mejiro.getMeasurer()` | Removed; create a `CharMeasurer` for direct measurement |
| `createOverlayDragSession({ …, onChange })` | `createOverlayDragSession({ …, onRectChange })` |
| `session.cancel()` | `session.dispose()` |

## `@libraz/mejiro/render`

| 0.10 | 0.11 |
|---|---|
| `segment.type === 'ruby' ? segment.base : segment.text` | `segment.text` (every variant carries it) |
| `{ type: 'ruby', base, rubyText }` (`RenderSegment`, `InlineNode`) | `{ type: 'ruby', text, rubyText }` |
| `entry.isHeading` / `paragraph.isHeading` | `headingLevel != null \|\| kind === 'heading'` |
| `buildParagraphMeasures(entries, { fontSize, lineHeight })` | `buildParagraphMeasures(entries, { fontSize, lineSpacing })` |
| `packPageLines(metrics, startIdx, pageWidth)` | `countPageLines(metrics, startIndex, pageWidth)` |
| `buildColumnSlots(metrics, startIdx, count, columnHeight)` | `buildColumnSlots({ metrics, startIndex, count, columnHeight })` |
| `adjustExclusionSlots(slots, metrics, startIdx, basePitch, contentWidth)` | `adjustExclusionSlots({ slots, metrics, startIndex, basePitch, contentWidth })` |
| `findPhysicalColumn(offsets, spreadStartLine, fromRight, basePitch)` | `findPhysicalColumn({ offsets, spreadStartLine, fromRight, basePitch })` |
| `annotationNestingRank` / `partiallyOverlaps` | No longer exported; `buildInlineNodes` applies them |
| `renderEpubStatic(chapter: StaticChapter)` | `renderEpubStatic(chapter: ChapterSource)` |

## `@libraz/mejiro/book`

```ts
// 0.10
const book = new MejiroBook({ fontFamily, fontSize, headingStyles: DEFAULT_HEADING_STYLES });
const { pageWidth, pageHeight } = book.computePageSize(container);
await book.setOptions({ fontSize: 18 });

// 0.11
const book = new MejiroBook({ fontFamily, fontSize });
const { pageWidth, pageHeight } = book.fitPageSize(container);
await book.updateOptions({ fontSize: 18 });
```

| 0.10 | 0.11 |
|---|---|
| `book.computePageSize(container, options)` returning `{ pageWidth, pageHeight, contentHeight }` | `book.fitPageSize(container, options)` returning a `PageGeometry`, which `layout.resize()` takes as it is |
| `ComputePageSizeOptions` with `pagePaddingX` / `pagePaddingY` | `FitPageSizeOptions` with `paddingX` / `paddingY` / `paddingBottom` |
| `book.setPageSize({ pageWidth, lineWidth, pagePaddingX, pagePaddingY })` | `book.setPageSize({ pageWidth, lineWidth, paddingX, paddingY })`, or `new MejiroBook({ …, pageSize })` |
| `DEFAULT_PAGE_PADDING.x` / `.y` / `.bottom` | `DEFAULT_PAGE_PADDING.paddingX` / `.paddingY` / `.paddingBottom` |
| `headingStyles: DEFAULT_HEADING_STYLES` | Leave it out; those are the defaults |
| `new MejiroBook(options: MejiroBookOptions)` | `new MejiroBook(options: BookOptions)`; `strictFontCheck` is a `BookOptions` key |
| `book.setOptions({ analyzer, … })` | `book.updateOptions(patch: BookOptionsPatch)`; a construction-time key in the patch is a type error |
| `book.getOptions(): BookOptions` | `book.getOptions(): ResolvedBookOptions` |
| `new MejiroBook({ …, mode: 'loose' })` | `new MejiroBook({ …, kinsoku: 'loose' })` |
| `book.clearCache(fontKey)` | `book.clearCache(fontSpec)` |
| `await book.layoutManuscript({ chapters })` returning a `Map` keyed by id | An array, at the same index as `chapters` |
| `new ChapterLayout(…)` | `ChapterLayout` is a type only; use `layoutChapter()`, `layoutManuscript()` or `layoutFromSnapshot()` |
| `layout.totalPages` / `spread.totalPages` | `layout.pageCount` / `spread.pageCount` |
| `layout.syncImages(spreadIdx, images)` | `layout.setImages(spreadIndex, images)`, which returns the reflowed `SpreadResult` |
| `layout.clearImages()` | `layout.clearImages()` for every spread, `layout.clearImages(spreadIndex)` for one |
| `{ x, y, w, h }` (`BookImage`) | `{ x, y, width, height }` |
| `layout.anchorAt(spreadIdx, 'left')` | `layout.anchorAt(spreadIndex, { side: 'left' })` |
| `layout.anchorAtCoord(spreadIdx, x, y)` | `layout.anchorAtCoord(spreadIndex, { x, y })` |
| `location.spreadIdx` / `.pageIdx` / `.lineIdx` (`AnchorLocation`, `AnchorRect`) | `location.spreadIndex` / `.pageIndex` / `.lineIndex` |
| `layout.findText('a.c', { regex: true })` | `layout.findText(/a.c/u)` |
| `match.paragraph` / `match.charStart` / `match.charEnd` | `match.paragraphIndex` / `match.startIndex` / `match.endIndex` |
| `findText(q, { maxResults: 0 })` returning `[]` | `maxResults` below 1 throws `RangeError` |
| `estimateReadingTime(chapter: ChapterLike, { cpm })` | `estimateReadingTime(chapter: ChapterSource, { charsPerMinute })` |
| `formatReadingTime(ms, 'en')` | `formatReadingTime(ms, { messages: enMessages })` |
| `snapshot.config.mode` | `snapshot.config.kinsoku` |
| `RubyInputAnnotation` from `@libraz/mejiro/book` | `InlineRubyAnnotation` from `@libraz/mejiro` |

## `@libraz/mejiro/epub`

```ts
// 0.10
const editor = await EditableEpub.load(buffer);
editor.updateParagraph(0, 2, { text });
const out: ArrayBuffer = await exportEditableEpub(editor);

// 0.11
const editor = await parseEditableEpub(bytes);
const block = editor.epub.chapters[0].blocks[2];
editor.updateParagraph(0, block.id, { text });
const out: Uint8Array = await editor.export();
```

| 0.10 | 0.11 |
|---|---|
| `EditableEpub.load(buffer)` | `parseEditableEpub(bytes)` |
| `exportEditableEpub(editor, options)` | `editor.export(options)` |
| `editor.book` | `editor.epub` |
| `updateEpubParagraph` / `setEpubInlineAnnotations` / `addEpubChapterImage` | `editor.updateParagraph` / `editor.setInlineAnnotations` / `editor.addImage` |
| `editor.updateParagraph(chapterIdx, paragraphIdx, patch)` | `editor.updateParagraph(chapterIndex, blockId, patch: ParagraphPatch)` |
| `editor.setInlineAnnotations(chapterIdx, paragraphIdx, annotations)` | `editor.setInlineAnnotations(chapterIndex, blockId, annotations)` |
| `editor.updateParagraph(0, i, { headingLevel: 2 })` on a body paragraph | `editor.updateParagraph(0, id, { paragraphKind: 'heading', headingLevel: 2 })` |
| `const id = editor.insertParagraph(0, 0, { text, inlineAnnotations: [] })` | `const block = editor.insertParagraph(0, 0, { text })` (`NewParagraph`; the block carries `id`) |
| `const [leftId, rightId] = editor.splitParagraph(0, id, n)` | `const right = editor.splitParagraph(0, id, n)`; the block keeps `id` |
| `editor.mergeParagraphs(0, leftId, rightId)` returning an id | `editor.mergeParagraphs(0, { leftId, rightId })` returning the merged block |
| `const assetKey = editor.addImage(0, image)` | `const block = editor.addImage(0, image); block.assetKey` |
| `editor.addImage(0, { href, mediaType, data, afterParagraph })` | `editor.addImage(0, { filename, data, afterBlockId })` |
| `editor.removeImage(0, blockIdOrAssetKey)` | `editor.deleteBlock(0, blockId)`, or `editor.removeImageAsset(assetKey)` for the asset and all its blocks |
| `editor.setImageCaption(0, id, undefined)` | `editor.setImageCaption(0, id, null)` |
| `editor.transaction(async () => { … })` | Rejected by the type; `fn` runs synchronously |
| `chapter.paragraphs` / `chapter.paragraphRefs` / `chapter.images` / `EditableParagraphRef` | `chapter.blocks`; `editableEpubToEpubBook(epub)` for a paragraph view to preview |
| `chapter.isDirty` / `epub.packageData` | Internal; not part of the type |
| `{ chapter, paragraph }` (`EditableEpubSelection`) | `{ chapterIndex, blockId }` |
| `assetResolver: ({ assetKey, asset, url, signal }) => …` | `assetResolver: ({ url, href, mediaType, signal }) => …`; `AssetResolverAsset` is removed |
| `EpubExportOptions.watermark` | `EditableEpubExportOptions.watermark`; `EpubProject.export` takes no watermark |
| `parseEpub(buffer: ArrayBuffer)` | `parseEpub(data: BinaryInput)` (`ArrayBuffer \| Uint8Array`) |
| `await editor.export()` / `await project.export()` returning `ArrayBuffer` | Both return `Uint8Array` |
| `parseManuscriptRuby(text)` | `parseManuscript(text).inlineAnnotations.filter((a) => a.type === 'ruby')` |
| `manuscriptToEpubBook(chapters, { dialect, title, author })` | `manuscriptToEpubBook(chapters, { dialect, metadata: { title, creators } })` |
| `ManuscriptSourceChapter` / `ManuscriptChapterInput` | `ManuscriptChapter` |
| `project.addInlineImage(0, 3, { href, data, alt })` | `project.addImage(0, { filename, data, alt, atParagraphIndex: 3 })`, which returns the stored asset |
| `project.setCover({ href, data, properties })` | `project.setCover({ data, mediaType, filename })` (`CoverInput`) |
| `project.addChapter(chapter)` returning `void` | It returns the stored `ProjectChapter` |
| `project.metadata.title = '…'` / `project.stylesheet = css` | `project.updateMetadata({ title: '…' })` / `project.setStylesheet(css)` |
| `metadata: { author, series }` | `metadata: { creators: [{ name, role: 'aut' }], collections: [{ name, type: 'series' }] }` |
| `EpubProjectAsset` with both `data` and `url` optional | A union: `data` or `url`, never both |

## `@libraz/mejiro/image`

| 0.10 | 0.11 |
|---|---|
| `warnings: string[]` reporting downscale, quality and format fallback | `warnings: readonly MejiroWarning[]`, only `max-bytes-exceeded`; read the rest from `width`, `height` and `mediaType` |
| A decode or encode failure thrown as the platform's error | `MejiroError` `image-decode-failed` (`cause` set) / `image-encode-failed`; missing APIs are `environment-unsupported` |

## `@libraz/mejiro/analysis`

| 0.10 | 0.11 |
|---|---|
| `createSuzumeAnalyzer({ instance: anything })` | `instance` is a `SuzumeInstance`, checked at creation (`TypeError`) |
| A missing `@libraz/suzume` rejected with the loader's error | `MejiroError` `analyzer-unavailable`; `analyze()` after `dispose()` throws `analyzer-disposed` |
| `alignMorphemeOffsets(…)` returning `{ morphemes, warnings: string[] }` | `Pick<TextAnalysis, 'morphemes' \| 'warnings'>` with `MejiroWarning` entries |

## `@libraz/mejiro-react` and `@libraz/mejiro-vue`

```tsx
// 0.10
<MejiroReader epub={epub} chapter={chapter} onChapterChange={setChapter}
  spreadIdx={spread} onSpreadIdxChange={setSpread} enableStats bare />

// 0.11
<MejiroReader epub={epub} chapterIndex={chapter} onChapterIndexChange={setChapter}
  spreadIndex={spread} onSpreadIndexChange={setSpread} showStats />
```

```vue
<!-- 0.10 -->
<MejiroReader :epub="epub" :chapter="chapter" @chapter-change="onChapter" :spread-idx="spread" @spread-idx-change="onSpread" />

<!-- 0.11 -->
<MejiroReader :epub="epub" v-model:chapter-index="chapter" v-model:spread-index="spread" />
```

### MejiroReader

| 0.10 | 0.11 |
|---|---|
| `chapter` / `onChapterChange` (Vue `chapter-change`) | `chapterIndex` / `onChapterIndexChange` (Vue `v-model:chapter-index`) |
| `spreadIdx` / `onSpreadIdxChange` (Vue `spread-idx-change`) | `spreadIndex` / `onSpreadIndexChange` (Vue `v-model:spread-index`) |
| `onSpreadChange` (Vue `spread-change`) | `onSpreadIndexChange`, or `onAnchorChange` (Vue `v-model:anchor`) for page-level moves |
| `onChapterCompleted` (Vue `chapter-completed`) | `onChapterFinished` (Vue `chapter-finished`), receiving the chapter index |
| Restoring with `goToAnchor` in a mount effect and saving in `onSpreadChange` | `anchor={position} onAnchorChange={save}` |
| `enableStats` | `showStats` (default `false`) |
| `enablePageIndicator` / `enableSettings` | `showPageIndicator` / `showSettings` |
| `enableImageOverlay` | `showImageOverlayButton` |
| `enableChapterNav={false}` | `chapterNavMode="none"` |
| `bare` / `enableHeader` | Removed: the header appears when there is a `title` or `logo`; switch the rest off one by one |
| `options: Partial<MejiroBookOptions>` | `options: Partial<BookOptions>` |
| `handle.getReadingPosition()` returning `ReadingPosition { chapter, spreadIdx, totalPages, totalSpreads }` | `handle.getSpreadPosition()` returning `SpreadPosition { chapterIndex, spreadIndex, spreadCount, pageCount }` |
| `handle.setOptions(partial)` | `handle.updateOptions(patch)` |
| `subscribe('spreadChanged', ({ chapter, spreadIdx }) => …)` | `subscribe('spreadIndexChange', ({ chapterIndex, spreadIndex }) => …)` |
| `subscribe('chapterFinished', ({ chapter }) => …)` | `subscribe('chapterFinished', ({ chapterIndex }) => …)` |
| `MejiroReaderControlledProps` / `MejiroReaderFileProps` | `MejiroReaderParsedProps` / `MejiroReaderPickerProps` |
| `annotations: { chapter, start, end, color? }[]` | `annotations: ReaderAnnotation[]` (`{ chapterIndex, start, end, color? }`) |
| Vue `fallbackHtml="…"` | The `fallback` slot, with `v-html` for `renderEpubStatic()` output |

### Editors

| 0.10 | 0.11 |
|---|---|
| `<MejiroEditor enableExport>` | `<MejiroEditor showExportButton>` |
| `exportPolicy: { allowDownload, encrypt, watermark }` (`MejiroExportPolicy`), `onBeforeExport` | `exportPolicy: { download, transform, watermark }` (`ExportPolicy`); `transform(bytes: Uint8Array)` replaces both `encrypt` and `onBeforeExport` |
| `onExport(buffer: ArrayBuffer)` | `onExport(bytes: Uint8Array)` |
| `<MejiroManuscriptEditor autosaveDelay={500}>` | `<MejiroManuscriptEditor autosaveDebounceMs={500}>` |
| `ManuscriptEditorChapter` | `ManuscriptChapter` |
| Chapters only uncontrolled | `chapters` / `onChaptersChange` (Vue `v-model:chapters`) as well as title, author and cover |

### Components

| 0.10 | 0.11 |
|---|---|
| `MejiroImageOverlay` / `MejiroImageOverlayProps` | `MejiroImagePlaceholder` / `MejiroImagePlaceholderProps` (CSS class `mejiro-image-overlay` unchanged) |
| `<MejiroChapterNav chapter={i} onChange={set}>` | `<MejiroChapterNav chapterIndex={i} onChapterIndexChange={set}>` (Vue `v-model:chapter-index`) |
| `<MejiroToc onSelect={(chapter) => …}>` (Vue `select`) | `<MejiroToc onChapterSelect={(chapterIndex) => …}>` (Vue `chapter-select`) |
| `<MejiroToc searchable>` | `<MejiroToc showSearch>` |
| `<MejiroShelf onSelect={…}>` (Vue `select`) | `<MejiroShelf onVolumeSelect={…}>` (Vue `volume-select`) |
| `<MejiroSettingsPanel onChange={…}>` | `<MejiroSettingsPanel onSettingsChange={…}>` (Vue `v-model:settings`) |
| `<MejiroNotationHighlighter onChange={setText}>` | `<MejiroNotationHighlighter onValueChange={setText}>` (Vue `v-model:value`); a native `onChange` reaches the textarea |
| Vue `MejiroNotationHighlighter` `textareaClass` / `placeholder`, `MejiroSelectionLayer` `layerClass` | Plain `class` / `placeholder` attributes |
| `<MejiroPageIndicator current={n} total={t}>` (one-based) | `<MejiroPageIndicator index={n - 1} count={t}>` (zero-based, shown one-based) |
| `<MejiroStats totalPages cpm readingTimeLocale>` | `<MejiroStats pageCount charsPerMinute locale>` (`locale` defaults to the provider's) |
| `<MejiroSpread spreadIdx singlePage>` / `<MejiroScrollView spreadIdx>` | `<MejiroSpread spreadIndex spreadMode="single">` / `<MejiroScrollView spreadIndex>` |
| `MejiroSpread` `anchorAtCoord={(x, y) => …}` | `anchorAtCoord={(point) => …}` (`SpreadPoint`) |
| `onVisiblePageChange(pageIdx, source)` | `onVisiblePageChange(pageIndex, source)` |
| `ImageRect` from the framework package | `ImageOverlayRect` |

### Hooks and composables

| 0.10 | 0.11 |
|---|---|
| `useChapterLayout(book, epub, chapterIndex, surface, { resizeDebounce })` | `useChapterLayout(book, { epub, chapterIndex, surface, resizeDebounceMs })` |
| `useManuscriptLayout(book, chapter, surface, options)` | `useManuscriptLayout(book, { chapter, surface, …options })` |
| `PageDimensions` / `ManuscriptPageDimensions` | Read `pageWidth`, `pageHeight` and `contentHeight` from the hook result; `PageGeometry` from `@libraz/mejiro/book` |
| `RecomputeOptions` / `ManuscriptRecomputeOptions` | `ChapterLayoutRecomputeOptions` |
| `useImageOverlay(layout, spreadIdx, onUpdate, options)` returning `{ imageRect, hasImage, toggleImage, … }` | `useImageOverlay(layout, { spreadIndex, onReflow, … })` returning `{ currentImages, addOverlay, removeOverlay, clearOverlays, … }` |
| `useMultiImageOverlay(…)` with `addImage` / `removeImage` / `updateImage` / `hasImages` / `clearImages` | `useImageOverlay(…)` with `addOverlay` / `removeOverlay` / `updateOverlay` / `hasOverlays` / `clearOverlays` |
| `useSpread(layout, { single, turnDuration, onChange })` | `useSpread(layout, { spreadMode: 'single', turnDurationMs, onIndexChange })` |
| `spreadIdx` / `totalSpreads` / `layoutSpreadIdx` / `totalPages` (`useSpread`) | `index` / `count` / `spreadIndex` / `pageCount`; `spreadCount` is new |
| `goTo(i)` (animated) / `setSpread(i)` (no animation) | `goTo(i)` / `goTo(i, { animate: false })` |
| `useMejiroBook(initial)` returning `setOptions` | `useMejiroBook(options, hookOptions)` returning `updateOptions` |
| Vue `useMejiroBook(initial, sourceRef, options)` | `useMejiroBook(optionsRefOrGetter, hookOptions)` |
| `useEpub({ defaultUrl })` / `useEditableEpub({ defaultUrl })` | `useEpub({ url })` / `useEditableEpub({ url })` |
| `useEditableEpub()` returning `book` / `previewBook` | `epub` / `previewEpub` |
| `updateParagraph(text, annotations)` / `selectedParagraph: AnnotatedParagraph` | `updateParagraph(patch: ParagraphPatch)` / `selectedParagraph: EditableParagraphBlock \| null` |
| `useEpubProject({ metadata, chapters, cover, assets })` | `useEpubProject({ initialMetadata, initialChapters, initialCover, initialAssets })` |
| `previewBook` / `setMetadata` / `patchChapter` / `selectedChapter` / `setSelectedChapter` (`useEpubProject`) | `previewEpub` / `updateMetadata` / `updateChapter` / `selectedChapterIndex` / `setSelectedChapterIndex` |
| `EpubProjectChapterDraft` | `ManuscriptChapter` |
| `removeChapter()` removing the selected chapter | `removeChapter(index)`; pass `selectedChapterIndex` |
| `useManuscriptDraft({ autosaveDelay, autosaveKey })` | `useManuscriptDraft({ autosaveDebounceMs, autosaveDeps })` |
| `selected` / `setSelected` / `patchChapter` (`useManuscriptDraft`) | `selectedChapterIndex` / `setSelectedChapterIndex` / `updateChapter` |
| `useAnnotations({ throttleMs, onChange })` | `useAnnotations({ debounceMs, onAnnotationsChange, onError })` |
| `useReadingPosition({ throttleMs, onChange })` | `useReadingPosition({ debounceMs, onPositionChange, onError })` |
| `AnnotationsStorage` / `ReadingPositionStorage` | `MejiroStorage` |
| `useLibrary({ onChange })` returning `current` / `currentIndex` / `goTo(id)` | `useLibrary({ onVolumeChange })` returning `volume` / `volumeIndex` / `selectVolume(id)` |
| `format(template, vars)` from `useI18n` | `formatMessage(template, vars)`; `MejiroI18nProviderProps` is exported |
| Vue `pendingRestore.current` | Vue `pendingRestore.value` |
| Vue managed state as writable refs | Readonly refs; change it through the returned functions |

## Behaviour changes

These keep their names, or rename in a way the type checker cannot follow, and act differently.

- **Controlled position props.** A reader position prop is controlled only when its handler is passed (`onChapterIndexChange`, `onSpreadIndexChange`, `onAnchorChange`; Vue: a listener on `update:xxx`). A value alone is the starting position. In 0.10 a `spreadIdx` value by itself made the reader controlled.
- **`spreadIndex` in single-page mode.** `spreadIndex`, `onSpreadIndexChange`, `SpreadPosition` and the `spreadIndexChange` event count spreads of the chapter layout, also in single-page mode. Given alone in single-page mode, the reader opens the right page of that spread (the first in reading order). Turning from the right to the left page of one spread keeps the spread, so `onSpreadIndexChange` does not fire; follow `anchor` / `onAnchorChange` for page-level changes. When `anchor` is given with `chapterIndex` or `spreadIndex`, `anchor` wins. In 0.10 the single-page index counted pages. The navigation index of `useSpread` (`index`, `count`, `goTo`, `next`, `prev`) still counts pages in single-page mode.
- **Default chrome.** `MejiroReader` draws no header without a `title` or `logo`, hides the statistics line unless `showStats` is set, and has no default title (it was `'mejiro'`). Arrow keys and Escape act on the focused reader root instead of `window`.
- **Starting content of the manuscript hooks.** `useManuscriptDraft` and `useEpubProject` start with an empty title and one empty chapter. `MejiroManuscriptEditor` puts the active catalog's default title in place.
- **`lineSpacing` default.** `MeasureOptions.lineSpacing` defaults to `DEFAULT_LINE_SPACING` (1.8), as `BookOptions` and the components already did; it was `1`. Code calling `buildParagraphMeasures` without `lineSpacing` paginates with a larger line pitch.
- **`hangingAdjustments` always present.** `BreakResult.hangingAdjustments` has one entry per line, zeros with `enableHanging: false`, instead of being `undefined`.
- **Byte output.** `EditableEpub.export()`, `EpubProject.export()`, the hooks' `exportEpub()`, `onExport` and `ExportPolicy.transform` deliver `Uint8Array`, not `ArrayBuffer`.
- **`fitPageSize` on a hidden container.** A container that measures zero wide or high throws `RangeError` and stores nothing. The layout hooks wait for the surface to report a size before measuring.
- **`setImages` reflows on every call.** Setting the images of several spreads reflows once per spread; restoring a snapshot applies them in one pass.
- **`layoutManuscript` returns an array.** One layout per chapter, at the chapter's index.
- **`findText`.** A string query is always literal; there is no `regex` option. A `RegExp` keeps its own flags, its `g` and `y` flags are ignored and its `lastIndex` is not touched. `caseSensitive` applies to strings only.
- **Selections.** `clampEditableEpubSelection` moves a block id the chapter does not hold to the chapter's first block.
- **`useMejiroBook` with changing options.** A change to a key `updateOptions` accepts is applied to the existing book; a change to a construction-time key (`strictFontCheck`, `analyzer`, `pageSize`, …) is ignored, and the book is not recreated. Give the component a new `key` to start over.
- **Image warnings.** `prepareImage` reports only `max-bytes-exceeded`. Downscaling, quality reduction, a format fallback and flattened transparency are the requested processing, readable from `width`, `height` and `mediaType`.
- **No console output by default.** The library writes to the console only when a recovered failure has no `onError` to go to. `parseReadingPosition` reads a legacy payload without a warning.

## Persisted formats

0.11 writes version 3 of each stored format and reads the earlier ones, converting them to the current shape. 0.10 does not read version 3, so data saved by 0.11 is not readable after a downgrade.

| Format | Written by 0.11 | Read by 0.11 |
|---|---|---|
| Reading position (`serializeReadingPosition`, `useReadingPosition`) | `{ version: 3, chapterIndex, paragraphIndex, charIndex }` | Version 3, version 2 and the unversioned `{ chapter, paragraph, charIndex }`; the older `{ chapter, spreadIdx }` resumes at the start of its chapter |
| Annotations (`serializeAnnotations`, `useAnnotations`) | `{ version: 3, annotations: [{ id, chapterIndex, start, end, … }] }`, with `start` / `end` as `{ paragraphIndex, charIndex }` | Version 3, version 1 and a bare annotation array |
| Layout snapshot (`ChapterLayout.snapshot()`, `layoutFromSnapshot()`) | `version: 3`, with `config.kinsoku`, `rubyType` and image `width` / `height` | Version 3 and version 2; a version 2 paragraph with `isHeading: true` and no `kind` reads as `kind: 'heading'` |

An unknown version or a value that is not an object reads as `null` for both; no stored data at all reads as `null` (reading position) and `[]` (annotations). A snapshot of an unknown version throws `MejiroError` `snapshot-invalid`. The persistence hooks report unreadable data to `onError` as `storage-corrupt` and leave it in place until the first change.

---

[Back to documentation index](./README.md)
