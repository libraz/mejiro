// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import { MejiroSettingsPanel } from '../src/MejiroSettingsPanel.js';

const settings = { fontFamily: 'serif', fontSize: 18, lineSpacing: 1.8 };

describe('MejiroSettingsPanel (Vue) — label association', () => {
  it('links every label to a control and keeps ids unique across two panels', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const Two = defineComponent({
      setup: () => () => [
        h(MejiroSettingsPanel, { settings }),
        h(MejiroSettingsPanel, { settings }),
      ],
    });
    const wrapper = mount(Two, { attachTo: host });

    const labels = Array.from(host.querySelectorAll('label.mejiro-reader-control-label'));
    expect(labels).toHaveLength(8);
    for (const label of labels) {
      const target = label.getAttribute('for');
      expect(target).toBeTruthy();
      const controls = host.querySelectorAll(`[id="${target}"]`);
      expect(controls).toHaveLength(1);
    }
    const ids = Array.from(host.querySelectorAll('[id]')).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(host.querySelector('select[aria-label]')).not.toBeNull();
    wrapper.unmount();
    host.remove();
  });
});
