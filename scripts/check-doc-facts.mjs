// Verifies the analyzer footprint quoted in the docs against the package that
// is actually installed.
//
// The optional `@libraz/suzume` analyzer's size is quoted in both READMEs, both
// copies of docs/09-advanced, and a comment in the demo. The number belongs to
// the dependency, so it is measured here instead of trusted.
//
// When suzume is not installed the check reports that and passes: the repo
// still builds without the optional peer.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const WASM = path.join(root, 'node_modules/@libraz/suzume/dist/suzume.wasm');

if (!fs.existsSync(WASM)) {
  console.log('note: @libraz/suzume is not installed — analyzer footprint check skipped.');
  process.exit(0);
}

const bytes = fs.readFileSync(WASM);
// Decimal KB, matching how the prose is written ("roughly 567 KB").
const rawKb = Math.round(bytes.length / 1000);
const gzipKb = Math.round(gzipSync(bytes, { level: 9 }).length / 1000);

// The prose says "roughly" and "約", and a gzip figure moves a little with the
// compressor used to produce it, so the contract is closeness rather than
// equality. 2% keeps 567 next to 568 and still rejects a stale 360.
const TOLERANCE = 0.02;
const near = (quoted) =>
  [rawKb, gzipKb].some((measured) => Math.abs(quoted - measured) / measured <= TOLERANCE);

/** Files that describe the analyzer to a reader. */
const TARGETS = [
  'README.md',
  'README_ja.md',
  'docs/en/09-advanced.md',
  'docs/ja/09-advanced.md',
  'packages/mejiro-demo/src/main.ts',
];

// A three-digit KB figure on a line that is talking about the analyzer.
const FIGURE = /(\d{3})\s?KB/gi;
const ABOUT_ANALYZER = /suzume|WebAssembly|WASM|analyzer|解析器/i;

const problems = [];

for (const rel of TARGETS) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) continue;
  fs.readFileSync(abs, 'utf-8')
    .split('\n')
    .forEach((line, i) => {
      if (!ABOUT_ANALYZER.test(line)) return;
      for (const match of line.matchAll(FIGURE)) {
        const value = Number(match[1]);
        if (!near(value)) {
          problems.push(
            `${rel}:${i + 1} says ${value} KB. The installed @libraz/suzume measures ` +
              `${rawKb} KB raw and ${gzipKb} KB gzipped.`,
          );
        }
      }
    });
}

if (problems.length) {
  console.error(`\nDoc fact check failed (${problems.length} problem(s)):\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('');
  process.exit(1);
}

console.log(`Doc fact check passed: analyzer is ${rawKb} KB raw / ${gzipKb} KB gzipped.`);
