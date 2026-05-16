import { describe, expect, it } from 'vitest';

describe('package entrypoint SSR import', () => {
  it('can be imported without a DOM', async () => {
    expect(typeof document).toBe('undefined');

    const mod = await import('../src/index.js');

    expect(mod.MejiroReader).toBeDefined();
  });
});
