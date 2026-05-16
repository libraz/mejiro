import type { BookOptions } from '@libraz/mejiro/book';
import { normalizeFontFamily } from '@libraz/mejiro/browser';
import type { ReactNode } from 'react';
import { useI18n } from './i18n.js';

/** A font choice shown in the settings panel. */
export interface FontChoice {
  /** CSS `font-family` value applied to the book. */
  value: string;
  /** Human-readable label. */
  label: string;
}

/** Subset of {@link BookOptions} editable from the panel. */
export type EditableSettings = Pick<
  BookOptions,
  'fontFamily' | 'fontSize' | 'lineSpacing' | 'mode' | 'enableHanging'
>;

const DEFAULT_FONTS: FontChoice[] = [
  { value: 'serif', label: 'System Serif' },
  { value: 'sans-serif', label: 'System Sans' },
];

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

  return (
    <div className={`mejiro-reader-settings-panel${open ? ' is-open' : ''}`}>
      <div className="mejiro-reader-settings-inner">
        <div className="mejiro-reader-settings-group">
          <span className="mejiro-reader-settings-group-title">{messages.settingsFont}</span>
          <div className="mejiro-reader-control">
            <select
              value={normalizeFontFamily(settings.fontFamily)}
              onChange={(e) => patch({ fontFamily: e.target.value })}
            >
              {fonts.map((f) => (
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
              onClick={() => patch({ fontSize: Math.max(minFontSize, settings.fontSize - 1) })}
            >
              A−
            </button>
            <input
              id="mejiro-reader-font-size"
              type="number"
              value={settings.fontSize}
              min={minFontSize}
              max={maxFontSize}
              onChange={(e) => patch({ fontSize: Number(e.target.value) })}
            />
            <button
              type="button"
              className="mejiro-reader-btn mejiro-reader-btn--icon"
              aria-label={messages.settingsSizeUp}
              onClick={() => patch({ fontSize: Math.min(maxFontSize, settings.fontSize + 1) })}
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
              onChange={(e) => patch({ lineSpacing: Number(e.target.value) })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
