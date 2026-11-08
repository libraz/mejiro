// @vitest-environment happy-dom
/** @jsxImportSource react */

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MejiroScrollView } from '../src/MejiroScrollView.js';
import { fakeScrollLayout } from './helpers/fixtures.js';

describe('MejiroScrollView (React)', () => {
  it('re-observes page elements when the page list changes', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    const OriginalIntersectionObserver = globalThis.IntersectionObserver;
    class MockIntersectionObserver {
      observe = observe;
      disconnect = disconnect;
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    const layoutA = fakeScrollLayout(2);
    const layoutB = fakeScrollLayout(3);

    try {
      const { rerender } = render(
        <MejiroScrollView layout={layoutA} pageWidth={320} pageHeight={460} contentHeight={360} />,
      );
      expect(observe).toHaveBeenCalledTimes(2);

      rerender(
        <MejiroScrollView layout={layoutB} pageWidth={320} pageHeight={460} contentHeight={360} />,
      );

      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(observe).toHaveBeenCalledTimes(5);
    } finally {
      vi.stubGlobal('IntersectionObserver', OriginalIntersectionObserver);
    }
  });
});
