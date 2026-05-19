# mejiro ドキュメント

mejiro は、Web で日本語の縦書きを扱うための組版エンジンです。改行、禁則処理、ぶら下げ、ルビ、ページ分割、EPUB の読み書き、静的レンダリング、React / Vue 向けのリーダー・エディタコンポーネントをまとめて扱えます。

## ドキュメント

| # | タイトル | 説明 |
|---|---|---|
| 01 | [はじめに](01-getting-started.md) | インストールと最初のレイアウト |
| 02 | [コアコンセプト](02-core-concepts.md) | アーキテクチャ、データフロー、TypedArray |
| 03 | [改行処理](03-line-breaking.md) | computeBreaks、禁則処理、ぶら下げ組み |
| 04 | [ルビ](04-ruby.md) | ルビ（振り仮名）注釈 |
| 05 | [ブラウザ統合](05-browser-integration.md) | MejiroBrowser とフォント計測 |
| 06 | [EPUB](06-epub.md) | EPUB の解析、編集、ルビ抽出 |
| 07 | [ページ分割とレンダリング](07-pagination-and-rendering.md) | paginate、buildRenderPage、CSS |
| 08 | [React と Vue](08-react-and-vue.md) | React / Vue コンポーネント |
| 09 | [応用](09-advanced.md) | カスタム禁則、トークン境界、パフォーマンス、画像回り込み、見開きレイアウト |
| 10 | [API リファレンス](10-api-reference.md) | 公開 API 一覧 |

## 何を読むべきか

**まず EPUB を縦書きで表示したい**
→ [はじめに](01-getting-started.md) → [API リファレンス](10-api-reference.md) の `MejiroBook`

**React や Vue でリーダーを組み込みたい**
→ [はじめに](01-getting-started.md) → [React と Vue](08-react-and-vue.md)

**改行アルゴリズムを理解したい**
→ [コアコンセプト](02-core-concepts.md) → [改行処理](03-line-breaking.md)

**EPUB の中身や変換の流れを知りたい**
→ [EPUB](06-epub.md) → [ページ分割とレンダリング](07-pagination-and-rendering.md)

**ブラウザなしでコアエンジンを使いたい**
→ [コアコンセプト](02-core-concepts.md) → [応用](09-advanced.md)

**画像の周りにテキストを回り込ませたい**
→ [API リファレンス](10-api-reference.md) の `MejiroBook` + `layout.setImages()`、または低レベル制御は [応用](09-advanced.md)

**v0.5 のリーダー / エディタ UI を確認したい**
→ [React と Vue](08-react-and-vue.md) → [API リファレンス](10-api-reference.md)

---

[← README に戻る](../../README_ja.md)
