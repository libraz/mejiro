import { describe, expect, it } from 'vitest';
import { extractStylesheetLinks, stripStylesheetLinks } from '../../src/epub/xml-utils.js';
import { expectElapsedUnder } from '../timing.js';

describe('stripStylesheetLinks', () => {
  it('removes stylesheet links written as self-closing, bare and explicitly closed tags', () => {
    const xhtml = `<html><head>
<link rel="stylesheet" href="a.css"/>
<link rel="stylesheet" href="b.css">
<link rel="stylesheet" href="c.css"></link>
<link rel=stylesheet href="d.css">
<LINK REL="STYLESHEET" href="e.css">
<link rel="next" href="next.xhtml"/>
</head><body><p>本文</p></body></html>`;

    const stripped = stripStylesheetLinks(xhtml);

    expect(stripped).not.toContain('stylesheet');
    expect(stripped).not.toContain('</link>');
    expect(stripped).toContain('<link rel="next" href="next.xhtml"/>');
    expect(stripped).toContain('<p>本文</p>');
  });

  it('leaves input without stylesheet links untouched', () => {
    const xhtml = '<html><head><link rel="icon" href="i.png"/></head><body/></html>';
    expect(stripStylesheetLinks(xhtml)).toBe(xhtml);
    expect(extractStylesheetLinks(xhtml)).toEqual([]);
  });

  it('returns the removed tags so callers can restore them', () => {
    const xhtml =
      '<head><link rel="stylesheet" href="a.css"/><link rel="stylesheet" href="b.css"></link></head>';

    const links = extractStylesheetLinks(xhtml);

    expect(links).toEqual([
      '<link rel="stylesheet" href="a.css"/>',
      '<link rel="stylesheet" href="b.css"></link>',
    ]);
    expect(stripStylesheetLinks(xhtml)).toBe('<head></head>');
  });

  it('completes in linear time on unterminated link tags', () => {
    // Over 1 MB of `<link` starts with no closing `>` anywhere in the document.
    const xhtml = '<link '.repeat(175_000);
    expect(xhtml.length).toBeGreaterThan(1_000_000);

    const started = performance.now();
    const stripped = stripStylesheetLinks(xhtml);
    const links = extractStylesheetLinks(xhtml);
    const elapsed = performance.now() - started;

    expect(stripped).toBe(xhtml);
    expect(links).toEqual([]);
    expectElapsedUnder(elapsed, 1_000);
  });

  it('completes in linear time on many unterminated tags followed by a stylesheet link', () => {
    const noise = '<link '.repeat(175_000);
    const xhtml = `${noise}<link rel="stylesheet" href="a.css">`;

    const started = performance.now();
    const stripped = stripStylesheetLinks(xhtml);
    const elapsed = performance.now() - started;

    // The unterminated starts are part of the tag that finally closes.
    expect(stripped).toBe('');
    expectElapsedUnder(elapsed, 1_000);
  });
});
