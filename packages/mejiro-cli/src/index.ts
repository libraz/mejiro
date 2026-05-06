import { pathToFileURL } from 'node:url';
import { computeBreaks, toCodepoints } from '@libraz/mejiro';

interface CliIO {
  stdout: Pick<NodeJS.WriteStream, 'write'>;
  stderr: Pick<NodeJS.WriteStream, 'write'>;
}

function printUsage(io: CliIO): void {
  io.stdout.write(`Usage:
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

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function parsePositiveNumber(
  value: string | undefined,
  defaultValue: number,
  name: string,
): number {
  const parsed = value == null ? defaultValue : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

function positionalArgs(args: string[]): string[] {
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--no-hanging') continue;
    if (arg.startsWith('--')) {
      i++;
      continue;
    }
    positionals.push(arg);
  }
  return positionals;
}

function runLayout(args: string[], io: CliIO): number {
  const lineWidth = parsePositiveNumber(parseFlag(args, '--line-width'), 160, '--line-width');
  const advance = parsePositiveNumber(parseFlag(args, '--advance'), 16, '--advance');
  const mode = parseFlag(args, '--mode') ?? 'strict';
  if (mode !== 'strict' && mode !== 'loose') {
    throw new Error('--mode must be strict or loose');
  }
  const enableHanging = !args.includes('--no-hanging');

  const text = positionalArgs(args).join(' ');
  if (!text) {
    throw new Error('no text provided');
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
    io.stdout.write(`${line}\n`);
    start = bp + 1;
  }
  if (start < codepoints.length) {
    const line = codepointsToString(codepoints, start, codepoints.length);
    io.stdout.write(`${line}\n`);
  }

  io.stdout.write(`\nBreak points: [${[...result.breakPoints].join(', ')}]\n`);
  if (result.hangingAdjustments) {
    io.stdout.write(`Hanging adjustments: [${[...result.hangingAdjustments].join(', ')}]\n`);
  }
  return 0;
}

function runBench(args: string[], io: CliIO): number {
  const numChars = parsePositiveNumber(parseFlag(args, '--chars'), 10000, '--chars');
  const iterations = parsePositiveNumber(parseFlag(args, '--iterations'), 1000, '--iterations');

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

  io.stdout.write(`${numChars} chars x ${iterations} iterations\n`);
  io.stdout.write(`Total: ${elapsed.toFixed(2)}ms\n`);
  io.stdout.write(`Per iteration: ${(elapsed / iterations).toFixed(4)}ms\n`);
  return 0;
}

export function runCli(args: string[], io: CliIO = process): number {
  const command = args[0];
  try {
    if (command === 'layout') return runLayout(args.slice(1), io);
    if (command === 'bench') return runBench(args.slice(1), io);
    printUsage(io);
    return command ? 1 : 0;
  } catch (err) {
    io.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

function codepointsToString(cps: Uint32Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end; i++) {
    s += String.fromCodePoint(cps[i]);
  }
  return s;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runCli(process.argv.slice(2));
}
