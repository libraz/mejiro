import { describe, expect, it } from 'vitest';
import { sanitizeUrl } from '../src/url.js';

describe('sanitizeUrl', () => {
  it('keeps the schemes that are safe in an href', () => {
    expect(sanitizeUrl('https://example.test/a?b=1#c')).toBe('https://example.test/a?b=1#c');
    expect(sanitizeUrl('http://example.test')).toBe('http://example.test');
    expect(sanitizeUrl('mailto:reader@example.test')).toBe('mailto:reader@example.test');
    expect(sanitizeUrl('HTTPS://example.test')).toBe('HTTPS://example.test');
  });

  it('keeps scheme-relative, absolute and relative references', () => {
    expect(sanitizeUrl('//example.test/a')).toBe('//example.test/a');
    expect(sanitizeUrl('/chapter-2.xhtml')).toBe('/chapter-2.xhtml');
    expect(sanitizeUrl('../Text/chapter-2.xhtml')).toBe('../Text/chapter-2.xhtml');
    expect(sanitizeUrl('chapter-2.xhtml#note')).toBe('chapter-2.xhtml#note');
  });

  it('keeps a non-empty fragment and rejects a bare hash', () => {
    expect(sanitizeUrl('#note-1')).toBe('#note-1');
    expect(sanitizeUrl('#')).toBeNull();
  });

  it('rejects executable and otherwise unsupported schemes', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeUrl('JaVaScRiPt:alert(1)')).toBeNull();
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(sanitizeUrl('vbscript:msgbox(1)')).toBeNull();
    expect(sanitizeUrl('file:///etc/passwd')).toBeNull();
    expect(sanitizeUrl('blob:https://example.test/uuid')).toBeNull();
  });

  it('rejects a scheme hidden behind surrounding whitespace', () => {
    expect(sanitizeUrl('  javascript:alert(1)  ')).toBeNull();
    expect(sanitizeUrl('\tjavascript:alert(1)')).toBeNull();
    expect(sanitizeUrl('\njavascript:alert(1)')).toBeNull();
  });

  it('trims a URL it accepts', () => {
    expect(sanitizeUrl('  https://example.test  ')).toBe('https://example.test');
  });

  it('rejects a scheme split by control characters a browser would strip', () => {
    // A browser removes these before it parses the scheme, so the surviving
    // string runs as javascript: even though the raw text does not match it.
    expect(sanitizeUrl('java\u0000script:alert(1)')).toBeNull();
    expect(sanitizeUrl('java\nscript:alert(1)')).toBeNull();
    expect(sanitizeUrl('java\tscript:alert(1)')).toBeNull();
    expect(sanitizeUrl('java\rscript:alert(1)')).toBeNull();
    expect(sanitizeUrl('java\u000bscript:alert(1)')).toBeNull();
  });

  it('rejects control characters anywhere in an otherwise safe URL', () => {
    expect(sanitizeUrl('https://example.test/\u0000')).toBeNull();
    expect(sanitizeUrl('https://example.test/\u001f')).toBeNull();
    expect(sanitizeUrl('https://example.test/\u007f')).toBeNull();
  });

  it('rejects empty and whitespace-only input', () => {
    expect(sanitizeUrl('')).toBeNull();
    expect(sanitizeUrl('   ')).toBeNull();
  });

  it('does not read a colon after a non-scheme prefix as a scheme', () => {
    expect(sanitizeUrl('./a:b/c')).toBe('./a:b/c');
    expect(sanitizeUrl('1abc:def')).toBe('1abc:def');
  });
});
