import {
  enMessages,
  formatMessage,
  jaMessages,
  type MejiroMessages,
  messageCatalogs,
  resolveMessages,
} from '@libraz/mejiro';
import { describe, expect, it } from 'vitest';
import { expectTypeErrors } from './type-probe.js';

describe('i18n catalogs', () => {
  it('resolves built-in locales and overrides', () => {
    expect(resolveMessages('ja', undefined).openButton).toBe(jaMessages.openButton);
    expect(resolveMessages('en', { openButton: 'Browse' }).openButton).toBe('Browse');
  });

  it('keeps the base string for an override passed as undefined', () => {
    expect(resolveMessages('ja', { openButton: undefined }).openButton).toBe(jaMessages.openButton);
  });

  it('uses a caller-provided fallback when no locale is specified', () => {
    expect(resolveMessages(undefined, { settingsButton: 'Prefs' }, jaMessages)).toMatchObject({
      openButton: jaMessages.openButton,
      settingsButton: 'Prefs',
    });
  });

  it('formats known placeholders and preserves unknown placeholders', () => {
    expect(formatMessage(enMessages.spreadAnnouncement, { spread: 2, total: 5 })).toBe(
      'Spread 2 of 5',
    );
    expect(formatMessage('Hello {name} {missing}', { name: 'Mejiro' })).toBe(
      'Hello Mejiro {missing}',
    );
  });
});

describe('built-in catalogs', () => {
  it('are frozen, so a write fails instead of changing every reader', () => {
    for (const catalog of [enMessages, jaMessages, messageCatalogs]) {
      expect(Object.isFrozen(catalog)).toBe(true);
    }
    expect(() => {
      (enMessages as { openButton: string }).openButton = 'changed';
    }).toThrow(TypeError);
    expect(() => {
      (messageCatalogs as { en: MejiroMessages }).en = jaMessages;
    }).toThrow(TypeError);
    expect(enMessages.openButton).toBe('Open');
  });

  it('are read-only in their types', () => {
    expectTypeErrors(
      `import { enMessages, messageCatalogs } from '@libraz/mejiro';
export const label: string = enMessages.openButton;
export const catalog = messageCatalogs.en;
export const writeMessage = () => { enMessages.openButton = 'x'; };
export const writeCatalog = () => { messageCatalogs.en = enMessages; };
`,
      { fails: ['enMessages.openButton = ', 'messageCatalogs.en = '] },
    );
  });

  it('hand back a frozen catalog from resolveMessages as well', () => {
    expect(Object.isFrozen(resolveMessages('en', { openButton: 'Browse' }))).toBe(true);
    expect(Object.isFrozen(resolveMessages('ja', undefined))).toBe(true);
  });
});

describe('reading time messages', () => {
  const FORMS = {
    en: {
      readingTimeHoursMinutes: '{hours}h {minutes}m',
      readingTimeMinutesSeconds: '{minutes}m {seconds}s',
      readingTimeMinutes: '{minutes}m 0s',
      readingTimeSeconds: '{seconds}s',
    },
    ja: {
      readingTimeHoursMinutes: '{hours}時間{minutes}分',
      readingTimeMinutesSeconds: '{minutes}分{seconds}秒',
      readingTimeMinutes: '{minutes}分',
      readingTimeSeconds: '{seconds}秒',
    },
  } as const;

  it('carry the units in each built-in catalog', () => {
    expect(enMessages).toMatchObject(FORMS.en);
    expect(jaMessages).toMatchObject(FORMS.ja);
  });

  it('expand through formatMessage with the documented placeholders', () => {
    expect(formatMessage(enMessages.readingTimeHoursMinutes, { hours: 1, minutes: 5 })).toBe(
      '1h 5m',
    );
    expect(formatMessage(enMessages.readingTimeMinutesSeconds, { minutes: 2, seconds: 30 })).toBe(
      '2m 30s',
    );
    expect(formatMessage(enMessages.readingTimeMinutes, { minutes: 3 })).toBe('3m 0s');
    expect(formatMessage(enMessages.readingTimeSeconds, { seconds: 7 })).toBe('7s');
    expect(formatMessage(jaMessages.readingTimeHoursMinutes, { hours: 1, minutes: 5 })).toBe(
      '1時間5分',
    );
    expect(formatMessage(jaMessages.readingTimeMinutes, { minutes: 3 })).toBe('3分');
  });

  it('can be overridden like any other key', () => {
    expect(resolveMessages('en', { readingTimeSeconds: '{seconds} sec' }).readingTimeSeconds).toBe(
      '{seconds} sec',
    );
  });
});
