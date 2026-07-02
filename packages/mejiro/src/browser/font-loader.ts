/**
 * Manages font loading via the CSS Font Loading API.
 * Ensures fonts are fully loaded before measurement begins.
 */
export class FontLoader {
  private loaded = new Set<string>();

  constructor(options: { onFontsLoaded?: () => void } = {}) {
    if (typeof document === 'undefined' || !document.fonts) return;
    const fonts = document.fonts as FontFaceSet & {
      addEventListener?: FontFaceSet['addEventListener'];
    };
    fonts.addEventListener?.('loadingdone', () => {
      this.loaded.clear();
      options.onFontsLoaded?.();
    });
  }

  /**
   * Ensures the specified font is loaded and available for rendering.
   * @param fontSpec - CSS font specification (e.g. '16px "Noto Serif JP"').
   * @throws If the font fails to load.
   */
  async ensureLoaded(fontSpec: string): Promise<void> {
    if (this.loaded.has(fontSpec)) return;

    if (this.isAvailable(fontSpec)) {
      this.loaded.add(fontSpec);
      return;
    }

    await document.fonts.load(fontSpec);

    if (!this.isAvailable(fontSpec)) {
      throw new Error(`Font load failed: ${fontSpec}`);
    }

    this.loaded.add(fontSpec);
  }

  /**
   * Returns whether the specified font has been successfully loaded.
   * @param fontSpec - CSS font specification to check.
   */
  isLoaded(fontSpec: string): boolean {
    return this.loaded.has(fontSpec);
  }

  /**
   * Returns whether `document.fonts` can confirm that at least one concrete
   * family from the font spec exists, or that the spec only uses generic CSS
   * families.
   */
  isAvailable(fontSpec: string): boolean {
    if (typeof document === 'undefined' || !document.fonts) return false;
    if (!document.fonts.check(fontSpec)) return false;
    const families = fontFamiliesFromSpec(fontSpec);
    if (families.length === 0 || families.some(isGenericFamily)) return true;
    return families.some((family) => fontFaceFamilyExists(document.fonts, family));
  }
}

const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
]);

function isGenericFamily(family: string): boolean {
  return GENERIC_FAMILIES.has(family.toLowerCase());
}

function fontFaceFamilyExists(fonts: FontFaceSet, family: string): boolean {
  const wanted = unquoteFamily(family);
  for (const face of Array.from(fonts)) {
    if (unquoteFamily(face.family) === wanted) return true;
  }
  return false;
}

function fontFamiliesFromSpec(fontSpec: string): string[] {
  const familyList = fontSpec.replace(/^.*?\b\d+(?:\.\d+)?px\s+/u, '');
  const families: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < familyList.length; i++) {
    const ch = familyList[i];
    if (quote) {
      current += ch;
      if (ch === '\\' && i + 1 < familyList.length) {
        current += familyList[++i];
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      if (current.trim()) families.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) families.push(current.trim());
  return families;
}

function unquoteFamily(family: string): string {
  const trimmed = family.trim();
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' || first === "'") && first === last) {
    return trimmed.slice(1, -1).replace(/\\(["'\\])/gu, '$1');
  }
  return trimmed;
}
