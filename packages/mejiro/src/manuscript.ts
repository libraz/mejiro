import type { InlineAnnotation, InlineRubyAnnotation } from './browser/types.js';
import { sanitizeUrl } from './url.js';

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

/**
 * Aozora-style auto ruby (`漢字《かんじ》`), matched sticky at a walk position.
 *
 * The leading lookbehind restricts matches to the first character of a base
 * run. Inside a run a match would imply a match at the run start, which a
 * position-by-position walk has already tried, so nothing is missed — and base
 * runs that carry no ruby are rejected in constant time instead of being
 * re-scanned from every position.
 */
export const AUTO_RUBY = /(?<![\p{Script=Han}々〆ヶ])([\p{Script=Han}々〆ヶ]+)《([^《》]+)》/uy;
const TCY_BODY = /^[A-Za-z0-9!?]+$/;

/** Locates manuscript markers ahead of a forward-only walk over one source string. */
export interface ManuscriptMarkerScanner {
  /**
   * Returns the index of the first occurrence of `search` at or after `from`,
   * or `-1` when there is none before the end of the line holding `from`.
   *
   * @param search - Marker to look for.
   * @param from - Walk position to search from; callers must move it forward.
   */
  find(search: string, from: number): number;
}

/**
 * Creates a marker scanner bound to `text`.
 *
 * Manuscript notation is line-scoped, so an unclosed marker must not cost a
 * full-text scan at every position. The scanner remembers the latest lookup per
 * marker and reuses it while the walk has not passed it, which keeps the total
 * scanning cost linear in `text.length` whatever markers the source contains.
 *
 * @param text - Source string to scan.
 * @returns A scanner for that string.
 */
export function createMarkerScanner(text: string): ManuscriptMarkerScanner {
  const lastFind = new Map<string, { from: number; index: number }>();

  const indexOfFrom = (search: string, from: number): number => {
    const cached = lastFind.get(search);
    // Nothing occurs in [cached.from, from), so the first occurrence at or
    // after `from` is still the cached one — or there is none at all.
    if (cached && from >= cached.from && (cached.index < 0 || from <= cached.index)) {
      return cached.index;
    }
    const index = text.indexOf(search, from);
    lastFind.set(search, { from, index });
    return index;
  };

  return {
    find(search: string, from: number): number {
      const index = indexOfFrom(search, from);
      if (index < 0) return -1;
      const lineEnd = indexOfFrom('\n', from);
      return lineEnd >= 0 && lineEnd < index ? -1 : index;
    },
  };
}

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
  text = text.normalize('NFC');
  const dialect = options.dialect ?? 'mejiro';
  const scanner = createMarkerScanner(text);
  const inlineAnnotations: InlineAnnotation[] = [];
  let out = '';
  let i = 0;

  const charCount = (str: string): number => [...str].length;

  while (i < text.length) {
    if (text[i] === '｜' || text[i] === '|') {
      const closeBase = scanner.find('《', i + 1);
      const closeRuby = closeBase >= 0 ? scanner.find('》', closeBase + 1) : -1;
      const rubyText = closeRuby > closeBase ? text.slice(closeBase + 1, closeRuby) : '';
      if (closeBase > i && rubyText && !rubyText.includes('《')) {
        addRuby(text.slice(i + 1, closeBase), rubyText);
        i = closeRuby + 1;
        continue;
      }
    }

    if (dialect === 'mejiro' && text.startsWith('《《', i)) {
      const close = scanner.find('》》', i + 2);
      if (close > i + 2) {
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

    AUTO_RUBY.lastIndex = i;
    const auto = AUTO_RUBY.exec(text);
    if (auto) {
      addRuby(auto[1], auto[2]);
      i += auto[0].length;
      continue;
    }

    if (dialect === 'mejiro') {
      if (text[i] === '〔') {
        const close = scanner.find('〕', i + 1);
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
        const close = scanner.find(']]', i + 3);
        if (close > i + 3) {
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
        const closeLabel = scanner.find(']', i + 1);
        const openTarget = closeLabel >= 0 ? closeLabel + 1 : -1;
        if (closeLabel > i && text[openTarget] === '(') {
          const closeTarget = scanner.find(')', openTarget + 1);
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
        const close = scanner.find('**', i + 2);
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
        const close = scanner.find('*', i + 1);
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

/**
 * Parses the target part of a manuscript link notation.
 *
 * Accepts a bare URL, optionally followed by whitespace and a double-quoted
 * title (`https://example.com "Example"`). The URL itself may not contain
 * whitespace, and the title may not contain a double quote, so a target that
 * does not match that shape is rejected outright rather than partially parsed.
 *
 * The URL is passed through {@link sanitizeUrl}, so a scheme the sanitizer
 * refuses — `javascript:` and friends — yields `null` instead of an entry with
 * an unsafe `href`. Callers can therefore treat a non-null result as safe to put
 * in an anchor without re-checking.
 *
 * @param raw - Target text between the notation's delimiters. Surrounding
 *   whitespace is trimmed before parsing.
 * @returns The sanitized `href` plus the optional `title`, or `null` when the
 *   target is empty, malformed, or rejected by the sanitizer. `title` is absent
 *   rather than empty when no quoted title was given.
 */
export function parseLinkTarget(raw: string): { href: string; title?: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\S+)(?:\s+"([^"]+)")?$/u);
  if (!match) return null;
  const href = sanitizeUrl(match[1]);
  if (!href) return null;
  return match[2] ? { href, title: match[2] } : { href };
}

/**
 * Aozora-style ruby parser kept for compatibility with callers written against
 * the ruby-only manuscript API. Equivalent to
 * `parseManuscript(text, { dialect: 'narou' })` filtered to ruby annotations.
 *
 * @deprecated Use `parseManuscript`. Removal is deferred to a future major
 * release; no removal version is scheduled.
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
