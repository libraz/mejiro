// @vitest-environment happy-dom
/** @jsxImportSource react */

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jaMessages, MejiroI18nProvider } from '../src/i18n.js';
import { MejiroImagePlaceholder } from '../src/MejiroImagePlaceholder.js';

describe('MejiroImagePlaceholder (React)', () => {
  it('uses the i18n catalog for default labels', () => {
    const { container } = render(
      <MejiroI18nProvider messages={jaMessages}>
        <MejiroImagePlaceholder rect={{ x: 1, y: 2, width: 30, height: 40 }} />
      </MejiroI18nProvider>,
    );

    expect(container.textContent).toContain(jaMessages.imageButton);
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(
      jaMessages.imageRemoveButton,
    );
  });
});

describe('MejiroImagePlaceholder (React) — remove button', () => {
  it('removes on click, once, and not on a bare pointer-down', () => {
    const onClose = vi.fn();
    const onOverlayPointerDown = vi.fn();
    const { container } = render(
      <MejiroImagePlaceholder
        rect={{ x: 0, y: 0, width: 50, height: 50 }}
        onClose={onClose}
        onOverlayPointerDown={onOverlayPointerDown}
      />,
    );
    const button = container.querySelector('button') as HTMLButtonElement;

    fireEvent.pointerDown(button);
    expect(onClose).not.toHaveBeenCalled();
    expect(onOverlayPointerDown).not.toHaveBeenCalled();

    button.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('MejiroImagePlaceholder (React) — stylesheet hooks', () => {
  it('keeps the image overlay class names the reader stylesheet targets', () => {
    const { container } = render(
      <MejiroImagePlaceholder rect={{ x: 5, y: 6, width: 70, height: 80 }} />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe('mejiro-reader-image-overlay');
    expect(root.style.width).toBe('70px');
    expect(root.style.height).toBe('80px');
    expect(container.querySelector('.mejiro-reader-image-overlay-resize')).not.toBeNull();
    expect(container.querySelector('.mejiro-reader-image-overlay-close')).not.toBeNull();
  });
});
