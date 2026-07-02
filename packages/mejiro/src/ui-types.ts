import type { BookOptions } from './book/types.js';

/** A font choice shown in reader settings UIs. */
export interface FontChoice {
  /** CSS `font-family` value applied to the book. */
  value: string;
  /** Human-readable label shown in the picker. */
  label: string;
}

/** Subset of {@link BookOptions} editable from bundled settings panels. */
export type EditableSettings = Pick<
  BookOptions,
  'fontFamily' | 'fontSize' | 'lineSpacing' | 'mode' | 'enableHanging'
>;

/** Per-page header data used to render the running title and page number. */
export interface PageHeaderData {
  /** Running title. */
  title?: string;
  /** Page number. Hidden when `null`. */
  pageNumber?: number | null;
}
