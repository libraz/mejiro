import type { ManuscriptDialect } from './manuscript.js';

/** Kinds of notation tokens recognized in manuscript source. */
export type ManuscriptTokenKind =
  | 'ruby'
  | 'emphasis'
  | 'tcy'
  | 'em'
  | 'strong'
  | 'link'
  | 'footnote';

/** A notation token located in manuscript source by `[start, end)` char range. */
export interface ManuscriptToken {
  kind: ManuscriptTokenKind;
  /** Inclusive start index (in code units of the source string). */
  start: number;
  /** Exclusive end index (in code units of the source string). */
  end: number;
}

const AUTO_RUBY = /([\p{Script=Han}々〆ヶ]+)《([^》]+)》/u;
const TCY_BODY = /^[A-Za-z0-9!?]+$/;

/**
 * Locates manuscript-notation tokens in source text. Designed for syntax
 * highlighting overlays — token ranges are in **source** positions (with
 * markup characters intact), unlike {@link parseManuscript} whose output
 * positions are in the rendered plain text.
 *
 * The set of recognized tokens follows the same dialect rules as
 * {@link parseManuscript}.
 */
export function tokenizeManuscriptSource(
  text: string,
  dialect: ManuscriptDialect = 'mejiro',
): ManuscriptToken[] {
  const tokens: ManuscriptToken[] = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] === '｜') {
      const closeBase = text.indexOf('《', i + 1);
      const closeRuby = closeBase >= 0 ? text.indexOf('》', closeBase + 1) : -1;
      if (closeBase > i && closeRuby > closeBase) {
        tokens.push({ kind: 'ruby', start: i, end: closeRuby + 1 });
        i = closeRuby + 1;
        continue;
      }
    }

    if (dialect === 'mejiro' && text.startsWith('《《', i)) {
      const close = text.indexOf('》》', i + 2);
      if (close > i) {
        tokens.push({ kind: 'emphasis', start: i, end: close + 2 });
        i = close + 2;
        continue;
      }
    }

    const auto = text.slice(i).match(AUTO_RUBY);
    if (auto && auto.index === 0) {
      tokens.push({ kind: 'ruby', start: i, end: i + auto[0].length });
      i += auto[0].length;
      continue;
    }

    if (dialect === 'mejiro') {
      if (text[i] === '〔') {
        const close = text.indexOf('〕', i + 1);
        if (close > i && close - i <= 6) {
          const body = text.slice(i + 1, close);
          if (TCY_BODY.test(body)) {
            tokens.push({ kind: 'tcy', start: i, end: close + 1 });
            i = close + 1;
            continue;
          }
        }
      }

      if (text.startsWith('[[#', i)) {
        const close = text.indexOf(']]', i + 3);
        if (close > i) {
          tokens.push({ kind: 'footnote', start: i, end: close + 2 });
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
            tokens.push({ kind: 'link', start: i, end: closeTarget + 1 });
            i = closeTarget + 1;
            continue;
          }
        }
      }

      if (text.startsWith('**', i)) {
        const close = text.indexOf('**', i + 2);
        if (close > i && close - i > 2) {
          tokens.push({ kind: 'strong', start: i, end: close + 2 });
          i = close + 2;
          continue;
        }
      }

      if (text[i] === '*') {
        const close = text.indexOf('*', i + 1);
        if (close > i && close - i > 1) {
          const body = text.slice(i + 1, close);
          if (!body.includes('*')) {
            tokens.push({ kind: 'em', start: i, end: close + 1 });
            i = close + 1;
            continue;
          }
        }
      }
    }

    i++;
  }

  return tokens;
}
