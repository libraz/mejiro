# 応用

このページでは、mejiro の応用的な使い方を扱います。カスタム禁則ルール、形態素解析との連携、パフォーマンス、サーバーサイド利用、独自レンダリングを順に見ていきます。

---

## 1. カスタム禁則ルール

`computeBreaks()` に `KinsokuRules` オブジェクトを渡すことで、デフォルトの行頭・行末禁則ルールを上書きできます。

### デフォルトルールの拡張

`getDefaultKinsokuRules()` で組み込みの厳密ルールのコピーを取得し、それを変更します:

<!-- doc-example: 09-kinsoku.ts#kinsoku -->
```ts
import {
  computeBreaks,
  extendKinsokuRules,
  getDefaultKinsokuRules,
  toCodepoints,
} from '@libraz/mejiro';

// デフォルトの規則に、行頭禁止の ％ を加える
const rules = extendKinsokuRules(getDefaultKinsokuRules(), { lineStartProhibited: [0xff05] });

const result = computeBreaks({
  text: toCodepoints('ただいま５％引きです。'),
  advances: new Float32Array(11).fill(16),
  lineWidth: 80,
  kinsoku: rules,
});
// result.breakPoints → [3, 8]: ％ が行頭に来ないよう、５ ごと次の行へ送られる
```

### ルールをゼロから作成

デフォルトを継承せずにルールを作成する場合:

```ts
const rules = buildKinsokuRules({
  lineStartProhibited: [0x3001, 0x3002], // 、と。のみ
  lineEndProhibited: [0x300c],           // 「のみ
});
```

`kinsoku` に渡したカスタムルールは、組み込みルールを**完全に置き換え**ます。`kinsoku` が取るのはモード（`'strict'` / `'loose'`）かルールのどちらか一方です。

### KinsokuRules の構造

```ts
interface KinsokuRules {
  lineStartProhibited: number[];        // コードポイント配列
  lineEndProhibited: number[];
  unbreakablePairs: Array<readonly [number, number]>; // 行をまたいで分割しないペア
  lineStartProhibitedSet: Set<number>;  // 事前計算されたルックアップ用 Set
  lineEndProhibitedSet: Set<number>;
  unbreakablePairSet: Set<string>;
}
```

ルールの作成には必ず `buildKinsokuRules()` を使用してください。この関数はコードポイント配列からルックアップ用の Set を自動生成します。Set なしで `KinsokuRules` オブジェクトを手動構築すると、正しく動作しません。

---

## 2. トークン境界（形態素解析連携）

`tokenBoundaries` オプションを使うと、[`@libraz/suzume`](https://github.com/libraz/suzume) などの形態素解析器やトークナイザを連携させ、自然な単語境界での改行を優先できます。ブラウザ単体で完結させたい場合は、辞書同梱の WASM ビルドがおよそ 628 KB（gzip 後で約 260 KB）に収まる Suzume が手早く、辞書の精度を重視するならサーバ側でより大きな辞書を持つ解析器を使うのが選択肢になります。

### 基本的な使い方

<!-- doc-example: 09-tokens.ts#tokens -->
```ts
import { computeBreaks, toCodepoints, tokenLengthsToBoundaries } from '@libraz/mejiro';

// 入力: "新しいプログラミング言語" を以下のようにトークン化:
// ["新しい" (3), "プログラミング" (7), "言語" (2)]
const boundaries = tokenLengthsToBoundaries([3, 7, 2]);
// boundaries → Uint32Array [2, 9]  (インデックス 2 と 9 の後で改行を優先)

const text = toCodepoints('新しいプログラミング言語');
const result = computeBreaks({
  text,
  advances: new Float32Array(text.length).fill(16),
  lineWidth: 80,
  tokenBoundaries: boundaries,
});
```

### 動作の仕組み

1. 改行位置を後方検索する際、アルゴリズムはまず禁則的に有効**かつ**トークン境界でもある位置を探します。
2. 有効な候補の中にトークン境界が見つからない場合は、禁則的に有効な任意の位置にフォールバックします。
3. トークン境界は**優先指定**であり、厳密な制約ではありません。禁則ルールが常に優先されます。

### 配列の直接渡し

`Uint32Array` の代わりにプレーンな `number[]` を渡すこともできます:

<!-- doc-example: 09-tokens.ts#token-array -->
```ts
computeBreaks({
  text,
  advances,
  lineWidth: 80,
  tokenBoundaries: [2, 9], // readonly number[] も受け付けます
});
```

### tokenLengthsToBoundaries

`tokenLengthsToBoundaries()` ヘルパーは、トークン長（コードポイント数）の配列を境界インデックスに変換します。各境界は、そのトークンの**最後のコードポイント**のインデックスです。最後のトークンの境界はテキスト末尾と一致するため省略されます。

```ts
tokenLengthsToBoundaries([3, 7, 2])
// → Uint32Array [2, 9]
```

---

## 3. パフォーマンス

### O(n) の保証

`computeBreaks()` は文字数 n に対して O(n) 時間で実行されます:

- **前方スキャン**: 各文字は1回だけ参照されます。
- **オーバーフロー時の後方検索**: 各文字は最大でもう1回だけ参照されます（償却計算量）。これは `lineStart` が単調増加するためです。
- 動的計画法やグローバル最適化は行いません。
- 10,000文字の章の場合、アルゴリズムが参照する位置は最大約20,000箇所です。

### 幅キャッシュ

`MejiroBrowser` はコードポイントレベルで文字幅をキャッシュします:

- キャッシュキー: `"${fontSize}px ${fontFamily}"` が `Map<codepoint, width>` にマッピングされます。
- 日本語テキストは通常2,000〜3,000種類のユニークな文字を使用するため、キャッシュはすぐに安定します。
- 章の初回レイアウト: `Canvas.measureText()` ですべての文字を計測します。
- 同じフォントでの以降のレイアウト: ほぼ瞬時（キャッシュヒット）。
- フォント変更時やメモリ集約的な操作の後は `clearCache()` を呼び出してください。

### ベンチマーク

```bash
yarn bench  # ベンチマークを実行
```

### ヒント

- **単一の `MejiroBrowser` インスタンスを再利用**して、レイアウト間で幅キャッシュを活用してください。
- **段落ごとの文字配列も必要なら `layoutParagraphs()` を使用**してください。段落を 1 つずつレイアウトする点は同じインスタンスで `layout()` をループで呼ぶのと同じで、共有するのはインスタンスの幅キャッシュだけです。加わるのは、改行位置と注釈が指す NFC 形の `chars` と、段落ごとのフォント上書きです。
- **初回レイアウト前に `preloadFont()` でフォントを事前計測**すると、体感パフォーマンスが向上します:

<!-- doc-example: 09-preload.ts#preload -->
```ts
const mejiro = new MejiroBrowser({
  fontFamily: '"Noto Serif JP"',
  fontSize: 16,
});

// アプリ初期化時にプリロード
await mejiro.preloadFont();

// 以降の layout 呼び出しではフォント読み込みステップをスキップ
const result = await mejiro.layout({ text, lineWidth: 400 });
```

---

## 4. サーバーサイド利用

コアモジュール（`@libraz/mejiro`）は DOM に一切依存せず、任意の JavaScript ランタイム（Node.js、Deno、Bun、エッジワーカー）で動作します。

<!-- doc-example: 09-headless.ts#headless -->
```ts
import { computeBreaks, getLineRanges, paginate, toCodepoints } from '@libraz/mejiro';

// Canvas が利用できないため、文字送り幅は自分で用意する必要があります
const text = toCodepoints('吾輩は猫である。名前はまだ無い。');
const advances = new Float32Array(text.length).fill(16); // 等幅の仮定

const result = computeBreaks({ text, advances, lineWidth: 128 });
const lines = getLineRanges(result.breakPoints, text.length);
const pages = paginate(400, [{ lineCount: lines.length, linePitch: 16 * 1.8, gapBefore: 0 }]);
```

サーバーでは `Canvas.measureText()` が利用できないため、文字送り幅を取得する方法には以下があります:

- **等幅の仮定** -- すべての CJK 文字が同じ文字送り幅を持つと仮定します。シンプルで、等幅フォントや固定レイアウトのシナリオでは十分な場合が多いです。
- **クライアントサイドでの事前計算** -- ブラウザで文字送り幅を計測し、サーバーに送信します。
- **フォントメトリクスライブラリ** -- fontkit や opentype.js などのライブラリを使い、フォントファイルから直接文字送り幅を計測します。

---

## 5. カスタムレンダリング

`RenderPage` は React や Vue に依存しないデータ構造です。付属コンポーネントを使わず、自分の描画先へ変換することもできます。

### RenderPage の構造

```ts
interface RenderPage {
  readonly paragraphs: readonly RenderParagraph[];
}

interface RenderParagraph {
  readonly lines: readonly RenderLine[];
  readonly headingLevel?: HeadingLevel;
  readonly kind?: ParagraphKind;
  readonly scale?: number;
}

interface RenderLine {
  readonly segments: readonly RenderSegment[];
}

type RenderSegment =
  | { type: 'text'; text: string }
  | { type: 'ruby'; text: string; rubyText: string; children?: readonly RenderSegment[] }
  | {
      type: 'emphasis';
      text: string;
      style: 'sesame' | 'dot' | 'circle';
      children?: readonly RenderSegment[];
    }
  | { type: 'tcy'; text: string; children?: readonly RenderSegment[] }
  | { type: 'em'; text: string; children?: readonly RenderSegment[] }
  | { type: 'strong'; text: string; children?: readonly RenderSegment[] }
  | { type: 'link'; text: string; href: string; title?: string; children?: readonly RenderSegment[] }
  | { type: 'footnote-ref'; text: string; noteId: string; children?: readonly RenderSegment[] };
```

どのバリアントも、その範囲全体を平坦化したテキストを `text` に持ちます（`ruby` では親文字）。`children` は同じ範囲を入れ子の注釈ごとに表します。描くのはどちらか一方だけで、両方は描きません。文字を描くだけの描画では `segment.text` を読み、`children` は無視します。

DOM へ出力する場合は `segmentToInlineNode()` を使ってください（[ページ分割と描画](07-pagination-and-rendering.md)を参照）。

### Canvas レンダリング

```ts
function renderToCanvas(ctx: CanvasRenderingContext2D, page: RenderPage): void {
  let x = ctx.canvas.width; // 右端から開始（vertical-rl）
  const lineHeight = 28.8;  // fontSize * lineHeight

  for (const paragraph of page.paragraphs) {
    for (const line of paragraph.lines) {
      x -= lineHeight;
      let y = 0;
      for (const segment of line.segments) {
        for (const char of segment.text) {
          ctx.fillText(char, x, y + 16);
          y += 16;
        }
        // ルビ本体・圏点・縦中横の回転描画は省略
      }
    }
  }
}
```

### 文字列出力（テスト・デバッグ用）

```ts
function renderToString(page: RenderPage): string {
  return page.paragraphs
    .map((p) =>
      p.lines
        .map((l) =>
          l.segments
            .map((s) => (s.type === 'ruby' ? `${s.text}(${s.rubyText})` : s.text))
            .join('')
        )
        .join('\n')
    )
    .join('\n\n');
}
```

---

## 6. 画像回り込み

mejiro は `ExclusionEngine` で、画像や図表などの矩形領域を避けながらテキストを流し込めます。

### 基本的な使い方

<!-- doc-example: 09-exclusion.ts#exclusion -->
```ts
import { computeBreaks, ExclusionEngine, toCodepoints } from '@libraz/mejiro';

const engine = new ExclusionEngine({
  lineWidth: 600, // 列の高さ（px）
  lineCount: 12, // 列数
  linePitch: 30.4, // fontSize × lineHeight
  contentWidth: 380, // 列に利用可能な幅（px）
});

// 画像を追加（コンテンツ領域座標系）
engine.addImage({ x: 100, y: 50, width: 120, height: 160 });
engine.addImage({ x: 50, y: 300, width: 80, height: 100 });

// 列スロットと行幅を計算
const { slots, lineWidths } = engine.compute();

// lineWidthsをレイアウトエンジンに渡す
const text = toCodepoints('...');
const advances = new Float32Array(text.length).fill(16);
const result = computeBreaks({
  text,
  advances,
  lineWidth: 600,
  lineWidths, // ExclusionEngineからの列ごとの幅
});

// 各列を slots[i].xPos, slots[i].yStart の位置に
// height = slots[i].height で描画
```

### 動作原理

1. 各列について、水平方向に重なるすべての画像領域を収集する。
2. 重なる領域をマージして非重複区間にする。
3. その区間の間に残る連続ギャップを**すべて**スロットにする（`minGapHeight`（既定は `linePitch`）以上の高さがあるものに限る）。画像に分断された列は上下 2 つのスロットを持ち、画像に完全に覆われた列はスロットを 1 つも持たない。
4. ギャップの高さがそのスロットの実効的な `lineWidth` となり、垂直位置（`yStart`）がテキストの描画開始位置を示す。
5. スロットは読み順で出力される。列は右から順に読み、1 つの列の中では画像の上の隙間から下の隙間へ進む。画像で途切れた行は同じ列のまま画像を越えて続き、その列を読み終えてから次の列へ移る。例外は、画像がページの全幅にまたがる場合である。すべての列で画像にふさがれている範囲があり、本文のある全列がその範囲の上下両方に本文を持つとき、その範囲がページを段に分ける。このときは上の段をページ全体にわたって読んでから下の段へ進み、各段の中では再び列ごとの順序に従う。

1 つの列が複数のスロットを生む場合も 0 個の場合もあるため、`slots.length` は `lineCount` とは対応せず、`slots[columnIndex]` という参照はできない（スロットの添字は行の番号である）。物理的な列は `xPos` ではなく `columnIndex` から復元する。上記の画像 2 枚の例では、12 列に対して 20 スロットが生成される。

### 座標系（縦書き）

`writing-mode: vertical-rl` の場合:
- **ブロック方向** = 水平（列は右から左に配置）
- **インライン方向** = 垂直（テキストは上から下に流れる）
- `ImageRect.x` / `.width` はブロック軸に対応
- `ImageRect.y` / `.height` はインライン軸に対応
- 座標は**コンテンツ領域**の原点（パディング後）からの相対値

### 動的な更新

`ExclusionEngine` はインタラクティブな用途（画像のドラッグ＆ドロップ配置など）向けに設計されています:

```ts
const engine = new ExclusionEngine(geometry);
const img = { x: 100, y: 50, width: 120, height: 160 };
engine.addImage(img);

// ドラッグ時: 座標を更新して再計算
img.x = 150;
img.y = 80;
const { slots, lineWidths } = engine.compute(); // サブミリ秒

// リサイズ時
engine.setGeometry({ ...geometry, lineWidth: 500 });
engine.compute();

// 画像の削除
engine.removeImage(img);
```

### 見開きレイアウト（2ページフロー）

テキストが見開き2ページにわたって流れる書籍スタイルのレイアウトには、`SpreadExclusionEngine` を使用します。ノド（背表紙側余白）の座標変換を自動で処理します:

<!-- doc-example: 09-spread-exclusion.ts#spread -->
```ts
import { computeBreaks, SpreadExclusionEngine } from '@libraz/mejiro';

const spread = new SpreadExclusionEngine({
  pageWidth: 537,
  paddingX: 52, // ノド側+小口側パディング
  paddingY: 56,
  lineWidth: 676,
  linePitch: 30.4,
});

// 画像は右ページの左上を基準に配置。
// 負のx値は自動的にノドのオフセットを考慮して左ページにマッピングされる。
spread.addImage({ x: 200, y: 100, width: 120, height: 160, inlineMargin: 16 });
spread.addImage({ x: -100, y: 300, width: 80, height: 100 }); // 左ページ

const { rightSlots, leftSlots, lineWidths } = spread.compute();

// 見開き全体で1回のcomputeBreaks呼び出し
const result = computeBreaks({ text, advances, lineWidth: 676, lineWidths });

// 行をページごとに分割してレンダリング:
// 行 0..rightSlots.length-1 → rightSlotsを使って右ページに描画
// 行 rightSlots.length..     → leftSlotsを使って左ページに描画
```

`ExclusionEngine` との主な違い:
- **ノドの自動処理** — 手動の座標変換が不要
- **連続テキストフロー** — 1つの `lineWidths` 配列が両ページにまたがる
- **分割レンダリング** — 先頭の `rightSlots.length` 行が右ページ、残りが左ページ

### ワンショット便利関数

画像が変化しない静的レイアウトには `computeExclusionSlots()` を使用:

```ts
import { computeExclusionSlots, computeBreaks } from '@libraz/mejiro';

const { slots, lineWidths } = computeExclusionSlots({
  lineWidth: 600,
  lineCount: 12,
  linePitch: 30.4,
  contentWidth: 380,
  images: [
    { x: 100, y: 50, width: 120, height: 160 },
  ],
});
```

---

## 7. 小説投稿サイトへの統合（実装ガイド）

mejiro は「縦書きで読む／書く／EPUB で持ち出す」までを担当するライブラリです。投稿サイトの全体像で言うと、mejiro がカバーするのはおおむね次の範囲です。

| サイトの機能 | mejiro が提供するもの | アプリ側で実装するもの |
|--------------|----------------------|-----------------------|
| 原稿入稿フォーム | `<MejiroManuscriptEditor>` / `useManuscriptDraft` / `parseManuscript()` | 認証、サーバ送信、下書き共有 |
| 縦書き本文表示 | `<MejiroReader>` / `useReadingPosition` | コメント欄、評価、シェア UI |
| 章/作品単位の EPUB 化 | `EpubProject.fromManuscript()` / `EditableEpub` | 生成タイミング、配信、署名付き URL |
| 既存 EPUB の校正 | `<MejiroEditor>` / `useEditableEpub` | ファイル ACL、版管理 |
| 1 章内検索 | `ChapterLayout.findText()` | 作品横断検索（後述） |
| 読書位置の保存 | `ReadingAnchor` / `useReadingPosition` | サーバ DB、デバイス同期 |
| 作品メタの正規化 | `EpubProjectMetadata` 型 | DB スキーマ、編集 UI |

実装の典型構成は次のとおりです。

```
[Author] ──→ MejiroManuscriptEditor ──→ EpubProject ──→ サーバ保存
                                                 └→ EPUB 出力（任意）

[Reader] ──→ MejiroReader  ←──── サーバ API（メタ + 章本文 or EPUB URL）
                ↑               ↓
        useReadingPosition ←→ サーバ DB（ReadingAnchor JSON）
```

### 7.1 原稿入稿フローの組み立て

`useManuscriptDraft` でローカル草稿状態を、`useEpubProject` で「章ドラフト → EPUB 生成」を担当させます。サーバへの保存は `buildProject()` から得たメタ・章 JSON をそのまま POST するのが最短です。`useEpubProject` が `metadata` と `chapters` オプションを読むのはマウント時の 1 回だけなので、その後の草稿の編集は `setChapters` でプロジェクトへ渡します。`save()` では、常に編集中の最新の章を保持している `draft.chapters` を送ります。

```tsx
import { useEffect } from 'react';
import { useEpubProject, useManuscriptDraft } from '@libraz/mejiro-react';

const draft = useManuscriptDraft({ initialChapters: saved.chapters });
const project = useEpubProject({
  metadata: { title: saved.title, language: 'ja' },
  chapters: draft.chapters, // { id, title, body } の配列
  debounceMs: 400,
  onPreview(book) {
    // 1段抽象上のプレビュー（EpubBook）を受け取れる
  },
});

// オプションは 1 回しか読まれないので、以降の草稿の編集をプロジェクトへ渡す
const { setChapters } = project;
useEffect(() => setChapters(draft.chapters), [draft.chapters, setChapters]);

async function save() {
  const built = project.buildProject();
  await fetch(`/api/works/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      metadata: built.metadata,
      chapters: draft.chapters, // 編集中の最新の章
    }),
  });
}
```

DB スキーマは `EpubProjectMetadata`（`title`, `creators`, `subjects`, `language`, `description` など）と `chapters: { id, title, body }[]` をそのまま JSON カラムに入れる方式が最も衝突が少なくなります。本文中のルビ・傍点・縦中横などは `body` プレーンテキスト中に `parseManuscript` 記法（`｜漢字《かんじ》`、`《《重要》》`、`〔20〕` 等）で残せます。

### 7.2 閲覧フロー（公開ページ）

「URL を渡すだけ」が最短です。EPUB をサーバで保管している場合は `epubUrl` を、メタを別 API から取得して本文 EPUB をストリーミングしたい場合は `epub`（事前 `parseEpub()` 結果）を渡す方式を選びます。

```tsx
<MejiroReader epubUrl={`/api/works/${slug}/epub`} title={work.title} />
```

#### 7.2.1 認証付き EPUB を渡す

ログイン中ユーザーだけが読める作品では、`fetchOptions` でクッキーや bearer を、`fetchEpub` で完全カスタム fetcher を差し込めます。

```tsx
<MejiroReader
  epubUrl={url}
  fetchOptions={{ credentials: 'include' }}
  // または
  fetchEpub={async (u) => {
    const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(await res.text());
    return res.arrayBuffer();
  }}
/>
```

#### 7.2.2 SSR でのファーストペイント

Canvas/FontFace を使う本ペース表示は基本的にクライアントで走りますが、`renderEpubStatic(chapter)` で「`writing-mode: vertical-rl` の素直な HTML 文字列」を生成できます。SSR ではこれを `fallback` プロップに渡しておくと、ハイドレーション完了までの間も本文が見える状態を作れます。

`parseEpub()` は XHTML の解析に `DOMParser` / `XMLSerializer` / `Node` を使いますが、素の Node にはいずれもありません。Server Component が動く前に DOM 実装を一度登録してください。登録がないと、不足しているものを名指ししたエラーで失敗します。

```ts
// instrumentation.ts など、最初の parseEpub 呼び出しより前に読み込まれるモジュール
import { Window } from 'happy-dom';

const window = new Window() as unknown as typeof globalThis;
globalThis.DOMParser = window.DOMParser;
globalThis.XMLSerializer = window.XMLSerializer;
globalThis.Node = window.Node;
```

<!-- doc-example: 09-ssr/page.tsx#server -->
```tsx
// app/works/[slug]/page.tsx（Server Component）
import { parseEpub } from '@libraz/mejiro/epub';
import { renderEpubStatic } from '@libraz/mejiro/render';
import { ReaderClient } from './ReaderClient';

export default async function ReaderPage({ params }: { params: { slug: string } }) {
  // fetchEpubBuffer() はサーバー側で EPUB のバイト列を読み込む処理を表す
  const buf = await fetchEpubBuffer(params.slug);
  const epub = await parseEpub(buf);
  // renderEpubStatic() の出力は parseEpub の結果から組み立てたもので、
  // 本文や属性をエスケープし、リンク href も安全な URL スキームに制限する。
  const initialHtml = renderEpubStatic(epub.chapters[0], { ariaLabel: epub.title });
  return <ReaderClient slug={params.slug} initialHtml={initialHtml} />;
}
```

<!-- doc-example: 09-ssr/ReaderClient.tsx#client -->
```tsx
// app/works/[slug]/ReaderClient.tsx（Client Component）
'use client';

import { MejiroReader } from '@libraz/mejiro-react';

// initialHtml は信頼できるソース（自前サーバーが renderEpubStatic で生成したもの）
// から渡す。ユーザーが書いた HTML を使う場合は、下の fallback ラッパーに渡す前に
// DOMPurify などでサニタイズする。
function StaticFallback({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

interface Props {
  slug: string;
  initialHtml: string;
}

export function ReaderClient({ slug, initialHtml }: Props) {
  return (
    <MejiroReader
      epubUrl={`/api/works/${slug}/epub`}
      fallback={<StaticFallback html={initialHtml} />}
    />
  );
}
```

`renderEpubStatic()` は計測やページ分割を行わず、ブラウザの縦書きフローに任せた素朴な HTML を返します。出力は内部で `escapeHtml` / `escapeAttr` され、`parseEpub()` 経由のリンクから `javascript:` などの実行可能スキームも落とされます。wrapper は実行時にも `div` / `article` / `section` に制限され、不正な値は `div` にフォールバックします。検索エンジン向けインデックス用や、低速回線でのプレースホルダとして十分使えます。

### 7.3 読書位置の永続化（サーバ同期）

`useReadingPosition` は内部的に `localStorage` 互換インターフェース（`getItem` / `setItem` / `removeItem`）を要求するだけなので、サーバ DB へ非同期保存するラッパーを書けばそのまま使えます。保存される値は `ReadingAnchor`（`{ chapterIndex, paragraphIndex, charIndex }`）のバージョン付き JSON 文字列で、フォントサイズや画面サイズの変更による再ページネーションに耐えます。

```ts
const remoteStorage: MejiroStorage = {
  getItem(k) {
    return cachedSnapshot[k] ?? null; // 起動時にプリフェッチした値を返す
  },
  setItem(k, v) {
    cachedSnapshot[k] = v;
    void fetch(`/api/reading-position/${encodeURIComponent(k)}`, {
      method: 'PUT',
      body: v,
      keepalive: true,
    });
  },
  removeItem(k) {
    delete cachedSnapshot[k];
    void fetch(`/api/reading-position/${encodeURIComponent(k)}`, { method: 'DELETE' });
  },
};

const { position, save } = useReadingPosition({
  key: `mejiro:position:${userId}:${bookId}`,
  storage: remoteStorage,
  debounceMs: 1000,
  onError: (error) => reportToMonitoring(error),
});
```

`debounceMs` は debounce の待ち時間です。最後の `save()` からこの時間が経つと、`storage.setItem` に最新の値が渡されます。保留中の書き込みは、ページを隠すとき・`key` の変更時・アンマウント時にまとめて書き出されます。例外を投げたストレージは `storage-read-failed` / `storage-write-failed` として `onError` に報告され、`onError` がなければフックが `console.warn` に出します。

複数デバイス同期は「`setItem` で書く前にサーバの最新 `updatedAt` と比較する」など、`storage` 側で完結させるのが扱いやすいです。

### 7.4 画像アセットの配信（assetResolver）

投稿サイトのように画像を S3/CloudFront などの外部ストレージへ寄せたい場合、`EditableImageAsset.data`（バイト）の代わりに `url` を登録しておき、EPUB 書き出し時にだけ実体を fetch する運用ができます。`addImage` には `{ filename, data }` の代わりに `{ filename, url }` を渡せます。

```ts
editor.addImage(0, {
  filename: 'figure-01.png',
  url: 'https://cdn.example.com/works/1/figure-01.png',
  alt: '挿絵',
});

// 書き出し時に外部 URL からバイトを取得
const bytes = await editor.export({
  assetResolver: async ({ href, url, signal }) => {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!res.ok) throw new Error(`asset fetch failed: ${href} (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  },
});
```

`assetResolver` を省略するとランタイムの `fetch(url, { signal })` がそのまま使われます。S3 SDK で署名付き URL を都度生成したり、IndexedDB キャッシュからオフラインで返したりといった用途では明示的にラッパーを書いてください。

同じ仕組みは `EpubProject`（manuscript-to-EPUB 経路。`addAsset`・`addImage`・`setCover` で `data` の代わりに `url` を渡す）にも適用されます。`<MejiroEditor>` と `useEditableEpub` は `editor.addImage({ filename, url })`、`useEpubProject` は自身の `setCover` / `setAssets` で URL だけのアセットを登録できます。いずれも `assetResolver` をプロップ・オプションとして受け取り、内部の `editor.export()` / `project.export()` 呼び出しへ渡すため、URL の解決は EPUB 組み立て時にだけ走ります。

```ts
const project = useEpubProject({
  assetResolver: async ({ url, signal }) => (await fetch(url, { signal })).arrayBuffer(),
});

project.setCover({ url: 'https://cdn.example.com/works/1/cover.jpg', mediaType: 'image/jpeg' });
const bytes = await project.exportEpub(); // ここで初めてカバー画像を取得
```

1 つのリゾルバで両方の経路をまかなえます。`AssetResolverRequest` が持つのは、`url`、`href`（書き出した EPUB 内でバイト列を書き込む ZIP パス。どちらの経路でも同じ意味）、資産が宣言していれば `mediaType`、書き出しの `signal` です:

```ts
const resolver: AssetResolver = async ({ href, url, mediaType, signal }) => {
  const res = await fetch(url, { signal, headers: mediaType ? { Accept: mediaType } : {} });
  if (!res.ok) throw new Error(`asset fetch failed: ${href} ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};
```

注意点:

- 資産が持つのは `data` か `url` のどちらか一方です。入力の型は両方を同時に持てない共用体になっています。どちらも持たない画像・表紙・資産を追加すると `TypeError` を投げます。
- 既定の `fetch` は失敗のステータスを `MejiroError` `asset-fetch-failed` として報告します。独自のリゾルバが投げた例外は、そのまま書き出しを reject させます。
- `assetResolver` には export と同じ `AbortSignal` がそのまま渡るため、長時間 fetch を停止可能です。

### 7.5 サイト横断検索

`ChapterLayout.findText()` は **現在の章 1 つだけ** を検索対象とします。「作品横断 / 作者横断 / 全文検索」を実装する場合は、サーバ側で別エンジン（Meilisearch / Elasticsearch / PostgreSQL `pg_trgm` / SQLite FTS5 など）にインデックスを保持し、ヒットを `ReadingAnchor` 形（`{ chapterIndex, paragraphIndex, charIndex }`）に解決してからリーダーへ渡してください。MySQL を主 DB に採用している場合は、binlog レプリケーションでインメモリ n-gram 索引を同期する [MygramDB](https://github.com/libraz/mygram-db) を間に挟むと、CJK 全文検索をサブミリ秒に抑えつつ MySQL を権威データとして残せます。

```ts
// 検索 API → ReadingAnchor を返す
const hits = await searchApi(query); // { workId, anchor: ReadingAnchor, snippet }[]

// クリックで該当箇所へジャンプ
const reader = useRef<MejiroReaderHandle>(null);
reader.current?.goToAnchor(hits[0].anchor);
```

インデックス化のソースは「`ManuscriptChapter.body`（パイプルビ等の記法込み）」または「`parseEpub()` で抽出済みの段落テキスト」のどちらかを採用すると、`charIndex` の整合性が取りやすくなります。

### 7.6 スコープ外の領域（mejiro が扱わないもの）

| 領域 | 推奨アプローチ |
|------|---------------|
| 共同編集・競合解決（CRDT/OT） | `EditableEpub` は単一エディタ前提。複数人同時編集は Yjs / Automerge などを `body` プレーンテキスト層で運用し、保存時に EpubProject へ流す構成が現実的。 |
| バージョン履歴・差分表示 | 段落 ID（`EditableParagraphBlock.id`）が永続化されるため、これをキーに自前で差分を取る。 |
| コメント・評価・通報 | `<MejiroReader>` には組み込まれていない。`ReadingAnchor` 範囲をコメント DB の主キーに使うと「本文中の特定位置に紐づくコメント」を作りやすい。 |
| 認証・課金・通知 | 完全にサイト側責務。 |
| 画像アップローダ／プレビュー | `prepareImage()`（`@libraz/mejiro/image`）でクライアント縮小は可能。サーバアップローダは別途。 |

---

## 関連ドキュメント

- [03-line-breaking.md](./03-line-breaking.md) -- 改行アルゴリズム、禁則モード、ぶら下げ組み
- [05-browser-integration.md](./05-browser-integration.md) -- MejiroBrowser、フォント計測、幅キャッシュ
- [08-react-and-vue.md](./08-react-and-vue.md) -- RenderPage 用の React / Vue コンポーネント
- [02-core-concepts.md](./02-core-concepts.md) -- アーキテクチャ、データフロー、TypedArray の規約
