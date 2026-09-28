import { describe, expect, it } from 'vitest';
import {
  mediaTypeFromPath,
  relativeZipPath,
  uniqueManifestId,
} from '../../src/epub/package-paths.js';

describe('package-paths', () => {
  it('resolves ZIP paths relative to a directory', () => {
    expect(relativeZipPath('OPS/Text/', 'OPS/Images/a.png')).toBe('../Images/a.png');
    expect(relativeZipPath('OPS/Text/', 'OPS/Text/a.png')).toBe('a.png');
    expect(relativeZipPath('OPS/', 'OPS/Images/sub/a.png')).toBe('Images/sub/a.png');
    expect(relativeZipPath('', 'OPS/a.png')).toBe('OPS/a.png');
  });

  it('suffixes manifest ids until they are free', () => {
    expect(uniqueManifestId('img', [])).toBe('img');
    expect(uniqueManifestId('img', ['img', undefined, 'img-2'])).toBe('img-3');
  });

  it('maps every known extension case-insensitively', () => {
    expect(
      ['a.JPG', 'a.jpeg', 'a.png', 'a.gif', 'a.svg', 'a.webp', 'a.css', 'a.bin'].map(
        mediaTypeFromPath,
      ),
    ).toEqual([
      'image/jpeg',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/svg+xml',
      'image/webp',
      'text/css',
      'application/octet-stream',
    ]);
  });
});
