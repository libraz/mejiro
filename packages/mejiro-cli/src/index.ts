import { pathToFileURL } from 'node:url';
import { computeBreaks, toCodepoints } from '@libraz/mejiro';
import { parseFlag, parsePositiveNumber, positionalArgs } from './args.js';
import { runBenchAnalysis } from './bench-analysis.js';

interface CliIO {
  stdout: Pick<NodeJS.WriteStream, 'write'>;
  stderr: Pick<NodeJS.WriteStream, 'write'>;
}

function printUsage(io: CliIO): void {
  io.stdout.write(`Usage:
  mejiro layout [options] <text>
  mejiro bench  [options]
  mejiro bench-analysis [options]

Layout options:
  --line-width <n>   Line width in px (default: 160)
  --advance <n>      Uniform advance width (default: 16)
  --mode <mode>      Kinsoku mode: strict | loose (default: strict)
  --no-hanging       Disable hanging punctuation

Bench options:
  --chars <n>        Number of characters (default: 10000)
  --iterations <n>   Number of iterations (default: 1000)

Bench-analysis options:
  --chars <n>          Corpus size in characters (default: 20000)
  --iterations <n>     Iterations per timing (default: 20)
  --line-width-em <n>  Line width in em (default: 40)
`);
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

/**
 * Runs one CLI command.
 *
 * @param args - Process arguments, starting with the command name.
 * @param io - Where output is written.
 * @returns The exit code, or a promise of it for commands that run
 *   asynchronously because they load the morphological analyzer.
 */
export function runCli(args: string[], io: CliIO = process): number | Promise<number> {
  const command = args[0];
  try {
    if (command === 'layout') return runLayout(args.slice(1), io);
    if (command === 'bench') return runBench(args.slice(1), io);
    if (command === 'bench-analysis') {
      return runBenchAnalysis(args.slice(1), io).catch((err) => reportError(err, io));
    }
    printUsage(io);
    return command ? 1 : 0;
  } catch (err) {
    return reportError(err, io);
  }
}

/** Writes a failure to stderr and returns the exit code that goes with it. */
function reportError(err: unknown, io: CliIO): number {
  io.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  return 1;
}

function codepointsToString(cps: Uint32Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end; i++) {
    s += String.fromCodePoint(cps[i]);
  }
  return s;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
