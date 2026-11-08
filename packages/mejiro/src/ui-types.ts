import type { KinsokuMode } from './types.js';

/** A font choice shown in reader settings UIs. */
export interface FontChoice {
  /** CSS `font-family` value applied to the book. */
  value: string;
  /** Human-readable label shown in the picker. */
  label: string;
}

/** Settings a bundled settings panel edits; each field mirrors the book option of the same name. */
export interface EditableSettings {
  /** CSS font family: a CSS-ready string, or an array of family names. */
  fontFamily: string | readonly string[];
  /** Base font size in pixels. */
  fontSize: number;
  /** Line spacing multiplier. */
  lineSpacing?: number;
  /** Kinsoku processing mode. */
  kinsoku?: KinsokuMode;
  /** Whether hanging punctuation is enabled. */
  enableHanging?: boolean;
}

/** Per-page header data used to render the running title and page number. */
export interface PageHeaderData {
  /** Running title. */
  title?: string;
  /** Page number. Hidden when `null`. */
  pageNumber?: number | null;
}
