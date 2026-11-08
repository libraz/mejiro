/**
 * @vitest-environment node
 */
import { CharMeasurer, layoutText, MejiroError } from '@libraz/mejiro/browser';
import { describe, expect, it } from 'vitest';

describe('measuring without a document', () => {
  it('throws environment-unsupported from CharMeasurer when no canvas can be created', () => {
    expect(typeof document).toBe('undefined');
    const measurer = new CharMeasurer();

    expect(() => measurer.measure('16px serif', 0x3042)).toThrow(MejiroError);
    expect(() => measurer.measure('16px serif', 0x3042)).toThrow(
      expect.objectContaining({ code: 'environment-unsupported' }),
    );
  });

  it('rejects layoutText with environment-unsupported', async () => {
    await expect(
      layoutText({ text: 'あ', lineWidth: 50, fontFamily: 'serif', fontSize: 16 }),
    ).rejects.toMatchObject({ name: 'MejiroError', code: 'environment-unsupported' });
  });
});
