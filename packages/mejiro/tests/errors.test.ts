import { MejiroError } from '@libraz/mejiro';
import { MejiroError as AnalysisMejiroError } from '@libraz/mejiro/analysis';
import { MejiroError as BookMejiroError } from '@libraz/mejiro/book';
import { MejiroError as BrowserMejiroError } from '@libraz/mejiro/browser';
import { MejiroError as EpubMejiroError } from '@libraz/mejiro/epub';
import { MejiroError as ImageMejiroError } from '@libraz/mejiro/image';
import { MejiroError as RenderMejiroError } from '@libraz/mejiro/render';
import { describe, expect, it } from 'vitest';

describe('MejiroError', () => {
  it('carries its name and code and is an Error', () => {
    const error = new MejiroError('epub-invalid-archive', 'not an archive');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(MejiroError);
    expect(error).toMatchObject({ name: 'MejiroError', code: 'epub-invalid-archive' });
    expect(error.cause).toBeUndefined();
  });

  it('keeps the underlying cause', () => {
    const cause = new TypeError('underlying');
    const error = new MejiroError('font-load-failed', 'font failed', { cause });

    expect(error.cause).toBe(cause);
  });

  it('is matched by a rejects assertion on name and code', async () => {
    await expect(
      Promise.reject(new MejiroError('fetch-failed', 'status 404')),
    ).rejects.toMatchObject({ name: 'MejiroError', code: 'fetch-failed' });
  });

  it('is the same class from every core entry point', () => {
    for (const exported of [
      AnalysisMejiroError,
      BookMejiroError,
      BrowserMejiroError,
      EpubMejiroError,
      ImageMejiroError,
      RenderMejiroError,
    ]) {
      expect(exported).toBe(MejiroError);
    }
    expect(new EpubMejiroError('epub-limit-exceeded', '')).toBeInstanceOf(MejiroError);
  });
});
