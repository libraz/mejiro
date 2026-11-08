// @vitest-environment happy-dom
/** @jsxImportSource react */

import type { ChapterLayout, SpreadResult } from '@libraz/mejiro/book';
import { render } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { MejiroChapterNav } from '../src/MejiroChapterNav.js';
import { MejiroDropZone } from '../src/MejiroDropZone.js';
import { MejiroImagePlaceholder } from '../src/MejiroImagePlaceholder.js';
import { MejiroPage } from '../src/MejiroPage.js';
import { MejiroPageIndicator } from '../src/MejiroPageIndicator.js';
import { MejiroPageView } from '../src/MejiroPageView.js';
import { MejiroScrollView } from '../src/MejiroScrollView.js';
import { MejiroSelectionLayer } from '../src/MejiroSelectionLayer.js';
import { MejiroSettingsPanel } from '../src/MejiroSettingsPanel.js';
import { MejiroShelf } from '../src/MejiroShelf.js';
import { MejiroSpread } from '../src/MejiroSpread.js';
import { MejiroStats } from '../src/MejiroStats.js';
import { MejiroToc } from '../src/MejiroToc.js';
import { FAKE_LAYOUT_METRICS, fakeEpub, fakeScrollLayout, pageResult } from './helpers/fixtures.js';

function twoPages(): SpreadResult {
  return { right: pageResult('右頁'), left: pageResult('左頁'), pageCount: 2 };
}

/** A layout stub that only reports the geometry and typography it was measured with. */
function measuredLayout(): ChapterLayout {
  return { ...FAKE_LAYOUT_METRICS } as unknown as ChapterLayout;
}

describe('MejiroSpread single spread mode', () => {
  it('shows the right page when singleSide is null, as useSpread reports in double mode', () => {
    const { container } = render(
      <MejiroSpread
        spread={twoPages()}
        pageWidth={320}
        pageHeight={460}
        contentHeight={360}
        spreadMode="single"
        singleSide={null}
      />,
    );
    const pages = container.querySelectorAll('.mejiro-reader-page');
    expect(pages).toHaveLength(1);
    expect(pages[0].classList.contains('mejiro-reader-page--right')).toBe(true);
    expect(container.querySelector('.mejiro-reader-spread--single')).not.toBeNull();
  });

  it('shows both pages in double mode, which is the default', () => {
    const { container } = render(
      <MejiroSpread spread={twoPages()} pageWidth={320} pageHeight={460} contentHeight={360} />,
    );
    expect(container.querySelectorAll('.mejiro-reader-page')).toHaveLength(2);
    expect(container.querySelector('.mejiro-reader-spread--single')).toBeNull();
  });
});

describe('views take page size and typography from their layout', () => {
  it('sizes MejiroSpread pages from layout.geometry and its text from layout.typography', () => {
    const { container } = render(<MejiroSpread spread={twoPages()} layout={measuredLayout()} />);
    const page = container.querySelector<HTMLElement>('.mejiro-reader-page');
    const content = container.querySelector<HTMLElement>('.mejiro-reader-page-content');
    expect(page?.style.width).toBe('320px');
    expect(page?.style.height).toBe('460px');
    expect(content?.style.height).toBe('360px');
    expect(content?.style.fontSize).toBe('16px');
    expect(content?.style.lineHeight).toBe('1.8');
  });

  it('lets explicit props win over the layout values', () => {
    const { container } = render(
      <MejiroSpread spread={twoPages()} layout={measuredLayout()} pageWidth={200} fontSize={20} />,
    );
    const page = container.querySelector<HTMLElement>('.mejiro-reader-page');
    const content = container.querySelector<HTMLElement>('.mejiro-reader-page-content');
    expect(page?.style.width).toBe('200px');
    expect(page?.style.height).toBe('460px');
    expect(content?.style.fontSize).toBe('20px');
  });

  it('sizes MejiroScrollView pages from its layout', () => {
    const { container } = render(<MejiroScrollView layout={fakeScrollLayout(2)} />);
    const pages = container.querySelectorAll<HTMLElement>('.mejiro-reader-page');
    expect(pages).toHaveLength(2);
    expect(pages[0].style.width).toBe('320px');
    expect(pages[0].style.height).toBe('460px');
  });

  it('gives MejiroPageView slot columns the layout line spacing', () => {
    const { container } = render(
      <MejiroPageView result={pageResult('本文')} layout={measuredLayout()} slotMode />,
    );
    const column = container.querySelector<HTMLElement>('.mejiro-page-slots > div');
    expect(column?.style.lineHeight).toBe('1.8');
  });
});

describe('low-level components forward refs and DOM attributes to their root element', () => {
  it('attaches the ref, extra attributes and class to the root of each component', () => {
    const attrs = { className: 'host-class', 'data-testid': 'root', 'aria-describedby': 'hint' };
    const cases = [
      {
        name: 'MejiroPage',
        ref: createRef<HTMLDivElement>(),
        render: (ref: never) => <MejiroPage ref={ref} page={pageResult('a').page} {...attrs} />,
      },
      {
        name: 'MejiroPageView',
        ref: createRef<HTMLDivElement>(),
        render: (ref: never) => <MejiroPageView ref={ref} result={pageResult('a')} {...attrs} />,
      },
      {
        name: 'MejiroSpread',
        ref: createRef<HTMLDivElement>(),
        render: (ref: never) => (
          <MejiroSpread ref={ref} spread={twoPages()} layout={measuredLayout()} {...attrs} />
        ),
      },
      {
        name: 'MejiroScrollView',
        ref: createRef<HTMLDivElement>(),
        render: (ref: never) => (
          <MejiroScrollView ref={ref} layout={fakeScrollLayout(1)} {...attrs} />
        ),
      },
      {
        name: 'MejiroSelectionLayer',
        ref: createRef<HTMLDivElement>(),
        render: (ref: never) => (
          <MejiroSelectionLayer ref={ref} rects={[]} side="right" {...attrs} />
        ),
      },
      {
        name: 'MejiroImagePlaceholder',
        ref: createRef<HTMLDivElement>(),
        render: (ref: never) => (
          <MejiroImagePlaceholder
            ref={ref}
            rect={{ x: 0, y: 0, width: 10, height: 10 }}
            {...attrs}
          />
        ),
      },
      {
        name: 'MejiroPageIndicator',
        ref: createRef<HTMLDivElement>(),
        render: (ref: never) => <MejiroPageIndicator ref={ref} index={0} count={1} {...attrs} />,
      },
      {
        name: 'MejiroStats',
        ref: createRef<HTMLSpanElement>(),
        render: (ref: never) => (
          <MejiroStats ref={ref} chapter={null} pageCount={0} elapsedMs={0} {...attrs} />
        ),
      },
      {
        name: 'MejiroSettingsPanel',
        ref: createRef<HTMLDivElement>(),
        render: (ref: never) => (
          <MejiroSettingsPanel
            ref={ref}
            open
            settings={{ fontFamily: 'serif', fontSize: 16 }}
            onSettingsChange={() => {}}
            {...attrs}
          />
        ),
      },
      {
        name: 'MejiroDropZone',
        ref: createRef<HTMLButtonElement>(),
        render: (ref: never) => <MejiroDropZone ref={ref} onFile={() => {}} {...attrs} />,
      },
      {
        name: 'MejiroChapterNav',
        ref: createRef<HTMLElement>(),
        render: (ref: never) => (
          <MejiroChapterNav
            ref={ref}
            epub={fakeEpub()}
            chapterIndex={0}
            onChapterIndexChange={() => {}}
            {...attrs}
          />
        ),
      },
      {
        name: 'MejiroToc',
        ref: createRef<HTMLElement>(),
        render: (ref: never) => <MejiroToc ref={ref} epub={fakeEpub()} {...attrs} />,
      },
      {
        name: 'MejiroShelf',
        ref: createRef<HTMLElement>(),
        render: (ref: never) => <MejiroShelf ref={ref} volumes={[]} {...attrs} />,
      },
    ];

    for (const c of cases) {
      const { container, unmount } = render(c.render(c.ref as never));
      const root = container.firstElementChild;
      expect(c.ref.current, c.name).toBe(root);
      expect(root?.getAttribute('data-testid'), c.name).toBe('root');
      expect(root?.getAttribute('aria-describedby'), c.name).toBe('hint');
      expect(root?.classList.contains('host-class'), c.name).toBe(true);
      unmount();
    }
  });
});
