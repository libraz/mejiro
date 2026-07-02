import { describe, expect, it } from 'vitest';
import { enMessages, formatMessage, jaMessages, resolveMessages } from '../src/i18n.js';

describe('i18n catalogs', () => {
  it('resolves built-in locales and overrides', () => {
    expect(resolveMessages('ja', undefined).openButton).toBe(jaMessages.openButton);
    expect(resolveMessages('en', { openButton: 'Browse' }).openButton).toBe('Browse');
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
