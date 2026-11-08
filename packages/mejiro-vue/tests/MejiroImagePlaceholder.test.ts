// @vitest-environment happy-dom

import { render } from '@testing-library/vue';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { jaMessages, MejiroI18nProvider } from '../src/i18n.js';
import { MejiroImagePlaceholder } from '../src/MejiroImagePlaceholder.js';

describe('MejiroImagePlaceholder (Vue)', () => {
  it('uses the i18n catalog for default labels', () => {
    const Wrapped = defineComponent({
      setup() {
        return () =>
          h(MejiroI18nProvider, { messages: jaMessages }, () =>
            h(MejiroImagePlaceholder, { rect: { x: 1, y: 2, width: 30, height: 40 } }),
          );
      },
    });
    const { container } = render(Wrapped);
    expect(container.textContent).toContain(jaMessages.imageButton);
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(
      jaMessages.imageRemoveButton,
    );
  });

  it('keeps the overlay class names and sizes the box from width and height', () => {
    const { container } = render(MejiroImagePlaceholder, {
      props: { rect: { x: 5, y: 6, width: 70, height: 80 } },
    });
    const box = container.querySelector<HTMLElement>('.mejiro-reader-image-overlay');
    expect(box?.style.left).toBe('5px');
    expect(box?.style.width).toBe('70px');
    expect(box?.style.height).toBe('80px');
    expect(container.querySelector('.mejiro-reader-image-overlay-resize')).not.toBeNull();
  });

  it('is exported under the placeholder name only', () => {
    expectTypeErrors(
      `import { MejiroImagePlaceholder, type MejiroImagePlaceholderProps } from '@libraz/mejiro-vue';
const props: MejiroImagePlaceholderProps = { rect: { x: 0, y: 0, width: 1, height: 1 }, 'onOverlay-pointer-down': (e: PointerEvent) => void e };
void [MejiroImagePlaceholder, props];
import { MejiroImageOverlay } from '@libraz/mejiro-vue';`,
      { fails: ['import { MejiroImageOverlay }'] },
    );
  });
});

describe('MejiroImagePlaceholder (Vue) — remove button', () => {
  it('removes on click, once, and not on a bare pointer-down', () => {
    const onClose = vi.fn();
    const onOverlayPointerDown = vi.fn();
    const { container } = render(MejiroImagePlaceholder, {
      props: { rect: { x: 0, y: 0, width: 50, height: 50 }, onClose, onOverlayPointerDown },
    });
    const button = container.querySelector('button') as HTMLButtonElement;

    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();
    expect(onOverlayPointerDown).not.toHaveBeenCalled();

    button.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
