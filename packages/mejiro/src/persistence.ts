import type { InChapterAnchor, ReadingAnchor } from './book/index.js';

/** Minimal key-value storage interface used by reader persistence helpers. */
export interface MejiroStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Persisted reading position. */
export type ReadingPositionValue = ReadingAnchor;

const READING_POSITION_VERSION = 2;

interface PersistedReadingPositionV2 {
  version: 2;
  chapter: number;
  paragraph: number;
  charIndex: number;
}

interface LegacyReadingPositionV1 {
  chapter: number;
  spreadIdx: number;
}

/** Parses current and legacy reading-position payloads. */
export function parseReadingPosition(raw: string | null): ReadingPositionValue | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Partial<PersistedReadingPositionV2 & LegacyReadingPositionV1>;
  if (typeof p.chapter !== 'number') return null;
  if (p.version === READING_POSITION_VERSION) {
    if (typeof p.paragraph !== 'number' || typeof p.charIndex !== 'number') return null;
    return { chapter: p.chapter, paragraph: p.paragraph, charIndex: p.charIndex };
  }
  if (typeof p.spreadIdx === 'number') {
    // biome-ignore lint/suspicious/noConsole: intentional one-time migration notice
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      // biome-ignore lint/suspicious/noConsole: intentional one-time migration notice
      console.warn(
        '[mejiro] useReadingPosition: migrating legacy {chapter, spreadIdx} format. ' +
          'spreadIdx has been dropped because it does not survive reflow; the position ' +
          'now resumes at the start of the chapter. Persist new positions via save() to upgrade.',
      );
    }
    return { chapter: p.chapter, paragraph: 0, charIndex: 0 };
  }
  return null;
}

/** Serializes a reading-position anchor. */
export function serializeReadingPosition(value: ReadingPositionValue): string {
  const payload: PersistedReadingPositionV2 = {
    version: READING_POSITION_VERSION,
    chapter: value.chapter,
    paragraph: value.paragraph,
    charIndex: value.charIndex,
  };
  return JSON.stringify(payload);
}

/** A user-authored annotation on a book. */
export interface Annotation {
  id: string;
  chapter: number;
  start: InChapterAnchor;
  end: InChapterAnchor;
  color?: string;
  note?: string;
  createdAt?: number;
}

const ANNOTATIONS_VERSION = 1;

interface PersistedAnnotations {
  version: number;
  annotations: Annotation[];
}

/** Parses an annotation payload, returning an empty list for invalid data. */
export function parseAnnotations(raw: string | null): Annotation[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedAnnotations>;
    if (parsed?.version !== ANNOTATIONS_VERSION || !Array.isArray(parsed.annotations)) return [];
    return parsed.annotations.filter(isAnnotation);
  } catch {
    // Bad JSON — treat as empty.
  }
  return [];
}

function isAnnotation(value: unknown): value is Annotation {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || !isNonNegativeInteger(value.chapter)) return false;
  if (!(isAnchor(value.start) && isAnchor(value.end))) return false;
  if (value.color !== undefined && typeof value.color !== 'string') return false;
  if (value.note !== undefined && typeof value.note !== 'string') return false;
  return value.createdAt === undefined || Number.isFinite(value.createdAt);
}

function isAnchor(value: unknown): value is InChapterAnchor {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.paragraph) &&
    isNonNegativeInteger(value.charIndex)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Serializes annotations with a version envelope. */
export function serializeAnnotations(annotations: readonly Annotation[]): string {
  const payload: PersistedAnnotations = {
    version: ANNOTATIONS_VERSION,
    annotations: [...annotations],
  };
  return JSON.stringify(payload);
}

/** Sorts annotations by chapter, paragraph, then character index. */
export function sortAnnotations(annotations: readonly Annotation[]): Annotation[] {
  return [...annotations].sort((a, b) => {
    if (a.chapter !== b.chapter) return a.chapter - b.chapter;
    if (a.start.paragraph !== b.start.paragraph) return a.start.paragraph - b.start.paragraph;
    return a.start.charIndex - b.start.charIndex;
  });
}

/** Creates a best-effort stable client-side annotation id. */
export function createAnnotationId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
