import type { InlineAnnotation, InlineRubyAnnotation } from './browser/types.js';

/**
 * Manuscript notation dialect. Selects which inline markers are recognized.
 *
 * - `narou` / `kakuyomu` — Aozora-style ruby only (`｜base《ruby》` and
 *   `漢字《かんじ》`). Other markers pass through as plain text.
 * - `mejiro` (default) — adds emphasis dots (`《《text》》`), tate-chu-yoko
 *   (`〔20〕`), markdown-style `*em*` / `**strong**`, and footnote refs
 *   (`[[#id]]`).
 */
export type ManuscriptDialect = 'narou' | 'kakuyomu' | 'mejiro';

/** Options for parseManuscript. */
export interface ParseManuscriptOptions {
  /** Notation dialect. Defaults to `'mejiro'`. */
  dialect?: ManuscriptDialect;
}

const AUTO_RUBY = /^([\p{Script=Han}々〆ヶ]+)《([^》]+)》/u;
const TCY_BODY = /^[A-Za-z0-9!?]+$/;

/**
 * Parses a manuscript paragraph into base text and inline annotations.
 *
 * Supports the full `InlineAnnotation` set (ruby, emphasis dots,
 * tate-chu-yoko, em/strong, footnote refs) under the `'mejiro'` dialect;
 * narrower dialects (`'narou'` / `'kakuyomu'`) keep markup compatible with
 * those sites by emitting only ruby annotations.
 */
export function parseManuscript(
  text: string,
  options: ParseManuscriptOptions = {},
): { text: string; inlineAnnotations: InlineAnnotation[] } {
  const dialect = options.dialect ?? 'mejiro';
  const inlineAnnotations: InlineAnnotation[] = [];
  let out = '';
  let i = 0;

  const charCount = (str: string): number => [...str].length;

  while (i < text.length) {
    if (text[i] === '｜') {
      const closeBase = text.indexOf('《', i + 1);
      const closeRuby = closeBase >= 0 ? text.indexOf('》', closeBase + 1) : -1;
      if (closeBase > i && closeRuby > closeBase) {
        addRuby(text.slice(i + 1, closeBase), text.slice(closeBase + 1, closeRuby));
        i = closeRuby + 1;
        continue;
      }
    }

    if (dialect === 'mejiro' && text.startsWith('《《', i)) {
      const close = text.indexOf('》》', i + 2);
      if (close > i) {
        const body = text.slice(i + 2, close);
        const startIndex = charCount(out);
        out += body;
        inlineAnnotations.push({
          kind: 'emphasis',
          startIndex,
          endIndex: charCount(out),
          style: 'sesame',
        });
        i = close + 2;
        continue;
      }
    }

    const auto = text.slice(i).match(AUTO_RUBY);
    if (auto) {
      addRuby(auto[1], auto[2]);
      i += auto[0].length;
      continue;
    }

    if (dialect === 'mejiro') {
      if (text[i] === '〔') {
        const close = text.indexOf('〕', i + 1);
        if (close > i && close - i <= 6) {
          const body = text.slice(i + 1, close);
          if (TCY_BODY.test(body)) {
            const startIndex = charCount(out);
            out += body;
            inlineAnnotations.push({
              kind: 'tcy',
              startIndex,
              endIndex: charCount(out),
            });
            i = close + 1;
            continue;
          }
        }
      }

      if (text.startsWith('[[#', i)) {
        const close = text.indexOf(']]', i + 3);
        if (close > i) {
          const id = text.slice(i + 3, close);
          const startIndex = charCount(out);
          out += `*${id}`;
          inlineAnnotations.push({
            kind: 'footnote',
            startIndex,
            endIndex: charCount(out),
            noteId: id,
          });
          i = close + 2;
          continue;
        }
      }

      if (text[i] === '[') {
        const closeLabel = text.indexOf(']', i + 1);
        const openTarget = closeLabel >= 0 ? closeLabel + 1 : -1;
        if (closeLabel > i && text[openTarget] === '(') {
          const closeTarget = text.indexOf(')', openTarget + 1);
          if (closeTarget > openTarget + 1) {
            const target = parseLinkTarget(text.slice(openTarget + 1, closeTarget));
            if (target) {
              const body = text.slice(i + 1, closeLabel);
              const startIndex = charCount(out);
              out += body;
              inlineAnnotations.push({
                kind: 'link',
                startIndex,
                endIndex: charCount(out),
                href: target.href,
                ...(target.title ? { title: target.title } : {}),
              });
              i = closeTarget + 1;
              continue;
            }
          }
        }
      }

      if (text.startsWith('**', i)) {
        const close = text.indexOf('**', i + 2);
        if (close > i && close - i > 2) {
          const body = text.slice(i + 2, close);
          const startIndex = charCount(out);
          out += body;
          inlineAnnotations.push({
            kind: 'strong',
            startIndex,
            endIndex: charCount(out),
          });
          i = close + 2;
          continue;
        }
      }

      if (text[i] === '*') {
        const close = text.indexOf('*', i + 1);
        if (close > i && close - i > 1) {
          const body = text.slice(i + 1, close);
          if (!body.includes('*')) {
            const startIndex = charCount(out);
            out += body;
            inlineAnnotations.push({
              kind: 'em',
              startIndex,
              endIndex: charCount(out),
            });
            i = close + 1;
            continue;
          }
        }
      }
    }

    out += text[i];
    i++;
  }

  return { text: out, inlineAnnotations };

  function addRuby(base: string, rubyText: string): void {
    const startIndex = charCount(out);
    out += base;
    const endIndex = charCount(out);
    inlineAnnotations.push({
      kind: 'ruby',
      startIndex,
      endIndex,
      rubyText,
      type: endIndex - startIndex === 1 ? 'mono' : 'group',
    });
  }
}

function parseLinkTarget(raw: string): { href: string; title?: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\S+)(?:\s+"([^"]+)")?$/u);
  if (!match) return null;
  return match[2] ? { href: match[1], title: match[2] } : { href: match[1] };
}

/**
 * Aozora-style ruby parser kept for v0.4 compatibility. Equivalent to
 * `parseManuscript(text, { dialect: 'narou' })` filtered to ruby annotations.
 *
 * @deprecated Use parseManuscript; this function will be removed in v0.6.
 */
export function parseManuscriptRuby(text: string): {
  text: string;
  inlineAnnotations: InlineRubyAnnotation[];
} {
  const result = parseManuscript(text, { dialect: 'narou' });
  return {
    text: result.text,
    inlineAnnotations: result.inlineAnnotations.filter(
      (ann): ann is InlineRubyAnnotation => ann.kind === 'ruby',
    ),
  };
}
