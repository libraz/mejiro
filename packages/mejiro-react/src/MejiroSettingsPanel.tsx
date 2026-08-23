import type { EditableSettings, FontChoice } from '@libraz/mejiro';
import { normalizeFontFamily } from '@libraz/mejiro/browser';
import type { ReactNode } from 'react';
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

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function parseClampedInput(value: string, min: number, max: number, fallback: number): number {
  if (value.trim() === '') return fallback;
  return clampNumber(Number(value), min, max, fallback);
}

/** Props for {@link MejiroSettingsPanel}. */
export interface MejiroSettingsPanelProps {
  /** Whether the panel is expanded. */
  open: boolean;
  /** Current editable settings. */
  settings: EditableSettings;
  /** Called when a setting changes. */
  onChange: (next: EditableSettings) => void;
  /** Font choices. */
  fonts?: FontChoice[];
  /** Min font size. @defaultValue 10 */
  minFontSize?: number;
  /** Max font size. @defaultValue 48 */
  maxFontSize?: number;
}

/**
 * Reader settings panel: font, size, kinsoku mode, hanging punctuation, line spacing.
 */
export function MejiroSettingsPanel({
  open,
  settings,
  onChange,
  fonts = DEFAULT_FONTS,
  minFontSize = 10,
  maxFontSize = 48,
}: MejiroSettingsPanelProps): ReactNode {
  const messages = useI18n();
  const patch = (next: Partial<EditableSettings>) => onChange({ ...settings, ...next });

  // Show the active font even when the host's `fonts` list doesn't include it,
  // so the selector never renders blank (e.g. an embed that sets a custom
  // family but passes no matching choice).
  const currentFont = normalizeFontFamily(settings.fontFamily);
  const fontOptions = fonts.some((f) => f.value === currentFont)
    ? fonts
    : [{ value: currentFont, label: fontLabelFromCss(currentFont) }, ...fonts];

  return (
    <div className={`mejiro-reader-settings-panel${open ? ' is-open' : ''}`}>
      <div className="mejiro-reader-settings-inner">
        <div className="mejiro-reader-settings-content">
          <div className="mejiro-reader-settings-group">
            <span className="mejiro-reader-settings-group-title">{messages.settingsFont}</span>
            <div className="mejiro-reader-control">
              <select value={currentFont} onChange={(e) => patch({ fontFamily: e.target.value })}>
                {fontOptions.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="mejiro-reader-control">
              <label className="mejiro-reader-control-label" htmlFor="mejiro-reader-font-size">
                {messages.settingsSize}
              </label>
              <button
                type="button"
                className="mejiro-reader-btn mejiro-reader-btn--icon"
                aria-label={messages.settingsSizeDown}
                onClick={() =>
                  patch({
                    fontSize: clampNumber(
                      settings.fontSize - 1,
                      minFontSize,
                      maxFontSize,
                      minFontSize,
                    ),
                  })
                }
              >
                A−
              </button>
              <input
                id="mejiro-reader-font-size"
                type="number"
                value={settings.fontSize}
                min={minFontSize}
                max={maxFontSize}
                onChange={(e) =>
                  patch({
                    fontSize: parseClampedInput(
                      e.target.value,
                      minFontSize,
                      maxFontSize,
                      settings.fontSize,
                    ),
                  })
                }
              />
              <button
                type="button"
                className="mejiro-reader-btn mejiro-reader-btn--icon"
                aria-label={messages.settingsSizeUp}
                onClick={() =>
                  patch({
                    fontSize: clampNumber(
                      settings.fontSize + 1,
                      minFontSize,
                      maxFontSize,
                      minFontSize,
                    ),
                  })
                }
              >
                A+
              </button>
            </div>
          </div>
          <div className="mejiro-reader-settings-group">
            <span className="mejiro-reader-settings-group-title">{messages.settingsLayout}</span>
            <div className="mejiro-reader-control">
              <label className="mejiro-reader-control-label" htmlFor="mejiro-reader-kinsoku">
                {messages.settingsKinsoku}
              </label>
              <select
                id="mejiro-reader-kinsoku"
                value={settings.mode ?? 'strict'}
                onChange={(e) => patch({ mode: e.target.value as 'strict' | 'loose' })}
              >
                <option value="strict">{messages.settingsStrict}</option>
                <option value="loose">{messages.settingsLoose}</option>
              </select>
            </div>
            <div className="mejiro-reader-control">
              <label className="mejiro-reader-control-label" htmlFor="mejiro-reader-hanging">
                {messages.settingsHanging}
              </label>
              <select
                id="mejiro-reader-hanging"
                value={String(settings.enableHanging ?? true)}
                onChange={(e) => patch({ enableHanging: e.target.value === 'true' })}
              >
                <option value="true">{messages.toggleOn}</option>
                <option value="false">{messages.toggleOff}</option>
              </select>
            </div>
            <div className="mejiro-reader-control">
              <label className="mejiro-reader-control-label" htmlFor="mejiro-reader-line-spacing">
                {messages.settingsLineSpacing}
              </label>
              <input
                id="mejiro-reader-line-spacing"
                className="mejiro-reader-control--wide"
                type="number"
                value={settings.lineSpacing ?? 1.8}
                min={1.0}
                max={3.0}
                step={0.1}
                onChange={(e) =>
                  patch({
                    lineSpacing: parseClampedInput(
                      e.target.value,
                      1,
                      3,
                      settings.lineSpacing ?? 1.8,
                    ),
                  })
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
