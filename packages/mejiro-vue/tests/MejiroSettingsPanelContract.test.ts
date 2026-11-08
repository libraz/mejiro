// @vitest-environment happy-dom

import type { EditableSettings } from '@libraz/mejiro';
import { fireEvent, render } from '@testing-library/vue';
import { describe, expect, it, vi } from 'vitest';
import { expectTypeErrors } from '../../mejiro/tests/type-probe.js';
import { MejiroSettingsPanel } from '../src/MejiroSettingsPanel.js';

const settings: EditableSettings = { fontFamily: 'serif', fontSize: 16, kinsoku: 'strict' };

describe('MejiroSettingsPanel (Vue) — settings change', () => {
  it('reports the whole next settings value through update:settings, kinsoku included', async () => {
    const onUpdate = vi.fn();
    const { container } = render(MejiroSettingsPanel, {
      props: { open: true, settings, 'onUpdate:settings': onUpdate },
    });
    const kinsoku = container.querySelector<HTMLSelectElement>('select[id$="-kinsoku"]');
    expect(kinsoku?.value).toBe('strict');

    (kinsoku as HTMLSelectElement).value = 'loose';
    await fireEvent.change(kinsoku as HTMLSelectElement);

    expect(onUpdate).toHaveBeenCalledWith({ ...settings, kinsoku: 'loose' });
  });

  it('types the settings payload and takes read-only font lists', () => {
    expectTypeErrors(
      `import type { EditableSettings, FontChoice } from '@libraz/mejiro';
import type { MejiroSettingsPanelProps } from '@libraz/mejiro-vue';
declare const settings: EditableSettings;
const fonts: readonly FontChoice[] = [];
const ok: MejiroSettingsPanelProps = { settings, fonts, 'onUpdate:settings': (next: EditableSettings) => void next };
void ok;
const p1: MejiroSettingsPanelProps = { settings, 'onUpdate:settings': (next: string) => void next };`,
      { fails: ['const p1'] },
    );
  });
});
