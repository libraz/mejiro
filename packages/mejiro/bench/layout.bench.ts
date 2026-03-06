import { bench, describe } from 'vitest';
import { computeBreaks } from '../src/layout.js';

function generateInput(length: number) {
  const text = new Uint32Array(length);
  const advances = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    // Mix of full-width (16px) and half-width (8px)
    text[i] = i % 5 === 0 ? 0x0041 : 0x3042; // A or あ
    advances[i] = i % 5 === 0 ? 8 : 16;
  }
  return { text, advances };
}

describe('computeBreaks', () => {
  const short = generateInput(100);
  bench('100 chars', () => {
    computeBreaks({ ...short, lineWidth: 160 });
  });

  const medium = generateInput(10_000);
  bench('10,000 chars', () => {
    computeBreaks({ ...medium, lineWidth: 160 });
  });

  const long = generateInput(100_000);
  bench('100,000 chars', () => {
    computeBreaks({ ...long, lineWidth: 160 });
  });
});
