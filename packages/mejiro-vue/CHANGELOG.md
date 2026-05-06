# @libraz/mejiro-vue

## 0.4.0

### Minor Changes

- Harden book reflow, EPUB parsing, and CLI; share overlay helpers.

  - Preserve ruby annotations across resize reflow and use real spread starts when computing image column offsets
  - Make EPUB parsing throw on malformed XML, fall back when DC namespace is dropped, and normalize manifest hrefs
  - Recursively pick leaf block paragraphs and re-index ruby annotations after whitespace trim
  - Refactor the CLI to be testable, validate flag values, and surface errors via stderr
  - Extract `moveImageOverlayRect` / `resizeImageOverlayRect` into core and consume them from React/Vue hooks
  - Drop the zero-height exclusion fallback and ensure `packPageLines` always advances on oversized first lines

### Patch Changes

- Updated dependencies
  - @libraz/mejiro@0.4.0

## 0.3.0

### Minor Changes

- Add image exclusion engine, high-level book API, and framework components

  - Add `ExclusionEngine` and `SpreadExclusionEngine` for text reflow around images in vertical writing mode, with per-column gap computation, multi-image overlap support, and two-page spread with automatic gutter handling
  - Add `mejiro/book` subpath export with `MejiroBook` orchestrator and `ChapterLayout` for pagination, heading support, image exclusion, and lazy spread computation
  - Add `DEFAULT_HEADING_STYLES` and `DEFAULT_PAGE_PADDING` constants
  - Add `MejiroPageView` components for React and Vue with built-in page sizing, slot-based exclusion rendering, and running headers
  - Add `useImageOverlay` hooks for React and Vue to manage draggable/resizable image overlays
  - Add per-level heading style overrides (`headingStyles`) and `lineWidths` support in `computeBreaks` for variable per-line widths
  - Fix heading offset compensation for spine-straddling images and multi-gap slot alignment

### Patch Changes

- Updated dependencies
  - @libraz/mejiro@0.3.0
