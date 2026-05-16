import type { BookOptions } from '@libraz/mejiro/book';
import { normalizeFontFamily } from '@libraz/mejiro/browser';
import { defineComponent, h, type PropType } from 'vue';
import { useI18n } from './i18n.js';

/** A font choice shown in the settings panel. */
export interface FontChoice {
  /** CSS `font-family` value applied to the book. */
  value: string;
  /** Human-readable label shown in the picker. */
  label: string;
}

/** Subset of {@link BookOptions} the settings panel can edit. */
export type EditableSettings = Pick<
  BookOptions,
  'fontFamily' | 'fontSize' | 'lineSpacing' | 'mode' | 'enableHanging'
>;

const DEFAULT_FONTS: FontChoice[] = [
  { value: 'serif', label: 'System Serif' },
  { value: 'sans-serif', label: 'System Sans' },
];

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
    function patch(next: Partial<EditableSettings>): void {
      emit('update:settings', { ...props.settings, ...next });
    }

    return () => {
      const s = props.settings;
      const m = messages.value;
      return h(
        'div',
        { class: ['mejiro-reader-settings-panel', { 'is-open': props.open }] },
        h('div', { class: 'mejiro-reader-settings-inner' }, [
          h('div', { class: 'mejiro-reader-settings-group' }, [
            h('span', { class: 'mejiro-reader-settings-group-title' }, m.settingsFont),
            h('div', { class: 'mejiro-reader-control' }, [
              h(
                'select',
                {
                  value: normalizeFontFamily(s.fontFamily),
                  onChange: (e: Event) =>
                    patch({ fontFamily: (e.target as HTMLSelectElement).value }),
                },
                props.fonts.map((f) => h('option', { key: f.value, value: f.value }, f.label)),
              ),
            ]),
            h('div', { class: 'mejiro-reader-control' }, [
              h('label', { class: 'mejiro-reader-control-label' }, m.settingsSize),
              h(
                'button',
                {
                  type: 'button',
                  class: 'mejiro-reader-btn mejiro-reader-btn--icon',
                  'aria-label': m.settingsSizeDown,
                  onClick: () => patch({ fontSize: Math.max(props.minFontSize, s.fontSize - 1) }),
                },
                'A−',
              ),
              h('input', {
                type: 'number',
                value: s.fontSize,
                min: props.minFontSize,
                max: props.maxFontSize,
                onChange: (e: Event) =>
                  patch({ fontSize: Number((e.target as HTMLInputElement).value) }),
              }),
              h(
                'button',
                {
                  type: 'button',
                  class: 'mejiro-reader-btn mejiro-reader-btn--icon',
                  'aria-label': m.settingsSizeUp,
                  onClick: () => patch({ fontSize: Math.min(props.maxFontSize, s.fontSize + 1) }),
                },
                'A+',
              ),
            ]),
          ]),
          h('div', { class: 'mejiro-reader-settings-group' }, [
            h('span', { class: 'mejiro-reader-settings-group-title' }, m.settingsLayout),
            h('div', { class: 'mejiro-reader-control' }, [
              h('label', { class: 'mejiro-reader-control-label' }, m.settingsKinsoku),
              h(
                'select',
                {
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
              h('label', { class: 'mejiro-reader-control-label' }, m.settingsHanging),
              h(
                'select',
                {
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
              h('label', { class: 'mejiro-reader-control-label' }, m.settingsLineSpacing),
              h('input', {
                class: 'mejiro-reader-control--wide',
                type: 'number',
                value: s.lineSpacing ?? 1.8,
                min: 1.0,
                max: 3.0,
                step: 0.1,
                onChange: (e: Event) =>
                  patch({ lineSpacing: Number((e.target as HTMLInputElement).value) }),
              }),
            ]),
          ]),
        ]),
      );
    };
  },
});

export type MejiroSettingsPanelProps = InstanceType<typeof MejiroSettingsPanel>['$props'];
