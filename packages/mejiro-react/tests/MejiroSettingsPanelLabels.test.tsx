// @vitest-environment happy-dom
/** @jsxImportSource react */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MejiroSettingsPanel } from '../src/MejiroSettingsPanel.js';

const settings = { fontFamily: 'serif', fontSize: 18, lineSpacing: 1.8 };

describe('MejiroSettingsPanel (React) — label association', () => {
  it('links every label to a control and keeps ids unique across two panels', () => {
    const { container } = render(
      <>
        <MejiroSettingsPanel settings={settings} onChange={() => {}} />
        <MejiroSettingsPanel settings={settings} onChange={() => {}} />
      </>,
    );

    const labels = Array.from(container.querySelectorAll('label.mejiro-reader-control-label'));
    expect(labels).toHaveLength(8);
    for (const label of labels) {
      const target = label.getAttribute('for');
      expect(target).toBeTruthy();
      expect(container.querySelectorAll(`[id="${target}"]`)).toHaveLength(1);
    }
    const ids = Array.from(container.querySelectorAll('[id]')).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(container.querySelector('select[aria-label]')).not.toBeNull();
  });
});
