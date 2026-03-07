# mejiro ドキュメント

Web向け日本語縦書き組版エンジン — 改行処理、禁則処理、ぶら下げ組み、ルビ（振り仮名）、ページネーション。

## ドキュメント

| # | タイトル | 説明 |
|---|---|---|
| 01 | [はじめに](01-getting-started.md) | インストールと最初のレイアウト |
| 02 | [コアコンセプト](02-core-concepts.md) | アーキテクチャ、データフロー、TypedArray |
| 03 | [改行処理](03-line-breaking.md) | computeBreaks、禁則処理、ぶら下げ組み |
| 04 | [ルビ](04-ruby.md) | ルビ（振り仮名）注釈 |
| 05 | [ブラウザ統合](05-browser-integration.md) | MejiroBrowser、フォント計測 |
| 06 | [EPUB](06-epub.md) | EPUB解析とルビ抽出 |
| 07 | [ページネーションとレンダリング](07-pagination-and-rendering.md) | paginate、buildRenderPage、CSS |
| 08 | [ReactとVue](08-react-and-vue.md) | フレームワークコンポーネント |
| 09 | [応用](09-advanced.md) | カスタム禁則、トークン境界、パフォーマンス |
| 10 | [APIリファレンス](10-api-reference.md) | 完全なAPIリファレンス |

## 何を読むべきか

**ReactやVueで縦書きテキストを表示したい**
→ [はじめに](01-getting-started.md) → [ReactとVue](08-react-and-vue.md)

**改行アルゴリズムを理解したい**
→ [コアコンセプト](02-core-concepts.md) → [改行処理](03-line-breaking.md)

**EPUBを縦書きで表示したい**
→ [はじめに](01-getting-started.md) → [EPUB](06-epub.md) → [ページネーションとレンダリング](07-pagination-and-rendering.md)

**ブラウザなしでコアエンジンを使いたい**
→ [コアコンセプト](02-core-concepts.md) → [応用](09-advanced.md)

---

[← READMEに戻る](../../README_ja.md)
