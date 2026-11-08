# 0.11 への移行

0.11 は `@libraz/mejiro`・`@libraz/mejiro-react`・`@libraz/mejiro-vue` の公開 API を 1 回のリリースでまとめて作り直し、名前・引数の形・エラーがどの入口でも同じ規則に従うようにしました（[API の規約](02-core-concepts.md#6-api-の規約)）。互換用の別名はありません。0.10 向けのコードは、変わった名前を使う箇所で型検査に失敗します。このページはその名前の順に並べています。3 つのパッケージは同じバージョンでインストールしてください。

表は各変更を 0.10 → 0.11 の組で示します。名前はそのままで動作が変わったものは [挙動の変更](#挙動の変更) に、保存した読書位置・注釈・レイアウトのスナップショットは [保存形式](#保存形式) にまとめています。

## エラー（すべての入口）

| 0.10 | 0.11 |
|---|---|
| `catch (e) { if (e.message.startsWith('Not a valid EPUB')) … }` | `catch (e) { if (e instanceof MejiroError && e.code === 'epub-invalid-archive') … }` |
| `Error`（DOM がないときは `ReferenceError`）として投げられた失敗 | `MejiroErrorCode` の `code` を持つ `MejiroError`。引数の誤りは `TypeError` / `RangeError` |
| React / Vue のフックはエラーを新しい `Error` に正規化していた | 投げられた `MejiroError` が `cause` も含めてそのまま届く |
| `warnings: string[]` | `warnings: readonly MejiroWarning[]` (`{ code, message }`) |

`MejiroError` とその型は、すべてのサブパスと両フレームワークパッケージからエクスポートしています。コードの一覧は [API の規約](02-core-concepts.md#6-api-の規約) にあります。union はマイナーリリースで増えるので、`switch` には `default` を置いてください。

## `@libraz/mejiro`

| 0.10 | 0.11 |
|---|---|
| `computeBreaks({ …, mode: 'loose' })` | `computeBreaks({ …, kinsoku: 'loose' })` |
| `computeBreaks({ …, kinsokuRules: rules })` | `computeBreaks({ …, kinsoku: rules })` |
| `canBreakAt(text, pos, clusterIds, 'loose', rules)` | `canBreakAt(text, pos, { clusterIds, kinsoku: 'loose' })` |
| `isLineStartProhibited(cp, 'loose', rules)` | `isLineStartProhibited(cp, { kinsoku: 'loose' })` |
| `isLineEndProhibited(cp, rules)` / `isUnbreakablePair(a, b, rules)` | `isLineEndProhibited(cp, { kinsoku: rules })` / `isUnbreakablePair(a, b, { kinsoku: rules })` |
| `buildKinsokuRules({ lineStartProhibited: [...defaults.lineStartProhibited, 0xff05], … })` | `extendKinsokuRules(getDefaultKinsokuRules(), { lineStartProhibited: [0xff05] })` |
| `rules.lineStartProhibitedSet.has(cp)` | `isLineStartProhibited(cp, { kinsoku: rules })`。`KinsokuRules` は読み取り専用の配列だけを持つ |
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
| `parseAnnotations(raw)` は読めないデータで `[]` を返していた | 読めないデータでは `null`、データなしでは `[]` を返す |
| `morpheme.start` / `morpheme.end` (`MorphemeLike`) | `morpheme.startIndex` / `morpheme.endIndex` |
| `token.start` / `token.end` (`ManuscriptToken`) | `token.startOffset` / `token.endOffset` |
| `deriveTypographyHints(text, analysis, options)` | `deriveTypographyHints(analysis, options)` |
| `engine.addImage(a).addImage(b)` | `engine.addImage(a); engine.addImage(b);`（`addImage` は `void` を返す） |
| `{ x, y, w, h }` (`ImageRect`, `ImageOverlayRect`) | `{ x, y, width, height }` |
| `new SpreadExclusionEngine({ pageWidth, pagePaddingX, pagePaddingY, … })` (`SpreadGeometry`) | `new SpreadExclusionEngine({ pageWidth, paddingX, paddingY, … })`。`PageSize` と同じ名前 |
| `spread.addImage(rect: ImageRect)` (`SpreadExclusionEngine`) | `spread.addImage(rect: SpreadImageRect)`。右ページ左上から測る専用の型 |
| `const { rightSlotCount } = spread.compute()` | `const { rightSlots } = spread.compute()`。先頭の `rightSlots.length` 行が右ページに入る |
| 匿名のオブジェクトを返す `computeExclusionSlots(geometry & { images })` | `computeExclusionSlots(input: ComputeExclusionSlotsInput): ExclusionResult` |
| `mode` を持つ `EditableSettings` | `kinsoku` を持つ `EditableSettings` |
| `enMessages.title = '…'` | カタログは凍結されている。上書きは `resolveMessages(locale, overrides)` に渡す |
| `parseManuscript` は `@libraz/mejiro/epub` だけにあった | `@libraz/mejiro` からも `ParsedManuscript` と一緒にエクスポート |

## `@libraz/mejiro/browser`

| 0.10 | 0.11 |
|---|---|
| `new MejiroBrowser({ fixedFontFamily, fixedFontSize })` | `new MejiroBrowser({ fontFamily, fontSize })` |
| `mejiro.layoutChapter({ paragraphs, lineWidth })` | `mejiro.layoutParagraphs({ paragraphs, lineWidth })` |
| `ChapterLayoutResult` | `ParagraphsLayoutResult` |
| `mejiro.layout({ …, mode: 'strict' })` / `layoutText({ …, mode })` | `mejiro.layout({ …, kinsoku: 'strict' })` / `layoutText({ …, kinsoku })` |
| `mejiro.clearCache(fontKey)` / `cache.get(fontKey, cp)` | `mejiro.clearCache(fontSpec)` / `cache.get(fontSpec, cp)` |
| `mejiro.getMeasurer()` | 撤去。直接計測するなら `CharMeasurer` を作る |
| `createOverlayDragSession({ …, onChange })` | `createOverlayDragSession({ …, onRectChange })` |
| `session.cancel()` | `session.dispose()` |

## `@libraz/mejiro/render`

| 0.10 | 0.11 |
|---|---|
| `segment.type === 'ruby' ? segment.base : segment.text` | `segment.text`（どのバリアントも持つ） |
| `{ type: 'ruby', base, rubyText }` (`RenderSegment`, `InlineNode`) | `{ type: 'ruby', text, rubyText }` |
| `entry.isHeading` / `paragraph.isHeading` | `headingLevel != null \|\| kind === 'heading'` |
| `buildParagraphMeasures(entries, { fontSize, lineHeight })` | `buildParagraphMeasures(entries, { fontSize, lineSpacing })` |
| `packPageLines(metrics, startIdx, pageWidth)` | `countPageLines(metrics, startIndex, pageWidth)` |
| `buildColumnSlots(metrics, startIdx, count, columnHeight)` | `buildColumnSlots({ metrics, startIndex, count, columnHeight })` |
| `adjustExclusionSlots(slots, metrics, startIdx, basePitch, contentWidth)` | `adjustExclusionSlots({ slots, metrics, startIndex, basePitch, contentWidth })` |
| `findPhysicalColumn(offsets, spreadStartLine, fromRight, basePitch)` | `findPhysicalColumn({ offsets, spreadStartLine, fromRight, basePitch })` |
| `annotationNestingRank` / `partiallyOverlaps` | エクスポートしない。`buildInlineNodes` が内部で適用する |
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
| `{ pageWidth, pageHeight, contentHeight }` を返す `book.computePageSize(container, options)` | `PageGeometry` を返す `book.fitPageSize(container, options)`。`layout.resize()` にそのまま渡せる |
| `pagePaddingX` / `pagePaddingY` を持つ `ComputePageSizeOptions` | `paddingX` / `paddingY` / `paddingBottom` を持つ `FitPageSizeOptions` |
| `book.setPageSize({ pageWidth, lineWidth, pagePaddingX, pagePaddingY })` | `book.setPageSize({ pageWidth, lineWidth, paddingX, paddingY })`、または `new MejiroBook({ …, pageSize })` |
| `DEFAULT_PAGE_PADDING.x` / `.y` / `.bottom` | `DEFAULT_PAGE_PADDING.paddingX` / `.paddingY` / `.paddingBottom` |
| `headingStyles: DEFAULT_HEADING_STYLES` | 省略する。それが既定値 |
| `new MejiroBook(options: MejiroBookOptions)` | `new MejiroBook(options: BookOptions)`。`strictFontCheck` は `BookOptions` のキー |
| `book.setOptions({ analyzer, … })` | `book.updateOptions(patch: BookOptionsPatch)`。構築時専用のキーを渡すと型エラー |
| `book.getOptions(): BookOptions` | `book.getOptions(): ResolvedBookOptions` |
| `new MejiroBook({ …, mode: 'loose' })` | `new MejiroBook({ …, kinsoku: 'loose' })` |
| `book.clearCache(fontKey)` | `book.clearCache(fontSpec)` |
| id をキーにした `Map` を返す `await book.layoutManuscript({ chapters })` | `chapters` と同じ添字に並ぶ配列 |
| `new ChapterLayout(…)` | `ChapterLayout` は型だけ。`layoutChapter()`・`layoutManuscript()`・`layoutFromSnapshot()` を使う |
| `layout.totalPages` / `spread.totalPages` | `layout.pageCount` / `spread.pageCount` |
| `layout.syncImages(spreadIdx, images)` | 流し直した `SpreadResult` を返す `layout.setImages(spreadIndex, images)` |
| `layout.clearImages()` | すべての見開きは `layout.clearImages()`、1 つなら `layout.clearImages(spreadIndex)` |
| `{ x, y, w, h }` (`BookImage`) | `{ x, y, width, height }` |
| `layout.anchorAt(spreadIdx, 'left')` | `layout.anchorAt(spreadIndex, { side: 'left' })` |
| `layout.anchorAtCoord(spreadIdx, x, y)` | `layout.anchorAtCoord(spreadIndex, { x, y })` |
| `location.spreadIdx` / `.pageIdx` / `.lineIdx` (`AnchorLocation`, `AnchorRect`) | `location.spreadIndex` / `.pageIndex` / `.lineIndex` |
| `layout.findText('a.c', { regex: true })` | `layout.findText(/a.c/u)` |
| `match.paragraph` / `match.charStart` / `match.charEnd` | `match.paragraphIndex` / `match.startIndex` / `match.endIndex` |
| `[]` を返していた `findText(q, { maxResults: 0 })` | 1 未満の `maxResults` は `RangeError` |
| `estimateReadingTime(chapter: ChapterLike, { cpm })` | `estimateReadingTime(chapter: ChapterSource, { charsPerMinute })` |
| `formatReadingTime(ms, 'en')` | `formatReadingTime(ms, { messages: enMessages })` |
| `snapshot.config.mode` | `snapshot.config.kinsoku` |
| `@libraz/mejiro/book` の `RubyInputAnnotation` | `@libraz/mejiro` の `InlineRubyAnnotation` |

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
| 本文の段落への `editor.updateParagraph(0, i, { headingLevel: 2 })` | `editor.updateParagraph(0, id, { paragraphKind: 'heading', headingLevel: 2 })` |
| `const id = editor.insertParagraph(0, 0, { text, inlineAnnotations: [] })` | `const block = editor.insertParagraph(0, 0, { text })`（`NewParagraph`。ブロックが `id` を持つ） |
| `const [leftId, rightId] = editor.splitParagraph(0, id, n)` | `const right = editor.splitParagraph(0, id, n)`。元のブロックは `id` を保つ |
| id を返す `editor.mergeParagraphs(0, leftId, rightId)` | 結合後のブロックを返す `editor.mergeParagraphs(0, { leftId, rightId })` |
| `const assetKey = editor.addImage(0, image)` | `const block = editor.addImage(0, image); block.assetKey` |
| `editor.addImage(0, { href, mediaType, data, afterParagraph })` | `editor.addImage(0, { filename, data, afterBlockId })` |
| `editor.removeImage(0, blockIdOrAssetKey)` | `editor.deleteBlock(0, blockId)`。資産とそのブロックすべては `editor.removeImageAsset(assetKey)` |
| `editor.setImageCaption(0, id, undefined)` | `editor.setImageCaption(0, id, null)` |
| `editor.transaction(async () => { … })` | 型で拒否される。`fn` は同期的に実行する |
| `chapter.paragraphs` / `chapter.paragraphRefs` / `chapter.images` / `EditableParagraphRef` | `chapter.blocks`。プレビュー用の段落の形は `editableEpubToEpubBook(epub)` |
| `chapter.isDirty` / `epub.packageData` | 内部の状態で、型には出ない |
| `{ chapter, paragraph }` (`EditableEpubSelection`) | `{ chapterIndex, blockId }` |
| `assetResolver: ({ assetKey, asset, url, signal }) => …` | `assetResolver: ({ url, href, mediaType, signal }) => …`。`AssetResolverAsset` は撤去 |
| `EpubExportOptions.watermark` | `EditableEpubExportOptions.watermark`。`EpubProject.export` は透かしを取らない |
| `parseEpub(buffer: ArrayBuffer)` | `parseEpub(data: BinaryInput)` (`ArrayBuffer \| Uint8Array`) |
| `ArrayBuffer` を返す `await editor.export()` / `await project.export()` | どちらも `Uint8Array` を返す |
| `parseManuscriptRuby(text)` | `parseManuscript(text).inlineAnnotations.filter((a) => a.type === 'ruby')` |
| `manuscriptToEpubBook(chapters, { dialect, title, author })` | `manuscriptToEpubBook(chapters, { dialect, metadata: { title, creators } })` |
| `ManuscriptSourceChapter` / `ManuscriptChapterInput` | `ManuscriptChapter` |
| `project.addInlineImage(0, 3, { href, data, alt })` | 保存した資産を返す `project.addImage(0, { filename, data, alt, atParagraphIndex: 3 })` |
| `project.setCover({ href, data, properties })` | `project.setCover({ data, mediaType, filename })` (`CoverInput`) |
| `void` を返す `project.addChapter(chapter)` | 保存した `ProjectChapter` を返す |
| `project.metadata.title = '…'` / `project.stylesheet = css` | `project.updateMetadata({ title: '…' })` / `project.setStylesheet(css)` |
| `metadata: { author, series }` | `metadata: { creators: [{ name, role: 'aut' }], collections: [{ name, type: 'series' }] }` |
| `data` と `url` がどちらも省略可能な `EpubProjectAsset` | 共用体。`data` か `url` のどちらか一方 |

## `@libraz/mejiro/image`

| 0.10 | 0.11 |
|---|---|
| 縮小・品質・形式のフォールバックを報告する `warnings: string[]` | `warnings: readonly MejiroWarning[]`。`max-bytes-exceeded` だけで、残りは `width`・`height`・`mediaType` から読む |
| デコードとエンコードの失敗は環境のエラーとして投げられていた | `MejiroError` `image-decode-failed`（`cause` あり）/ `image-encode-failed`。API がなければ `environment-unsupported` |

## `@libraz/mejiro/analysis`

| 0.10 | 0.11 |
|---|---|
| `createSuzumeAnalyzer({ instance: anything })` | `instance` は `SuzumeInstance` で、作成時に検査する（`TypeError`） |
| `@libraz/suzume` がないとローダーのエラーで reject していた | `MejiroError` `analyzer-unavailable`。`dispose()` 後の `analyze()` は `analyzer-disposed` |
| `{ morphemes, warnings: string[] }` を返す `alignMorphemeOffsets(…)` | `MejiroWarning` を要素に持つ `Pick<TextAnalysis, 'morphemes' \| 'warnings'>` |

## `@libraz/mejiro-react` と `@libraz/mejiro-vue`

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
| `onSpreadChange` (Vue `spread-change`) | `onSpreadIndexChange`。ページ単位の移動は `onAnchorChange`（Vue `v-model:anchor`） |
| `onChapterCompleted` (Vue `chapter-completed`) | 章の添字を受け取る `onChapterFinished`（Vue `chapter-finished`） |
| マウント時のエフェクトで `goToAnchor` して復元し、`onSpreadChange` で保存 | `anchor={position} onAnchorChange={save}` |
| `enableStats` | `showStats`（既定 `false`） |
| `enablePageIndicator` / `enableSettings` | `showPageIndicator` / `showSettings` |
| `enableImageOverlay` | `showImageOverlayButton` |
| `enableChapterNav={false}` | `chapterNavMode="none"` |
| `bare` / `enableHeader` | 撤去。ヘッダーは `title` か `logo` があるときに出る。他のクロムは個別に消す |
| `options: Partial<MejiroBookOptions>` | `options: Partial<BookOptions>` |
| `ReadingPosition { chapter, spreadIdx, totalPages, totalSpreads }` を返す `handle.getReadingPosition()` | `SpreadPosition { chapterIndex, spreadIndex, spreadCount, pageCount }` を返す `handle.getSpreadPosition()` |
| `handle.setOptions(partial)` | `handle.updateOptions(patch)` |
| `subscribe('spreadChanged', ({ chapter, spreadIdx }) => …)` | `subscribe('spreadIndexChange', ({ chapterIndex, spreadIndex }) => …)` |
| `subscribe('chapterFinished', ({ chapter }) => …)` | `subscribe('chapterFinished', ({ chapterIndex }) => …)` |
| `MejiroReaderControlledProps` / `MejiroReaderFileProps` | `MejiroReaderParsedProps` / `MejiroReaderPickerProps` |
| `annotations: { chapter, start, end, color? }[]` | `annotations: ReaderAnnotation[]` (`{ chapterIndex, start, end, color? }`) |
| Vue `fallbackHtml="…"` | `fallback` スロット。`renderEpubStatic()` の出力は `v-html` で入れる |

### エディタ

| 0.10 | 0.11 |
|---|---|
| `<MejiroEditor enableExport>` | `<MejiroEditor showExportButton>` |
| `exportPolicy: { allowDownload, encrypt, watermark }` (`MejiroExportPolicy`), `onBeforeExport` | `exportPolicy: { download, transform, watermark }`（`ExportPolicy`）。`transform(bytes: Uint8Array)` が `encrypt` と `onBeforeExport` の両方を置き換える |
| `onExport(buffer: ArrayBuffer)` | `onExport(bytes: Uint8Array)` |
| `<MejiroManuscriptEditor autosaveDelay={500}>` | `<MejiroManuscriptEditor autosaveDebounceMs={500}>` |
| `ManuscriptEditorChapter` | `ManuscriptChapter` |
| 章は uncontrolled のみ | タイトル・著者・表紙に加えて `chapters` / `onChaptersChange`（Vue `v-model:chapters`） |

### コンポーネント

| 0.10 | 0.11 |
|---|---|
| `MejiroImageOverlay` / `MejiroImageOverlayProps` | `MejiroImagePlaceholder` / `MejiroImagePlaceholderProps`（CSS クラス `mejiro-image-overlay` は同じ） |
| `<MejiroChapterNav chapter={i} onChange={set}>` | `<MejiroChapterNav chapterIndex={i} onChapterIndexChange={set}>` (Vue `v-model:chapter-index`) |
| `<MejiroToc onSelect={(chapter) => …}>` (Vue `select`) | `<MejiroToc onChapterSelect={(chapterIndex) => …}>` (Vue `chapter-select`) |
| `<MejiroToc searchable>` | `<MejiroToc showSearch>` |
| `<MejiroShelf onSelect={…}>` (Vue `select`) | `<MejiroShelf onVolumeSelect={…}>` (Vue `volume-select`) |
| `<MejiroSettingsPanel onChange={…}>` | `<MejiroSettingsPanel onSettingsChange={…}>` (Vue `v-model:settings`) |
| `<MejiroNotationHighlighter onChange={setText}>` | `<MejiroNotationHighlighter onValueChange={setText}>`（Vue `v-model:value`）。ネイティブの `onChange` は textarea に届く |
| Vue `MejiroNotationHighlighter` `textareaClass` / `placeholder`, `MejiroSelectionLayer` `layerClass` | 通常の `class` / `placeholder` 属性 |
| `<MejiroPageIndicator current={n} total={t}>`（1 始まり） | `<MejiroPageIndicator index={n - 1} count={t}>`（0 始まりで、表示は 1 始まり） |
| `<MejiroStats totalPages cpm readingTimeLocale>` | `<MejiroStats pageCount charsPerMinute locale>`（`locale` の既定はプロバイダのもの） |
| `<MejiroSpread spreadIdx singlePage>` / `<MejiroScrollView spreadIdx>` | `<MejiroSpread spreadIndex spreadMode="single">` / `<MejiroScrollView spreadIndex>` |
| `MejiroSpread` `anchorAtCoord={(x, y) => …}` | `anchorAtCoord={(point) => …}` (`SpreadPoint`) |
| `onVisiblePageChange(pageIdx, source)` | `onVisiblePageChange(pageIndex, source)` |
| フレームワークパッケージの `ImageRect` | `ImageOverlayRect` |

### フックとコンポーザブル

| 0.10 | 0.11 |
|---|---|
| `useChapterLayout(book, epub, chapterIndex, surface, { resizeDebounce })` | `useChapterLayout(book, { epub, chapterIndex, surface, resizeDebounceMs })` |
| `useManuscriptLayout(book, chapter, surface, options)` | `useManuscriptLayout(book, { chapter, surface, …options })` |
| `PageDimensions` / `ManuscriptPageDimensions` | `pageWidth`・`pageHeight`・`contentHeight` はフックの結果から読む。型は `@libraz/mejiro/book` の `PageGeometry` |
| `RecomputeOptions` / `ManuscriptRecomputeOptions` | `ChapterLayoutRecomputeOptions` |
| `{ imageRect, hasImage, toggleImage, … }` を返す `useImageOverlay(layout, spreadIdx, onUpdate, options)` | `{ currentImages, addOverlay, removeOverlay, clearOverlays, … }` を返す `useImageOverlay(layout, { spreadIndex, onReflow, … })` |
| `addImage` / `removeImage` / `updateImage` / `hasImages` / `clearImages` を持つ `useMultiImageOverlay(…)` | `addOverlay` / `removeOverlay` / `updateOverlay` / `hasOverlays` / `clearOverlays` を持つ `useImageOverlay(…)` |
| `useSpread(layout, { single, turnDuration, onChange })` | `useSpread(layout, { spreadMode: 'single', turnDurationMs, onIndexChange })` |
| `spreadIdx` / `totalSpreads` / `layoutSpreadIdx` / `totalPages` (`useSpread`) | `index` / `count` / `spreadIndex` / `pageCount`。`spreadCount` は新規 |
| `goTo(i)`（アニメーションあり）/ `setSpread(i)`（なし） | `goTo(i)` / `goTo(i, { animate: false })` |
| `setOptions` を返す `useMejiroBook(initial)` | `updateOptions` を返す `useMejiroBook(options, hookOptions)` |
| Vue `useMejiroBook(initial, sourceRef, options)` | `useMejiroBook(optionsRefOrGetter, hookOptions)` |
| `useEpub({ defaultUrl })` / `useEditableEpub({ defaultUrl })` | `useEpub({ url })` / `useEditableEpub({ url })` |
| `book` / `previewBook` を返す `useEditableEpub()` | `epub` / `previewEpub` |
| `updateParagraph(text, annotations)` / `selectedParagraph: AnnotatedParagraph` | `updateParagraph(patch: ParagraphPatch)` / `selectedParagraph: EditableParagraphBlock \| null` |
| `useEpubProject({ metadata, chapters, cover, assets })` | `useEpubProject({ initialMetadata, initialChapters, initialCover, initialAssets })` |
| `previewBook` / `setMetadata` / `patchChapter` / `selectedChapter` / `setSelectedChapter` (`useEpubProject`) | `previewEpub` / `updateMetadata` / `updateChapter` / `selectedChapterIndex` / `setSelectedChapterIndex` |
| `EpubProjectChapterDraft` | `ManuscriptChapter` |
| 選択中の章を消す `removeChapter()` | `removeChapter(index)`。`selectedChapterIndex` を渡す |
| `useManuscriptDraft({ autosaveDelay, autosaveKey })` | `useManuscriptDraft({ autosaveDebounceMs, autosaveDeps })` |
| `selected` / `setSelected` / `patchChapter` (`useManuscriptDraft`) | `selectedChapterIndex` / `setSelectedChapterIndex` / `updateChapter` |
| `useAnnotations({ throttleMs, onChange })` | `useAnnotations({ debounceMs, onAnnotationsChange, onError })` |
| `useReadingPosition({ throttleMs, onChange })` | `useReadingPosition({ debounceMs, onPositionChange, onError })` |
| `AnnotationsStorage` / `ReadingPositionStorage` | `MejiroStorage` |
| `current` / `currentIndex` / `goTo(id)` を返す `useLibrary({ onChange })` | `volume` / `volumeIndex` / `selectVolume(id)` を返す `useLibrary({ onVolumeChange })` |
| `useI18n` と一緒の `format(template, vars)` | `formatMessage(template, vars)`。`MejiroI18nProviderProps` もエクスポート |
| Vue `pendingRestore.current` | Vue `pendingRestore.value` |
| Vue の管理状態は書き込める ref だった | 読み取り専用の ref。変更は返された関数で行う |

## 挙動の変更

名前はそのまま、または型検査では追えない形で名前が変わり、動作が変わったものです。

- **位置 props の controlled 判定**。リーダーの位置 props が controlled になるのは、対応するハンドラ（`onChapterIndexChange`、`onSpreadIndexChange`、`onAnchorChange`。Vue では `update:xxx` の購読）を渡したときだけです。値だけなら開始位置です。0.10 では `spreadIdx` の値だけで controlled になっていました。
- **単ページ表示での `spreadIndex`**。`spreadIndex`・`onSpreadIndexChange`・`SpreadPosition`・`spreadIndexChange` イベントは、単ページ表示でも章レイアウト上の見開きを数えます。単ページ表示で `spreadIndex` だけを渡すと、その見開きの右ページ（読み順で先）を開きます。1 つの見開きの中で右ページから左ページへ送っても見開きは変わらないので、`onSpreadIndexChange` は発火しません。ページ単位で追従するには `anchor` / `onAnchorChange` を使ってください。`anchor` を `chapterIndex` や `spreadIndex` と同時に渡すと、`anchor` が優先します。0.10 では単ページ表示の添字はページを数えていました。`useSpread` のナビゲーション位置（`index`、`count`、`goTo`、`next`、`prev`）は、単ページ表示では引き続きページを数えます。
- **既定のクロム**。`MejiroReader` は `title` か `logo` がなければヘッダーを描かず、`showStats` を指定しなければ統計の行を隠し、既定のタイトルもありません（0.10 は `'mejiro'`）。矢印キーと Escape は `window` ではなく、フォーカスしたリーダーのルートで働きます。
- **原稿フックの初期内容**。`useManuscriptDraft` と `useEpubProject` は空のタイトルと空の章 1 つから始まります。既定のタイトルは `MejiroManuscriptEditor` が有効なカタログの文言で入れます。
- **`lineSpacing` の既定値**。`MeasureOptions.lineSpacing` の既定は、`BookOptions` とコンポーネントと同じ `DEFAULT_LINE_SPACING`（1.8）になりました（以前は `1`）。`lineSpacing` を渡さずに `buildParagraphMeasures` を呼ぶコードでは、行ピッチが大きくなってページ分割が変わります。
- **`hangingAdjustments` は常にある**。`BreakResult.hangingAdjustments` は `undefined` にならず、行ごとに 1 要素を持ち、`enableHanging: false` ではすべて 0 です。
- **バイト列の出力**。`EditableEpub.export()`、`EpubProject.export()`、フックの `exportEpub()`、`onExport`、`ExportPolicy.transform` が扱うのは `ArrayBuffer` ではなく `Uint8Array` です。
- **非表示のコンテナでの `fitPageSize`**。幅か高さが 0 のコンテナでは `RangeError` を投げ、何も保存しません。レイアウトフックは、表示面が大きさを報告するまで計測を待ちます。
- **`setImages` は呼ぶたびに流し直す**。複数の見開きの画像を設定すると、見開きごとに 1 回流し直します。スナップショットの復元は 1 回でまとめて適用します。
- **`layoutManuscript` は配列を返す**。章ごとに 1 つのレイアウトが、その章の添字の位置に入ります。
- **`findText`**。文字列の検索語は常に文字どおりに照合し、`regex` オプションはありません。`RegExp` は自身のフラグで照合し、`g` と `y` は無視し、`lastIndex` に触れません。`caseSensitive` は文字列にだけ効きます。
- **選択**。`clampEditableEpubSelection` は、章にないブロック id を章の先頭ブロックに移します。
- **オプションが変わるときの `useMejiroBook`**。`updateOptions` が受け付けるキーの変化は既存の book に適用し、構築時専用のキー（`strictFontCheck`、`analyzer`、`pageSize` など）の変化は無視して、book を作り直しません。やり直すにはコンポーネントに新しい `key` を与えてください。
- **画像の警告**。`prepareImage` が報告するのは `max-bytes-exceeded` だけです。縮小・品質の低下・形式のフォールバック・透過の平坦化は要求どおりの処理で、`width`・`height`・`mediaType` から読めます。
- **既定ではコンソールに出さない**。ライブラリがコンソールに書くのは、回復した失敗の渡し先になる `onError` がないときだけです。`parseReadingPosition` は古い形式のペイロードを警告なしで読みます。

## 保存形式

0.11 は各保存形式のバージョン 3 を書き、それ以前の形式も読んで現在の形に変換します。0.10 はバージョン 3 を読めないので、0.11 が保存したデータはダウングレード後には読めません。

| 形式 | 0.11 が書く形 | 0.11 が読む形 |
|---|---|---|
| 読書位置（`serializeReadingPosition`、`useReadingPosition`） | `{ version: 3, chapterIndex, paragraphIndex, charIndex }` | バージョン 3、バージョン 2、バージョンなしの `{ chapter, paragraph, charIndex }`。さらに古い `{ chapter, spreadIdx }` はその章の先頭から再開する |
| 注釈（`serializeAnnotations`、`useAnnotations`） | `{ version: 3, annotations: [{ id, chapterIndex, start, end, … }] }`。`start` / `end` は `{ paragraphIndex, charIndex }` | バージョン 3、バージョン 1、注釈の素の配列 |
| レイアウトのスナップショット（`ChapterLayout.snapshot()`、`layoutFromSnapshot()`） | `version: 3`。`config.kinsoku`、`rubyType`、画像の `width` / `height` を持つ | バージョン 3 とバージョン 2。`isHeading: true` で `kind` のないバージョン 2 の段落は `kind: 'heading'` として読む |

未知のバージョンやオブジェクトでない値は、どちらも `null` として読みます。データがまったくなければ、読書位置は `null`、注釈は `[]` です。未知のバージョンのスナップショットは `MejiroError` `snapshot-invalid` を投げます。永続化フックは読めないデータを `storage-corrupt` として `onError` に報告し、最初の変更まで上書きしません。

---

[ドキュメント目次に戻る](./README.md)
