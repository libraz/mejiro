# EPUB解析と生成

`@libraz/mejiro/epub` は、EPUB を扱うためのエントリポイントです。EPUB ファイルを本文とインライン注釈の構造化データへ変換し、既存 EPUB の編集・書き戻しや、原稿テキストからの EPUB 3 生成にも使えます。

## parseEpub()

`parseEpub()` は EPUB 解析の基本 API です。EPUB ファイル（ZIP アーカイブ）を含む `ArrayBuffer` を受け取り、`EpubBook` を返します。

```ts
import { parseEpub } from '@libraz/mejiro/epub';

const book = await parseEpub(epubArrayBuffer);
console.log(book.title);   // OPFメタデータから取得した書名
console.log(book.author);  // 著者（省略可）
console.log(book.chapters.length);
```

## 内部フロー

`parseEpub()` は、おおまかに次の流れで EPUB を段落データへ変換します。

![parseEpub の処理フロー: EPUB の ArrayBuffer を上限チェックのうえ JSZip で展開して META-INF/container.xml を読み、ルートファイルパスから OPF パッケージ（メタデータ・マニフェスト・spine）へ進む。spine 順に XHTML コンテンツ文書をたどり、extractRubyContent で AnnotatedParagraph を取り出し、章としてまとめて EpubBook を返す。OPF からは破線の側枝がナビゲーション文書へ伸び、目次の章タイトルを EpubBook に供給する](../assets/epub-parse-flow-ja.svg)

処理手順は次のとおりです。

1. **ZIP 展開** -- 後述の読込上限に照らしてアーカイブを検査したうえで、JSZip で EPUB ファイルを展開します。
2. **container.xml** -- `META-INF/container.xml` を読み取り、ルートファイルパス（OPFファイル）を特定します。
3. **OPF 解析** -- OPF ファイルを解析し、メタデータ（`dc:title`、`dc:creator`）、spine（コンテンツ文書の読み順）、ナビゲーション文書を取り出します。manifest の id から href への対応を作り、spine の itemref をファイルパスへ解決します。
4. **XHTML 抽出** -- spine の各項目について、対応する XHTML コンテンツ文書を ZIP から読み取ります。
5. **段落抽出** -- `extractRubyContent()` が各 XHTML 文書の DOM を走査し、本文テキストとルビ注釈を `AnnotatedParagraph[]` にまとめます。
6. **章としてまとめる** -- 段落を `EpubChapter` にまとめ、OPF メタデータの書名と著者を添えた `EpubBook` として返します。

章タイトルは、文書内に `id="chapter-title"` の要素があればそれを、なければ最初の `h1`、`h2`、`h3` を、それもなければナビゲーション文書の目次を使います。

段落が 1 つもない章は結果から除外されます。

### 未信頼 EPUB の読込上限

`parseEpub()` と `EditableEpub.load()` は、圧縮入力サイズ、entry 数、entry ごとの展開サイズ、合計展開サイズ、圧縮率の安全な既定上限を超える archive を拒否します。信頼できる環境だけで上限を変更してください。

```ts
const book = await parseEpub(data, {
  limits: { maxTotalBytes: 300 * 1024 * 1024 },
});
```

`DEFAULT_EPUB_PARSE_LIMITS` と `EpubParseLimits` / `EpubParseOptions` は `@libraz/mejiro/epub` から export されます。

## データモデル

```ts
interface EpubBook {
  title: string;          // OPFのdc:titleから取得
  author?: string;        // OPFのdc:creatorから取得
  chapters: EpubChapter[];
}

interface EpubChapter {
  title?: string;         // XHTML内のh1/h2/h3から取得
  paragraphs: AnnotatedParagraph[];
}

interface AnnotatedParagraph {
  text: string;                             // 本文テキスト（ルビテキストは除去済み）
  inlineAnnotations: InlineAnnotation[];    // ルビ / 圏点 / 縦中横 / リンク / 注
  headingLevel?: number;                    // h1-h6要素の場合は1-6
}
```

ルビは `@libraz/mejiro/browser` の `InlineAnnotation` 判別共用体のうち、`kind: 'ruby'` バリアントとして表現されます。

```ts
interface InlineRubyAnnotation {
  kind: 'ruby';
  startIndex: number;                  // 文字インデックス（バイトではない）
  endIndex: number;                    // 排他的
  rubyText: string;
  type?: 'mono' | 'group' | 'jukugo';
  jukugoSplitPoints?: number[];
}
```

原稿テキストから生成する場合は `parseManuscript(text, { dialect })` でルビ・傍点・縦中横などのインライン注釈をまとめて抽出します。各方言で認識される記法の一覧は本ページ後半の「[原稿記法（parseManuscript）の方言対応表](#原稿記法parsemanuscriptの方言対応表)」を参照してください。

## extractRubyContent()

XHTML 文字列から段落を抽出する低レベル関数です。`parseEpub()` の内部でも使われていますが、直接呼び出すこともできます。

```ts
import { extractRubyContent } from '@libraz/mejiro/epub';

const xhtml = `<html><body>
  <p><ruby>漢字<rt>かんじ</rt></ruby>を読む</p>
  <h2>第二章</h2>
  <p>本文です。</p>
</body></html>`;

const paragraphs = extractRubyContent(xhtml);
// paragraphs[0].text === '漢字を読む'
// paragraphs[0].inlineAnnotations === [
//   { kind: 'ruby', startIndex: 0, endIndex: 2, rubyText: 'かんじ', type: 'group' }
// ]
// paragraphs[1].text === '第二章'
// paragraphs[1].headingLevel === 2
// paragraphs[2].text === '本文です。'
```

### ブロックレベル要素

次の要素を段落の境界として扱います: `p`、`div`、`h1`、`h2`、`h3`、`h4`、`h5`、`h6`、`blockquote`、`li`、`dt`、`dd`、`section`、`article`、`main`、`td`、`th`、`pre`、`table`、`tr`、`figcaption`。

XHTML文書にブロックレベル要素が含まれない場合、body全体が単一の段落として扱われます。

ブロック要素の直下にインライン内容と入れ子のブロック要素が混在する場合、各インラインランはそれぞれ独立した段落として原文の順序どおりに出力されます。たとえば `<div>A<p>B</p>C</div>` は `A`、`B`、`C` の3段落になります。

### ルビの処理

- `<ruby>base<rt>reading</rt></ruby>` は、親文字が1文字の場合はモノ注釈、複数文字の場合はグループ注釈を生成します。
- `<rp>` 要素は完全に無視されます。
- `<rb>` 要素は親文字テキストとして扱われます。
- `<ruby>` の直下に `<rt>` がない場合は、`<rtc>` 内の読みが使われます。
- 単一の `<ruby>` 要素内に複数の親文字-rtペアがある場合、各ペアに対して個別の注釈が生成されるとともに、ルビグループ全体にわたる熟語レベルの注釈が追加されます。この注釈には、親文字テキスト内で改行可能な位置を示す `jukugoSplitPoints` が含まれます。
- `<ruby>` 内のその他のインライン要素は親文字テキストとして扱われます。
- `<ruby>` 内の末尾の親文字テキストに続く `<rt>` がない場合、ルビ注釈なしのプレーンテキストとして出力されます。

### 文字インデックス

`InlineRubyAnnotation` のインデックスは文字インデックスです（UTF-16コードユニットではなくUnicode文字を数えます）。サロゲートペアは1文字として数えられます。

## EPUBファイルの読み込み方法

### ファイル入力から

```ts
const input = document.createElement('input');
input.type = 'file';
input.accept = '.epub';
input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (!file) return;
  const buffer = await file.arrayBuffer();
  const book = await parseEpub(buffer);
});
```

### ドラッグ&ドロップから

```ts
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (!file?.name.endsWith('.epub')) return;
  const buffer = await file.arrayBuffer();
  const book = await parseEpub(buffer);
});
```

### fetchから

```ts
const response = await fetch('/books/example.epub');
const buffer = await response.arrayBuffer();
const book = await parseEpub(buffer);
```

## EPUBとレイアウトの組み合わせ

EPUB の解析からレイアウト、表示用ページデータの生成までをつなげた例です。

```ts
import { parseEpub } from '@libraz/mejiro/epub';
import { MejiroBrowser, verticalLineWidth } from '@libraz/mejiro/browser';
import { paginate } from '@libraz/mejiro';
import { buildParagraphMeasures, buildRenderPage } from '@libraz/mejiro/render';
import type { RenderEntry } from '@libraz/mejiro/render';

const mejiro = new MejiroBrowser({
  fixedFontFamily: '"Noto Serif JP"',
  fixedFontSize: 16,
});

const book = await parseEpub(buffer);
const chapter = book.chapters[0];

const result = await mejiro.layoutChapter({
  paragraphs: chapter.paragraphs.map((p) => ({
    text: p.text,
    inlineAnnotations: p.inlineAnnotations,
    fontSize: p.headingLevel ? 22 : undefined,
  })),
  lineWidth: mejiro.verticalLineWidth(600),
});

const entries: RenderEntry[] = chapter.paragraphs.map((p, i) => ({
  chars: result.paragraphs[i].chars,
  breakPoints: result.paragraphs[i].breakResult.breakPoints,
  inlineAnnotations: p.inlineAnnotations,
  isHeading: !!p.headingLevel,
}));

const measures = buildParagraphMeasures(entries, { fontSize: 16, lineHeight: 1.8 });
const pages = paginate(400, measures);
const renderPage = buildRenderPage(pages[0], entries);
```

## 既存EPUBの編集

既存パッケージを変更して再エクスポートする場合は、`parseEditableEpub()` / `EditableEpub` を使います。

```ts
import { parseEditableEpub } from '@libraz/mejiro/epub';

const editor = await parseEditableEpub(buffer);

editor.updateParagraph(0, 2, {
  text: '差し替え後の本文',
  inlineAnnotations: [
    { kind: 'ruby', startIndex: 5, endIndex: 7, rubyText: 'ほんぶん', type: 'group' },
  ],
});

const nextBuffer = await editor.export({
  onProgress(stage, ratio) {
    console.log(stage, ratio);
  },
});
```

編集可能な章は `chapter.blocks` にブロック単位の本文を持ち、段落ブロックと画像ブロックが同じ階層に並びます。旧来の段落配列は読み取り互換のために投影されますが、新しいエディタコードでは `EditableEpub` のメソッド経由でブロックを更新してください。

### v0.5: blocks 主体 API への移行ガイド

`v0.5` で `EditableEpubChapter` の正本は `blocks: EditableBlock[]`（段落ブロック `EditableParagraphBlock` と画像ブロック `EditableImageBlock` の混在配列）になりました。`paragraphs` / `paragraphRefs` / `images` は読み取り互換用の deprecated プロパティで、各ミューテーションの後に `blocks` から自動再生成されます。**`v0.6` でこの3プロパティは削除予定**のため、新規実装では下表のとおり `blocks` ベースの API に置き換えてください。

| v0.4 / 旧 API | v0.5 推奨 API | 備考 |
|---------------|---------------|------|
| `chapter.paragraphs[i]` の直接書き換え | `editor.updateParagraph(chapterIdx, paragraphIdx, patch)` | `paragraphIdx` は画像ブロックを除いた段落投影のインデックス。 |
| `chapter.paragraphs.splice(i, 0, p)` で挿入 | `editor.insertParagraph(chapterIdx, atIndex, partial)` | `atIndex` は `chapter.blocks` のインデックス。末尾は `chapter.blocks.length`。 |
| `chapter.paragraphs.splice(i, 1)` で削除 | `editor.deleteBlock(chapterIdx, blockId)` | 段落・画像どちらも削除可能。画像の場合、最後の参照が消えれば `imageAssets` も削除されます。 |
| 段落の途中で分割 | `editor.splitParagraph(chapterIdx, blockId, charIndex)` | 戻り値は `[leftId, rightId]`。境界をまたぐ注釈は破棄されます。 |
| 隣接段落のマージ | `editor.mergeParagraphs(chapterIdx, leftId, rightId)` | `rightId` は `leftId` の直後でなければなりません。 |
| `chapter.images.push(...)` | `editor.addImage(chapterIdx, { filename, data, alt?, caption?, placement? })` | 戻り値は `assetKey`。v0.4 シェイプ（`{ href, mediaType, ... }`）もしばらく受け付けますが将来削除予定。 |
| `chapter.images.splice(i, 1)` | `editor.removeImage(chapterIdx, blockIdOrAssetKey)` | block id でも asset key でも指定可能。 |
| 画像 alt / caption の書き換え | `editor.updateImage(chapterIdx, blockId, patch)` / `setImageCaption(...)` | |
| 段落/画像の並べ替え | `editor.moveBlock(chapterIdx, blockId, toIndex)` | `toIndex` は移動先の `blocks` インデックス。 |
| `paragraphRefs[i].tagName` 参照 | （廃止） | 元 XHTML タグの追跡は廃止。書き戻し時のタグは `paragraphKind` / `headingLevel` から決定されます。 |

#### 段落投影 vs blocks インデックスの違い

`updateParagraph` / `setInlineAnnotations` は「段落のみを数えた連番」を受け取ります。一方 `insertParagraph` / `moveBlock` などは「画像も含めた `blocks` 配列のインデックス」を受け取ります。両者が混在する操作では `chapter.blocks` を直接走査するのが確実です。

```ts
for (const [index, block] of editor.book.chapters[0].blocks.entries()) {
  if (block.kind === 'paragraph' && block.text.includes(query)) {
    editor.updateParagraph(0, paragraphIndexOf(editor.book.chapters[0], index), {
      text: block.text.replaceAll(query, replacement),
    });
  }
}
```

#### Undo/redo・トランザクション・進捗

`v0.5` では `editor.transaction(fn)` で複数操作を1ステップとしてまとめ、`editor.undo()` / `editor.redo()` / `editor.history` で履歴を扱えます。`editor.export({ onProgress, signal })` は進捗コールバックと `AbortSignal` を受け付けるため、ブラウザ上で大きな EPUB を書き出す際の UX 改善や中断にそのまま使えます。

未編集の章は元の XHTML をそのまま書き戻すため、stylesheet link、リスト、テーブルなどの元構造は保持されます。編集済みの章は `html` / `head` / `body` と stylesheet link を保持したうえで本文を再生成しますが、`ul` / `ol` / `dl` / `table` を含む章はまだ安全に往復できないため、黙って平坦化せず export 時にエラーとして拒否します。

#### URL ベースの画像登録（assetResolver）

`addImage()` には `{ filename, data }` の代わりに `{ filename, url }` を渡せます。バイト実体は `editor.export({ assetResolver })` の時点で初めて解決されるため、編集セッション中は外部ストレージの URL だけを保持できます。

```ts
editor.addImage(0, {
  filename: 'figure-01.png',
  url: 'https://cdn.example.com/works/1/figure-01.png',
  alt: '挿絵',
});

const buffer = await editor.export({
  assetResolver: async ({ assetKey, url, signal }) => {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`asset ${assetKey} failed: ${res.status}`);
    return res.arrayBuffer();
  },
});
```

`assetResolver` を省略すると、ランタイムの `fetch(url, { signal })` が暗黙に使われます。投稿サイト全体の流し込みパターンは [09-advanced.md §7.4](09-advanced.md#74-画像アセットの配信assetresolver) を参照してください。

## 原稿テキストからEPUBを生成

`EpubProject` は章ドラフトから新しい EPUB 3 パッケージを生成します。原稿内のルビは `｜漢字《かんじ》` のような青空文庫風記法で書けます。

```ts
import { EpubProject } from '@libraz/mejiro/epub';

const project = new EpubProject({
  metadata: {
    title: '新しい作品',
    creators: [{ name: '作者名', role: 'aut' }],
    language: 'ja',
  },
  dialect: 'mejiro',
  chapters: [
    {
      title: '第一話',
      body: 'これは｜漢字《かんじ》のルビ例です。\n\n本文を続けます。',
    },
  ],
});

project.addChapter({ title: '第二話', body: '続きの本文です。' });
const epubBuffer = await project.export();
```

## 原稿記法（parseManuscript）の方言対応表

`parseManuscript(text, options)` は原稿1段落分のテキストを受け取り、`text`（本文）と `inlineAnnotations`（インライン注釈の配列）に分解します。`options.dialect` で受け付ける記法のセットを切り替えます（デフォルトは `'mejiro'`）。

```ts
import { parseManuscript } from '@libraz/mejiro/epub';

parseManuscript('｜漢字《かんじ》を読む');                       // dialect 省略 = 'mejiro'
parseManuscript('｜漢字《かんじ》を読む', { dialect: 'narou' });
parseManuscript('｜漢字《かんじ》を読む', { dialect: 'kakuyomu' });
```

`EpubProject.fromManuscript()` および `<MejiroManuscriptEditor>` / `useManuscriptDraft()` は内部で `parseManuscript()` を呼び出すため、これらに `dialect` を渡すと原稿全体の解釈を切り替えられます。

### 方言別の対応表

| 記法 | 入力例 | 出力される注釈 | `mejiro`（既定） | `narou` | `kakuyomu` |
|------|--------|---------------|:--:|:--:|:--:|
| パイプ式ルビ | `｜漢字《かんじ》` | `kind: 'ruby'` | ✅ | ✅ | ✅ |
| 自動ルビ（漢字直後の《》） | `漢字《かんじ》` | `kind: 'ruby'` | ✅ | ✅ | ✅ |
| 傍点（圏点） | `《《重要》》` | `kind: 'emphasis'`（`style: 'sesame'`） | ✅ | — | — |
| 縦中横 | `〔20〕` | `kind: 'tcy'` | ✅ | — | — |
| 脚注参照 | `[[#note-1]]` | `kind: 'footnote'` | ✅ | — | — |
| リンク | `[本書](https://example.com)` | `kind: 'link'` | ✅ | — | — |
| 強調 | `**強い**` | `kind: 'strong'` | ✅ | — | — |
| 弱強調 | `*斜体*` | `kind: 'em'` | ✅ | — | — |

`narou` / `kakuyomu` は両方とも「青空文庫互換のルビのみ」を解釈する設定で、両者の挙動は現状同一です。投稿サイトからコピーされた原稿をそのまま EPUB 化したい場合や、`*` や `[]` を本文記号として残したい場合に選択してください。`narou` / `kakuyomu` で `**text**` や `〔20〕` を書いた場合、本文文字としてそのまま残ります（注釈は付きません）。

### 記法の挙動と制約

- **自動ルビ**: 親文字は `Script=Han`（漢字）または `々〆ヶ` の連続のみ対象です。ひらがな・カタカナ・記号には自動ルビが付きません。明示的にルビを付けたい場合は `｜...《...》`（パイプ式）を使ってください。
- **パイプ式ルビ**: 親文字に制約はありません。括弧の優先順位は「パイプ式 → 自動ルビ」の順なので、ひらがな等にルビを振りたい場合は `｜` を先頭に置きます。
- **傍点（圏点）**: `《《...》》` の対応する閉じ括弧が見つからない場合は本文としてそのまま残ります。出力は `style: 'sesame'`（ゴマ点）です。他のスタイル（黒丸 `dot` 等）を使う場合は直接 `InlineAnnotation` を構築してください。
- **縦中横**: 内容は半角英数字と `!`、`?` のみで構成され、括弧の中身が 5 文字以内（括弧を含めて 7 文字以内）であることが条件です。`〔12345〕` は注釈になりますが `〔123456〕` はなりません。日本語混在や長い文字列はそのまま本文に残ります。
- **脚注参照**: 出力本文には `*<id>`（例: `*note-1`）が挿入され、対応する `kind: 'footnote'` 注釈が付与されます。脚注本体（参照先）の管理はアプリ側で行ってください。
- **リンク**: `[label](href)` および `[label](href "title")` を受け付けます。`href` は空白を含まないトークン1つで、`title` 部分はダブルクォートで囲みます。
- **強調 / 弱強調**: `**` が `*` より優先されます。`***text***`（混在）は素直にはネストされない（外側の `**` で `strong` になり、内側に余分な `*` が残る）ため、複合表現は `InlineAnnotation` を直接構築してください。

### 受信した原稿からインライン注釈だけ取り出す

旧 API の `parseManuscriptRuby()` はルビのみを返す薄いラッパーですが、`v0.6` で削除予定です。新規コードでは `parseManuscript()` の結果から必要な `kind` を絞り込んでください。

```ts
import { parseManuscript } from '@libraz/mejiro/epub';

const { text, inlineAnnotations } = parseManuscript(rawText, { dialect: 'narou' });
const rubyOnly = inlineAnnotations.filter((ann) => ann.kind === 'ruby');
```

## 依存関係

`@libraz/mejiro/epub` は、ZIP 展開に [JSZip](https://stuk.github.io/jszip/) を使い、XML / XHTML 解析に `DOMParser` を使います。`DOMParser` はブラウザのほか、happy-dom や jsdom などの DOM 実装を入れたサーバーサイドランタイムでも使えます。

使うグローバルは `DOMParser` / `XMLSerializer` / `Node` の 3 つで、素の Node にはいずれもありません。登録されていない場合、`parseEpub()` と `EditableEpub.load()` は素の `ReferenceError` ではなく、不足しているものを名指ししたエラーを投げます。登録方法は [応用 -- SSR でのファーストペイント](./09-advanced.md#722-ssr-でのファーストペイント) を参照してください。

---

## 関連ドキュメント

- [はじめに](./01-getting-started.md) -- インストールと基本的な使い方
- [コアコンセプト](./02-core-concepts.md) -- TypedArrayベースのAPI、コードポイント処理
- [行分割](./03-line-breaking.md) -- 禁則処理、ぶら下げ組み、ルビ前処理
