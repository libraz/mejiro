import { computeBreaks, toCodepoints } from '@libraz/mejiro';

const args = process.argv.slice(2);
const command = args[0];

if (command === 'layout') {
  runLayout(args.slice(1));
} else if (command === 'bench') {
  runBench(args.slice(1));
} else {
  printUsage();
}

function printUsage(): void {
  process.stdout.write(`Usage:
  mejiro layout [options] <text>
  mejiro bench  [options]

Layout options:
  --line-width <n>   Line width in px (default: 160)
  --advance <n>      Uniform advance width (default: 16)
  --mode <mode>      Kinsoku mode: strict | loose (default: strict)
  --no-hanging       Disable hanging punctuation

Bench options:
  --chars <n>        Number of characters (default: 10000)
  --iterations <n>   Number of iterations (default: 1000)
`);
}

function parseFlag(args: string[], flag: string, defaultVal: string): string {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}

function runLayout(args: string[]): void {
  const lineWidth = Number(parseFlag(args, '--line-width', '160'));
  const advance = Number(parseFlag(args, '--advance', '16'));
  const mode = parseFlag(args, '--mode', 'strict') as 'strict' | 'loose';
  const enableHanging = !args.includes('--no-hanging');

  // Text is the last non-flag argument
  const text = args.filter((a) => !a.startsWith('--')).pop();
  if (!text) {
    process.stderr.write('Error: no text provided\n');
    process.exit(1);
  }

  const codepoints = toCodepoints(text);
  const advances = new Float32Array(codepoints.length).fill(advance);

  const result = computeBreaks({
    text: codepoints,
    advances,
    lineWidth,
    mode,
    enableHanging,
  });

  // Print lines
  let start = 0;
  for (const bp of result.breakPoints) {
    const line = codepointsToString(codepoints, start, bp + 1);
    process.stdout.write(`${line}\n`);
    start = bp + 1;
  }
  if (start < codepoints.length) {
    const line = codepointsToString(codepoints, start, codepoints.length);
    process.stdout.write(`${line}\n`);
  }

  process.stdout.write(`\nBreak points: [${[...result.breakPoints].join(', ')}]\n`);
  if (result.hangingAdjustments) {
    process.stdout.write(`Hanging adjustments: [${[...result.hangingAdjustments].join(', ')}]\n`);
  }
}

function runBench(args: string[]): void {
  const numChars = Number(parseFlag(args, '--chars', '10000'));
  const iterations = Number(parseFlag(args, '--iterations', '1000'));

  const text = new Uint32Array(numChars);
  const advances = new Float32Array(numChars);
  for (let i = 0; i < numChars; i++) {
    text[i] = 0x3042; // あ
    advances[i] = 16;
  }

  // Warm up
  for (let i = 0; i < 10; i++) {
    computeBreaks({ text, advances, lineWidth: 160 });
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    computeBreaks({ text, advances, lineWidth: 160 });
  }
  const elapsed = performance.now() - start;

  process.stdout.write(`${numChars} chars x ${iterations} iterations\n`);
  process.stdout.write(`Total: ${elapsed.toFixed(2)}ms\n`);
  process.stdout.write(`Per iteration: ${(elapsed / iterations).toFixed(4)}ms\n`);
}

function codepointsToString(cps: Uint32Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end; i++) {
    s += String.fromCodePoint(cps[i]);
  }
  return s;
}
