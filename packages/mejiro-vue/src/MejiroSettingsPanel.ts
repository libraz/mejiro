import type { EditableSettings, FontChoice } from '@libraz/mejiro';
import { normalizeFontFamily } from '@libraz/mejiro/browser';
import * as Vue from 'vue';
import { defineComponent, h, type PropType } from 'vue';
import { useI18n } from './i18n.js';

export type { EditableSettings, FontChoice };

const DEFAULT_FONTS: FontChoice[] = [
  { value: 'serif', label: 'System Serif' },
  { value: 'sans-serif', label: 'System Sans' },
];

/**
 * Derives a human-readable label from a CSS `font-family` value — its first
 * family with surrounding quotes stripped (e.g. `'"Noto Serif JP", serif'` →
 * `Noto Serif JP`). Used to label an active font that isn't in the host's
 * `fonts` list.
 */
function fontLabelFromCss(css: string): string {
  const first = css.split(',')[0]?.trim() ?? css;
  return first.replace(/^["']|["']$/g, '') || css;
}

let panelSeq = 0;

/** A per-instance id prefix: Vue's own `useId` where it exists (3.5+), else a counter. */
function usePanelId(): string {
  return typeof Vue.useId === 'function' ? Vue.useId() : `mejiro-settings-${++panelSeq}`;
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function parseClampedInput(value: string, min: number, max: number, fallback: number): number {
  if (value.trim() === '') return fallback;
  return clampNumber(Number(value), min, max, fallback);
}

/**
 * Reader settings panel: font, size, kinsoku mode, hanging punctuation,
 * and line spacing. Pass `open` to control visibility and use
 * `v-model:settings` to bind the editable options.
 */
export const MejiroSettingsPanel = defineComponent({
  name: 'MejiroSettingsPanel',
  props: {
    /** Whether the panel is currently expanded. */
    open: {
      type: Boolean,
      default: false,
    },
    /** Current editable settings. */
    settings: {
      type: Object as PropType<EditableSettings>,
      required: true,
    },
    /** Font choices for the family selector. */
    fonts: {
      type: Array as PropType<FontChoice[]>,
      default: () => DEFAULT_FONTS,
    },
    /** Minimum font size. @defaultValue 10 */
    minFontSize: {
      type: Number,
      default: 10,
    },
    /** Maximum font size. @defaultValue 48 */
    maxFontSize: {
      type: Number,
      default: 48,
    },
  },
  emits: ['update:settings'],
  setup(props, { emit }) {
    const messages = useI18n();
    // Per-instance ids keep label associations valid when two panels share a page.
    const uid = usePanelId();
    function patch(next: Partial<EditableSettings>): void {
      emit('update:settings', { ...props.settings, ...next });
    }

    return () => {
      const s = props.settings;
      const m = messages.value;
      // Show the active font even when the host's `fonts` list doesn't include
      // it, so the selector never renders blank (e.g. an embed that sets a
      // custom family but passes no matching choice).
      const current = normalizeFontFamily(s.fontFamily);
      const fontOptions = props.fonts.some((f) => f.value === current)
        ? props.fonts
        : [{ value: current, label: fontLabelFromCss(current) }, ...props.fonts];
      return h(
        'div',
        { class: ['mejiro-reader-settings-panel', { 'is-open': props.open }] },
        h(
          'div',
          { class: 'mejiro-reader-settings-inner' },
          h('div', { class: 'mejiro-reader-settings-content' }, [
            h('div', { class: 'mejiro-reader-settings-group' }, [
              h('span', { class: 'mejiro-reader-settings-group-title' }, m.settingsFont),
              h('div', { class: 'mejiro-reader-control' }, [
                h(
                  'select',
                  {
                    'aria-label': m.settingsFont,
                    value: normalizeFontFamily(s.fontFamily),
                    onChange: (e: Event) =>
                      patch({ fontFamily: (e.target as HTMLSelectElement).value }),
                  },
                  fontOptions.map((f) => h('option', { key: f.value, value: f.value }, f.label)),
                ),
              ]),
              h('div', { class: 'mejiro-reader-control' }, [
                h(
                  'label',
                  { class: 'mejiro-reader-control-label', for: `${uid}-font-size` },
                  m.settingsSize,
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'mejiro-reader-btn mejiro-reader-btn--icon',
                    'aria-label': m.settingsSizeDown,
                    onClick: () =>
                      patch({
                        fontSize: clampNumber(
                          s.fontSize - 1,
                          props.minFontSize,
                          props.maxFontSize,
                          props.minFontSize,
                        ),
                      }),
                  },
                  'A−',
                ),
                h('input', {
                  id: `${uid}-font-size`,
                  type: 'number',
                  value: s.fontSize,
                  min: props.minFontSize,
                  max: props.maxFontSize,
                  onChange: (e: Event) => {
                    const input = e.target as HTMLInputElement;
                    const fontSize = parseClampedInput(
                      input.value,
                      props.minFontSize,
                      props.maxFontSize,
                      s.fontSize,
                    );
                    // Show the committed value even when clamping leaves the setting unchanged.
                    input.value = String(fontSize);
                    patch({ fontSize });
                  },
                }),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'mejiro-reader-btn mejiro-reader-btn--icon',
                    'aria-label': m.settingsSizeUp,
                    onClick: () =>
                      patch({
                        fontSize: clampNumber(
                          s.fontSize + 1,
                          props.minFontSize,
                          props.maxFontSize,
                          props.minFontSize,
                        ),
                      }),
                  },
                  'A+',
                ),
              ]),
            ]),
            h('div', { class: 'mejiro-reader-settings-group' }, [
              h('span', { class: 'mejiro-reader-settings-group-title' }, m.settingsLayout),
              h('div', { class: 'mejiro-reader-control' }, [
                h(
                  'label',
                  { class: 'mejiro-reader-control-label', for: `${uid}-kinsoku` },
                  m.settingsKinsoku,
                ),
                h(
                  'select',
                  {
                    id: `${uid}-kinsoku`,
                    value: s.mode ?? 'strict',
                    onChange: (e: Event) =>
                      patch({
                        mode: (e.target as HTMLSelectElement).value as 'strict' | 'loose',
                      }),
                  },
                  [
                    h('option', { value: 'strict' }, m.settingsStrict),
                    h('option', { value: 'loose' }, m.settingsLoose),
                  ],
                ),
              ]),
              h('div', { class: 'mejiro-reader-control' }, [
                h(
                  'label',
                  { class: 'mejiro-reader-control-label', for: `${uid}-hanging` },
                  m.settingsHanging,
                ),
                h(
                  'select',
                  {
                    id: `${uid}-hanging`,
                    value: String(s.enableHanging ?? true),
                    onChange: (e: Event) =>
                      patch({
                        enableHanging: (e.target as HTMLSelectElement).value === 'true',
                      }),
                  },
                  [
                    h('option', { value: 'true' }, m.toggleOn),
                    h('option', { value: 'false' }, m.toggleOff),
                  ],
                ),
              ]),
              h('div', { class: 'mejiro-reader-control' }, [
                h(
                  'label',
                  { class: 'mejiro-reader-control-label', for: `${uid}-line-spacing` },
                  m.settingsLineSpacing,
                ),
                h('input', {
                  id: `${uid}-line-spacing`,
                  class: 'mejiro-reader-control--wide',
                  type: 'number',
                  value: s.lineSpacing ?? 1.8,
                  min: 1.0,
                  max: 3.0,
                  step: 0.1,
                  onChange: (e: Event) => {
                    const input = e.target as HTMLInputElement;
                    const lineSpacing = parseClampedInput(input.value, 1, 3, s.lineSpacing ?? 1.8);
                    input.value = String(lineSpacing);
                    patch({ lineSpacing });
                  },
                }),
              ]),
            ]),
          ]),
        ),
      );
    };
  },
});

/** Props accepted by {@link MejiroSettingsPanel}. */
export type MejiroSettingsPanelProps = InstanceType<typeof MejiroSettingsPanel>['$props'];
